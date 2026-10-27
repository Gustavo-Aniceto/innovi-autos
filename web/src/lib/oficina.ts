/** Dados públicos da oficina (site e documentos). */
export const OFICINA = {
  nome: "Innovi Autos",
  subtitulo: "Centro Automotivo",
  endereco: "Rua Cabo Antônio Pereira da Silva, 210",
  bairro: "Jardim Tranquilidade, Guarulhos — SP",
  cep: "07051-011",
  telefone: "(11) 94765-3376",
  whatsapp: "5511947653376",
  horario: [
    { dias: "Segunda a sexta", horas: "09h às 18h" },
    { dias: "Sábados, domingos e feriados", horas: "Fechado" },
  ],
  pagamentos: ["Cartão de crédito", "Cartão de débito", "Aproximação", "Pix", "Dinheiro"],
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Rua+Cabo+Ant%C3%B4nio+Pereira+da+Silva+210+Guarulhos+SP",
};

export const SERVICOS = [
  { slug: "mecanica", nome: "Mecânica multimarcas", texto: "Manutenção e reparo para carros nacionais e importados, com diagnóstico antes de qualquer troca." },
  { slug: "injecao", nome: "Injeção eletrônica", texto: "Leitura com scanner, testes de sensores, bicos e corpo de borboleta para encontrar a causa da falha." },
  { slug: "suspensao", nome: "Suspensão", texto: "Amortecedores, molas, bandejas, buchas, pivôs e terminais: estabilidade e conforto de volta." },
  { slug: "freios", nome: "Sistema de freios", texto: "Pastilhas, discos, lonas, fluido e revisão completa do circuito de freio." },
  { slug: "motor", nome: "Revisão de motor", texto: "Revisão por quilometragem, correias, velas, filtros e verificação de vazamentos." },
  { slug: "desgaste", nome: "Itens de desgaste", texto: "Troca de componentes de desgaste natural com peças de procedência." },
  { slug: "preventiva", nome: "Manutenção preventiva e corretiva", texto: "Cuidar antes de quebrar custa menos. Quando quebra, a gente resolve." },
];

export function whatsappLink(texto = "Olá! Vim pelo site da Innovi Autos."): string {
  return `https://wa.me/${OFICINA.whatsapp}?text=${encodeURIComponent(texto)}`;
}

/**
 * Feriados em que a oficina fecha (nacionais, estadual de SP e municipais de Guarulhos,
 * conforme edital do TJSP para 2026: Sexta-feira Santa, Corpus Christi, 20/11 e 08/12).
 * Para fechar em pontos facultativos (ex.: Carnaval), inclua a data em FECHAMENTOS_EXTRAS ("AAAA-MM-DD").
 */
export const FECHAMENTOS_EXTRAS: Record<string, string> = {
  // "2027-02-08": "Carnaval",
};

function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export function feriados(ano: number): Record<string, string> {
  const p = easter(ano);
  return {
    [`${ano}-01-01`]: "Confraternização Universal", [iso(addDays(p, -2))]: "Sexta-feira Santa",
    [`${ano}-04-21`]: "Tiradentes", [`${ano}-05-01`]: "Dia do Trabalho", [iso(addDays(p, 60))]: "Corpus Christi",
    [`${ano}-07-09`]: "Revolução Constitucionalista", [`${ano}-09-07`]: "Independência",
    [`${ano}-10-12`]: "Nossa Senhora Aparecida", [`${ano}-11-02`]: "Finados", [`${ano}-11-15`]: "Proclamação da República",
    [`${ano}-11-20`]: "Consciência Negra", [`${ano}-12-08`]: "Aniversário de Guarulhos", [`${ano}-12-25`]: "Natal",
    ...Object.fromEntries(Object.entries(FECHAMENTOS_EXTRAS).filter(([k]) => k.startsWith(String(ano)))),
  };
}
