// Financeiro (área exclusiva do MasterAdm). Regras puras, sem acesso à rede: ficam fáceis de testar.
import type { OsStatus } from "./types";

export type PaymentMethod = "pix" | "dinheiro" | "debito" | "credito";
export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  pix: "Pix", dinheiro: "Dinheiro", debito: "Cartão de débito", credito: "Cartão de crédito",
};
export const METHOD_ORDER: PaymentMethod[] = ["pix", "dinheiro", "debito", "credito"];
export const isCard = (m: PaymentMethod) => m === "debito" || m === "credito";

export type FinanceSituation = "sem_valor" | "sem_pagamento" | "parcial" | "quitada";
export const FINANCE_SITUATION: Record<FinanceSituation, { label: string; tone: string }> = {
  sem_valor: { label: "Sem valor", tone: "done" },
  sem_pagamento: { label: "Sem pagamento", tone: "wait" },
  parcial: { label: "Parcial", tone: "work" },
  quitada: { label: "Quitada", tone: "ready" },
};

export interface FinanceOsRow {
  service_order_id: string; number: string; customer_name: string; plate: string; os_status: OsStatus; opened_at: string;
  amount_due: number; amount_paid: number; amount_net: number; balance: number;
  pending_installments: number; overdue_installments: number; next_due: string | null; situation: FinanceSituation;
}
export interface FinanceMonthRow { month: string; received: number; received_net: number; expected: number; overdue: number }
export interface Payment {
  id: string; service_order_id: string; paid_at: string; method: PaymentMethod; amount: number; card_fee_amount: number;
  net_amount: number; card_installments: number | null; notes: string | null; created_at: string; created_by: string | null;
}
export interface Installment {
  id: string; service_order_id: string; number: number; due_date: string; amount: number; payment_id: string | null;
}
export type InstallmentStatus = "recebida" | "atrasada" | "prevista";
export const INSTALLMENT_STATUS: Record<InstallmentStatus, { label: string; tone: string }> = {
  recebida: { label: "Recebida", tone: "ready" }, atrasada: { label: "Atrasada", tone: "stop" }, prevista: { label: "Prevista", tone: "work" },
};

/** Texto para busca: minúsculas, sem acentos, sem pontuação ("OS-2026-000014" → "os2026000014"). */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** O PostgREST devolve numeric como número; a conversão garante isso mesmo se vier texto. */
export const num = (v: unknown): number => (v == null ? 0 : Number(v));

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Lê um valor digitado em reais: "1.234,56", "1234,5", "1234.56", "R$ 50".
 * Devolve null se estiver vazio, inválido, negativo ou com mais de 2 casas decimais.
 */
export function parseMoney(input: string): number | null {
  let s = input.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return round2(Number(s));
}

/** 1234.5 → "1234,50" (para preencher campos). */
export const moneyInput = (n: number) => n.toFixed(2).replace(".", ",");

/** Taxa em R$ a partir de uma porcentagem digitada ("2,99"). Nulo se a porcentagem for inválida. */
export function feeFromPercent(amount: number, pctInput: string): number | null {
  const s = pctInput.replace("%", "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const pct = Number(s);
  if (pct > 100) return null;
  return round2((amount * pct) / 100);
}

/**
 * Divide o total em parcelas iguais, em centavos; a diferença de arredondamento fica na última
 * (mesma regra da função do banco). Nulo se a conta não fechar.
 */
export function splitInstallments(total: number, count: number): number[] | null {
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(count) || count < 2 || count > 60) return null;
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  if (base <= 0) return null;
  const out = Array<number>(count).fill(base / 100);
  out[count - 1] = (base + (cents - base * count)) / 100;
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Soma meses a "AAAA-MM-DD" cortando no último dia do mês (31/01 + 1 mês = 28/02), como o Postgres. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = (m - 1) + months;
  const year = y + Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
}

/** Cronograma: vencimentos sempre calculados a partir do primeiro (não acumulam o corte de fim de mês). */
export function buildSchedule(total: number, count: number, firstDue: string): { number: number; due_date: string; amount: number }[] | null {
  const parts = splitInstallments(total, count);
  if (!parts) return null;
  return parts.map((amount, i) => ({ number: i + 1, due_date: addMonths(firstDue, i), amount }));
}

/** Data de hoje no fuso da oficina ("AAAA-MM-DD"). */
export function todayBR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function installmentStatus(i: Pick<Installment, "payment_id" | "due_date">, today: string = todayBR()): InstallmentStatus {
  if (i.payment_id) return "recebida";
  return i.due_date < today ? "atrasada" : "prevista";
}

/** "2026-11-01" → "nov/26" (rótulo curto de mês para os gráficos). */
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MESES[m - 1]}/${String(y).slice(2)}`;
}

/** "2026-11-05" → "05/11/2026" (sem converter fuso: datas de calendário não têm hora). */
export function formatCalendarDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Primeiro dia do mês, n meses a partir de hoje (para o intervalo dos gráficos). */
export function monthStart(offsetMonths: number, today: string = todayBR()): string {
  return addMonths(`${today.slice(0, 7)}-01`, offsetMonths);
}

/** Linha de pagamento confere com o que o banco aceita (devolve a mensagem do problema, ou null). */
export function validatePayment(p: { amount: number | null; method: PaymentMethod; fee: number; installments: number | null }): string | null {
  if (p.amount == null || p.amount <= 0) return "Informe o valor recebido.";
  if (p.fee < 0) return "A taxa não pode ser negativa.";
  if (p.fee > p.amount) return "A taxa não pode ser maior que o valor.";
  if (p.fee > 0 && !isCard(p.method)) return "Taxa só vale para pagamento no cartão.";
  if (p.installments != null && p.method !== "credito") return "Parcelas do cartão só valem para crédito.";
  if (p.installments != null && (p.installments < 1 || p.installments > 24)) return "Parcelas do cartão: de 1 a 24.";
  return null;
}
