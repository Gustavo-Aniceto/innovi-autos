// Contas do gráfico de barras (puras, testáveis sem React).

/** Arredonda o máximo para um valor "redondo" (1, 2, 2,5, 5 × 10ⁿ) para as linhas de grade ficarem limpas. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * mag >= max) return f * mag;
  return 10 * mag;
}

/** 1250 → "1,3 mil"; 2 300 000 → "2,3 mi"; 850 → "850". */
export function compact(n: number): string {
  const r = (v: number, d: number) => v.toFixed(d).replace(/\.0+$/, "").replace(".", ",");
  if (n >= 1_000_000) return `${r(n / 1_000_000, 1)} mi`;
  if (n >= 1000) return `${r(n / 1000, n >= 10_000 ? 0 : 1)} mil`;
  return String(Math.round(n));
}
