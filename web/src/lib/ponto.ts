// Ponto da equipe. Regras puras (sem rede) para a tela e para os testes.
export type PunchKind = "chegada" | "saida_almoco" | "volta_almoco" | "saida";
export type PunchLocation = "na_oficina" | "fora" | "sem_localizacao" | "manual";

export const PUNCH_ORDER: PunchKind[] = ["chegada", "saida_almoco", "volta_almoco", "saida"];
export const PUNCH_LABEL: Record<PunchKind, string> = {
  chegada: "Chegada", saida_almoco: "Saída para o almoço", volta_almoco: "Volta do almoço", saida: "Saída",
};
export const PUNCH_SHORT: Record<PunchKind, string> = { chegada: "Chegada", saida_almoco: "Almoço", volta_almoco: "Volta", saida: "Saída" };

export interface Punch {
  id: string; user_id: string; work_date: string; kind: PunchKind; punched_at: string;
  accuracy_m: number | null; distance_m: number | null; location_status: PunchLocation; edit_reason: string | null;
}

/** Próximo ponto do dia: o primeiro que falta depois do último já batido. null = dia completo. */
export function nextPunch(done: PunchKind[]): PunchKind | null {
  const last = Math.max(-1, ...done.map((k) => PUNCH_ORDER.indexOf(k)));
  return PUNCH_ORDER[last + 1] ?? null;
}

/** Minutos trabalhados no dia (desconta o almoço). null enquanto não dá para calcular. */
export function workedMinutes(punches: Pick<Punch, "kind" | "punched_at">[], now?: Date): number | null {
  const at = (k: PunchKind) => { const p = punches.find((x) => x.kind === k); return p ? new Date(p.punched_at).getTime() : null; };
  const start = at("chegada");
  if (start == null) return null;
  const end = at("saida") ?? (now ? now.getTime() : null);
  if (end == null || end < start) return null;
  const out = at("saida_almoco"), back = at("volta_almoco");
  let lunch = 0;
  if (out != null) {
    const backOr = back ?? (at("saida") == null ? end : null);
    if (backOr == null) return null; // saiu para o almoço e foi embora sem bater a volta: precisa de correção
    lunch = Math.max(backOr - out, 0);
  }
  return Math.max(Math.round((end - start - lunch) / 60000), 0);
}

export function formatMinutes(min: number | null): string {
  if (min == null) return "—";
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

export function locationText(p: Pick<Punch, "location_status" | "distance_m">): { label: string; tone: string } {
  switch (p.location_status) {
    case "na_oficina": return { label: "Na oficina", tone: "ready" };
    case "fora": return { label: `Fora da oficina${p.distance_m != null ? ` (${formatDistance(p.distance_m)})` : ""}`, tone: "stop" };
    case "manual": return { label: "Lançado pelo administrador", tone: "work" };
    default: return { label: "Sem localização", tone: "wait" };
  }
}
export const formatDistance = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

const tf = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
export const formatClock = (iso: string) => tf.format(new Date(iso));

/** Mensagem para cada falha da localização do navegador. */
export function geoErrorText(code: number): string {
  if (code === 1) return "A localização está bloqueada para este site. O ponto foi salvo com o aviso \"Sem localização\". Para liberar, permita a localização nas configurações do navegador.";
  if (code === 3) return "O celular demorou para achar a localização. O ponto foi salvo com o aviso \"Sem localização\".";
  return "Não foi possível obter a localização. O ponto foi salvo com o aviso \"Sem localização\".";
}

export interface Fix { lat: number; lng: number; accuracy: number }
/** Lê a posição atual uma única vez. Nunca rejeita: devolve o código do erro para a tela avisar. */
export function readPosition(timeoutMs = 12000): Promise<{ fix: Fix } | { errorCode: number }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve({ errorCode: 2 }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (e) => resolve({ errorCode: e.code }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
