// Regras puras do financeiro. Rodar: npx tsx tests/finance.test.ts
import {
  addMonths, buildSchedule, feeFromPercent, formatCalendarDate, installmentStatus, monthLabel, monthStart,
  moneyInput, normalizeText, parseMoney, splitInstallments, todayBR, validatePayment, monthToDate, dateToMonth, validateOutflow, toCsv,
} from "../src/lib/finance";
import { compact, niceMax } from "../src/lib/chartMath";

let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? "OK  " : "FALHA", label, ok ? "" : `→ obtido ${JSON.stringify(got)}, esperado ${JSON.stringify(want)}`);
}

// ---- parseMoney
eq("1.234,56", parseMoney("1.234,56"), 1234.56);
eq("1234,5", parseMoney("1234,5"), 1234.5);
eq("1234.56", parseMoney("1234.56"), 1234.56);
eq("milhar sem decimais 1.234", parseMoney("1.234"), 1234);
eq("R$ 50", parseMoney("R$ 50"), 50);
eq("0,99", parseMoney("0,99"), 0.99);
eq("vazio", parseMoney(""), null);
eq("texto", parseMoney("abc"), null);
eq("negativo", parseMoney("-10"), null);
eq("3 casas", parseMoney("10,123"), null);
eq("duas vírgulas", parseMoney("1,2,3"), null);
eq("moneyInput", moneyInput(1234.5), "1234,50");

// ---- taxa por porcentagem
eq("2,99% de 1000", feeFromPercent(1000, "2,99"), 29.9);
eq("3% de 333,33", feeFromPercent(333.33, "3%"), 10);
eq("% inválida", feeFromPercent(100, "abc"), null);
eq("% acima de 100", feeFromPercent(100, "101"), null);

// ---- divisão em parcelas (centavos, resto na última)
eq("1000 em 3", splitInstallments(1000, 3), [333.33, 333.33, 333.34]);
eq("900 em 3", splitInstallments(900, 3), [300, 300, 300]);
eq("0,10 em 3", splitInstallments(0.1, 3), [0.03, 0.03, 0.04]);
eq("soma fecha (1234,57 em 7)", Math.round((splitInstallments(1234.57, 7) ?? []).reduce((a, b) => a + b, 0) * 100), 123457);
// Mesmos números que o banco calcula (tests/security_tests.sql): as duas pontas precisam concordar
eq("1234,57 em 7 (igual ao banco)", splitInstallments(1234.57, 7), [176.36, 176.36, 176.36, 176.36, 176.36, 176.36, 176.41]);
eq("1 parcela é inválida", splitInstallments(100, 1), null);
eq("valor zero", splitInstallments(0, 3), null);
eq("centavo não divide em 3", splitInstallments(0.02, 3), null);
eq("61 parcelas", splitInstallments(1000, 61), null);

// ---- datas
eq("31/01 + 1 mês corta em 28/02", addMonths("2027-01-31", 1), "2027-02-28");
eq("31/01 + 2 meses volta a 31/03", addMonths("2027-01-31", 2), "2027-03-31");
eq("bissexto 29/02", addMonths("2028-01-31", 1), "2028-02-29");
eq("virada de ano", addMonths("2026-11-15", 2), "2027-01-15");
eq("12 meses", addMonths("2026-11-15", 12), "2027-11-15");
eq("meses negativos", addMonths("2026-01-15", -2), "2025-11-15");
eq("cronograma", buildSchedule(1000, 3, "2026-12-31"), [
  { number: 1, due_date: "2026-12-31", amount: 333.33 },
  { number: 2, due_date: "2027-01-31", amount: 333.33 },
  { number: 3, due_date: "2027-02-28", amount: 333.34 },
]);
eq("rótulo de mês", monthLabel("2026-11-01"), "nov/26");
eq("data de calendário", formatCalendarDate("2026-11-05"), "05/11/2026");
eq("data de calendário (timestamp)", formatCalendarDate("2026-11-05T00:00:00Z"), "05/11/2026");
eq("início do mês +2", monthStart(2, "2026-11-12"), "2027-01-01");
eq("início do mês -5", monthStart(-5, "2026-11-12"), "2026-06-01");

