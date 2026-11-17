// Versões de orçamento: cada nova versão começa vazia e traz serviços ADICIONAIS.
// Por isso o valor da OS é a soma de todas as versões aprovadas (cada uma com seu desconto).
interface QuoteLike {
  status: string; version: number; discount_amount: number | string;
  quote_items?: { total: number | string; approved: boolean }[] | null;
}

/** Total de uma versão: itens aprovados (ou todos, se ainda não aprovada) menos o desconto. */
export function quoteTotals(q: QuoteLike): { subtotal: number; discount: number; total: number } {
  const subtotal = (q.quote_items ?? []).filter((i) => q.status !== "aprovado" || i.approved).reduce((s, i) => s + Number(i.total), 0);
  const discount = Number(q.discount_amount) || 0;
  return { subtotal, discount, total: Math.max(subtotal - discount, 0) };
}

/** Versões aprovadas, da mais antiga para a mais nova. */
export function approvedQuotes<T extends QuoteLike>(quotes: T[]): T[] {
  return quotes.filter((q) => q.status === "aprovado").sort((a, b) => a.version - b.version);
}

/** Soma das versões aprovadas; null se nenhuma foi aprovada. */
export function approvedSum(quotes: QuoteLike[]): number | null {
  const list = approvedQuotes(quotes);
  if (list.length === 0) return null;
  return Math.round(list.reduce((s, q) => s + quoteTotals(q).total, 0) * 100) / 100;
}
