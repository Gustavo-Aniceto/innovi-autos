// Gráfico de barras em SVG próprio (sem dependência externa). Barras empilhadas, valores impressos
// e uma tabela escondida para leitores de tela: a cor nunca é a única forma de entender o dado.
import { compact, niceMax } from "../lib/chartMath";

export interface ChartSeries { key: string; label: string; color: string }
export interface ChartPoint { label: string; values: Record<string, number> }

const W = 640, H = 240, PAD_L = 46, PAD_R = 10, PAD_T = 22, PAD_B = 30;

interface Props {
  title: string;
  points: ChartPoint[];
  series: ChartSeries[];
  /** Formata um valor completo (ex.: em reais) para dicas e leitores de tela. */
  format: (n: number) => string;
  emptyText: string;
}

export function BarChart({ title, points, series, format, emptyText }: Props) {
  const totals = points.map((p) => series.reduce((s, x) => s + (p.values[x.key] ?? 0), 0));
  const hasData = totals.some((t) => t > 0);
  const top = niceMax(Math.max(0, ...totals));
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const slot = innerW / Math.max(points.length, 1);
  const barW = Math.min(slot * 0.62, 38);
  const y = (v: number) => PAD_T + innerH - (v / top) * innerH;

  const summary = points.map((p, i) => `${p.label}: ${format(totals[i])}`).join("; ");

  return (
    <figure className="chart-fig">
      <figcaption className="chart-title">{title}</figcaption>
      {!hasData ? (
        <p className="empty">{emptyText}</p>
      ) : (
        <>
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary}`}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line className="grid" x1={PAD_L} x2={W - PAD_R} y1={y(top * f)} y2={y(top * f)} />
                <text className="axis-label" x={PAD_L - 6} y={y(top * f) + 4} textAnchor="end">{compact(top * f)}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = PAD_L + i * slot + (slot - barW) / 2;
              let acc = 0;
              return (
                <g key={p.label}>
                  {series.map((s) => {
                    const v = p.values[s.key] ?? 0;
                    if (v <= 0) return null;
                    const h = (v / top) * innerH;
                    const yy = y(acc + v);
                    acc += v;
                    return (
                      <rect key={s.key} x={x} y={yy} width={barW} height={h} rx={2} style={{ fill: s.color }}>
                        <title>{`${p.label}, ${s.label}: ${format(v)}`}</title>
                      </rect>
                    );
                  })}
                  {totals[i] > 0 && <text className="bar-value" x={x + barW / 2} y={y(totals[i]) - 5} textAnchor="middle">{compact(totals[i])}</text>}
                  <text className="axis-label" x={x + barW / 2} y={H - 10} textAnchor="middle">{p.label}</text>
                </g>
              );
            })}
          </svg>
          <ul className="chart-legend" aria-label="Legenda">
            {series.map((s) => <li key={s.key}><span className="legend-dot" style={{ background: s.color }} aria-hidden />{s.label}</li>)}
          </ul>
          <table className="sr-only">
            <caption>{title}</caption>
            <thead><tr><th>Mês</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label}><th>{p.label}</th>{series.map((s) => <td key={s.key}>{format(p.values[s.key] ?? 0)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </figure>
  );
}