// ---- fuso: 23:30 de 12/11 em São Paulo já é 02:30 UTC do dia 13
eq("hoje em São Paulo às 23:30", todayBR(new Date("2026-11-13T02:30:00Z")), "2026-11-12");
eq("hoje em São Paulo às 00:10", todayBR(new Date("2026-11-13T03:10:00Z")), "2026-11-13");

// ---- situação da parcela
eq("vence hoje não é atrasada", installmentStatus({ payment_id: null, due_date: "2026-11-12" }, "2026-11-12"), "prevista");
eq("venceu ontem é atrasada", installmentStatus({ payment_id: null, due_date: "2026-11-11" }, "2026-11-12"), "atrasada");
eq("com baixa é recebida", installmentStatus({ payment_id: "x", due_date: "2026-01-01" }, "2026-11-12"), "recebida");

// ---- validação do pagamento (espelha as regras do banco)
eq("pix válido", validatePayment({ amount: 100, method: "pix", fee: 0, installments: null }), null);
eq("sem valor", validatePayment({ amount: null, method: "pix", fee: 0, installments: null }), "Informe o valor recebido.");
eq("taxa no pix", validatePayment({ amount: 100, method: "pix", fee: 2, installments: null }), "Taxa só vale para pagamento no cartão.");
eq("taxa maior que valor", validatePayment({ amount: 100, method: "credito", fee: 101, installments: null }), "A taxa não pode ser maior que o valor.");
eq("parcelas no débito", validatePayment({ amount: 100, method: "debito", fee: 0, installments: 3 }), "Parcelas do cartão só valem para crédito.");
eq("crédito 3x com taxa", validatePayment({ amount: 300, method: "credito", fee: 9, installments: 3 }), null);
eq("crédito 30x", validatePayment({ amount: 300, method: "credito", fee: 0, installments: 30 }), "Parcelas do cartão: de 1 a 24.");

// ---- busca
eq("busca sem acento", normalizeText("José  da Conceição"), "jose da conceicao");
eq("busca número da OS", normalizeText("OS-2026-000014").includes(normalizeText("000014")), true);
eq("busca placa com hífen", normalizeText("ABC1D23").includes(normalizeText("abc-1d23")), true);

// ---- contas do gráfico
eq("niceMax 0", niceMax(0), 1);
eq("niceMax 830", niceMax(830), 1000);
eq("niceMax 1000", niceMax(1000), 1000);
eq("niceMax 1100", niceMax(1100), 2000);
eq("niceMax 2300", niceMax(2300), 2500);
eq("niceMax 4100", niceMax(4100), 5000);
eq("niceMax 0,4", niceMax(0.4), 0.5);
eq("compact 850", compact(850), "850");
eq("compact 1250", compact(1250), "1,3 mil");
eq("compact 2000", compact(2000), "2 mil");
eq("compact 15400", compact(15400), "15 mil");
eq("compact 2,3 mi", compact(2_300_000), "2,3 mi");
// ---- saídas e relatórios
eq("mês do campo → dia 1", monthToDate("2026-11"), "2026-11-01");
eq("mês inválido", monthToDate("2026-13"), null);
eq("mês vazio", monthToDate(""), null);
eq("data → mês", dateToMonth("2026-11-12"), "2026-11");
eq("saída válida", validateOutflow({ amount: 10, date: "2026-11-12", text: "Peça", textLabel: "Descrição" }), null);
eq("saída sem valor", validateOutflow({ amount: null, date: "2026-11-12" }), "Informe o valor (ex.: 350,00).");
eq("saída valor zero", validateOutflow({ amount: 0, date: "2026-11-12" }), "Informe o valor (ex.: 350,00).");
eq("saída sem data", validateOutflow({ amount: 5, date: "" }), "Informe a data.");
eq("saída descrição curta", validateOutflow({ amount: 5, date: "2026-11-12", text: "x", textLabel: "Ferramenta" }), "Ferramenta: de 2 a 200 caracteres.");
eq("csv com BOM e vírgula decimal", toCsv([["Mês", "Valor"], ["nov/26", 1234.5]]), "\uFEFFMês;Valor\r\nnov/26;1234,50");
eq("csv protege ; e aspas", toCsv([["a;b", 'diz "oi"']]), '\uFEFF"a;b";"diz ""oi"""');

console.log(fail ? `\n${fail} FALHA(S)` : "\nTodos os testes passaram.");
process.exit(fail ? 1 : 0);
