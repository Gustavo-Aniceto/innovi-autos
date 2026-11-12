import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/errors";
import { brl } from "../lib/data";
import { BarChart, type ChartPoint } from "../components/BarChart";
import { FinanceNav } from "../components/FinanceNav";
import { SelectField } from "../components/Field";
import {
  EXPENSE_CATEGORIES, monthLabel, monthStart, num, todayBR, toCsv, type ExpenseCategory, type ReportRow,
} from "../lib/finance";

const PERIODS = [
  { value: "3", label: "Últimos 3 meses" }, { value: "6", label: "Últimos 6 meses" }, { value: "12", label: "Últimos 12 meses" },
];

export function FinanceiroRelatorios() {
  const [period, setPeriod] = useState("6");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [cats, setCats] = useState<{ category: ExpenseCategory; total: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null); setRows(null); setCats(null);
    const from = monthStart(-(Number(period) - 1));
    const to = monthStart(0);
    const [r, c] = await Promise.all([
      supabase.rpc("finance_report_monthly", { p_from: from, p_to: to }),
      supabase.rpc("finance_expense_by_category", { p_from: from, p_to: todayBR() }),
    ]);
    if (r.error || c.error) { setError(friendlyError(r.error ?? c.error)); return; }
    setRows((r.data as Record<string, unknown>[]).map((x) => ({
      month: String(x.month), revenue: num(x.revenue), expenses: num(x.expenses), tool_losses: num(x.tool_losses), staff: num(x.staff), result: num(x.result),
    })));
    setCats((c.data as Record<string, unknown>[]).map((x) => ({ category: x.category as ExpenseCategory, total: num(x.total) })));
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const sum = useMemo(() => {
    const l = rows ?? [];
    const add = (k: keyof ReportRow) => l.reduce((s, r) => s + (r[k] as number), 0);
    return { revenue: add("revenue"), out: add("expenses") + add("tool_losses") + add("staff"), result: add("result") };
  }, [rows]);

  const inOut: ChartPoint[] = (rows ?? []).map((r) => ({
    label: monthLabel(r.month), values: { entradas: r.revenue, saidas: r.expenses + r.tool_losses + r.staff },
  }));
  const outBreak: ChartPoint[] = (rows ?? []).map((r) => ({
    label: monthLabel(r.month), values: { despesas: r.expenses, ferramentas: r.tool_losses, pessoal: r.staff },
  }));

  function exportCsv() {
    if (!rows) return;
    const head = ["Mês", "Entradas (líquidas de taxas)", "Despesas", "Perdas de ferramenta", "Pagamentos a mecânicos", "Resultado"];
    const body = rows.map((r) => [monthLabel(r.month), r.revenue, r.expenses, r.tool_losses, r.staff, r.result]);
    const blob = new Blob([toCsv([head, ...body])], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-financeiro-${monthStart(0).slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <h1>Financeiro</h1>
        <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!rows || rows.length === 0}>Baixar planilha (CSV)</button>
      </header>
      <FinanceNav />
      <p className="muted">Entradas são os pagamentos recebidos, já descontadas as taxas da maquininha. Saídas somam despesas, perdas de ferramenta e pagamentos a mecânicos.</p>

      <div className="filters">
        <SelectField label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </SelectField>
      </div>
      {error && <p className="form-error" role="alert">{error} <button className="btn btn-link" onClick={load}>Tentar de novo</button></p>}

      <div className="fin-tiles">
        <div className="tile tile-ready"><span className="tile-value">{rows ? brl(sum.revenue) : "–"}</span><span className="tile-label">Entradas no período</span></div>
        <div className="tile tile-wait"><span className="tile-value">{rows ? brl(sum.out) : "–"}</span><span className="tile-label">Saídas no período</span></div>
        <div className={`tile ${sum.result < 0 ? "tile-stop" : "tile-work"}`}>
          <span className="tile-value">{rows ? brl(sum.result) : "–"}</span><span className="tile-label">{sum.result < 0 ? "Prejuízo" : "Lucro"} no período</span>
        </div>
      </div>

      <div className="fin-charts">
        <div className="panel">
          <BarChart title="Entradas e saídas por mês" points={inOut}
            series={[{ key: "entradas", label: "Entradas", color: "var(--fin-recebido)" }, { key: "saidas", label: "Saídas", color: "var(--fin-atraso)" }]}
            format={brl} emptyText="Sem movimentação no período." />
        </div>
        <div className="panel">
          <BarChart title="Saídas por tipo" points={outBreak}
            series={[
              { key: "despesas", label: "Despesas", color: "var(--fin-previsto)" },
              { key: "ferramentas", label: "Ferramentas", color: "#9AA2AA" },
              { key: "pessoal", label: "Mecânicos", color: "#B07A00" },
            ]}
            format={brl} emptyText="Nenhuma saída registrada no período." />
        </div>
      </div>

      <section aria-labelledby="h-rel-tab">
        <h2 id="h-rel-tab" className="section-title">Mês a mês</h2>
        {rows && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mês</th><th className="money">Entradas</th><th className="money">Despesas</th><th className="money">Ferramentas</th><th className="money">Mecânicos</th><th className="money">Resultado</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.month}>
                    <td className="nowrap">{monthLabel(r.month)}</td><td className="money">{brl(r.revenue)}</td><td className="money">{brl(r.expenses)}</td>
                    <td className="money">{brl(r.tool_losses)}</td><td className="money">{brl(r.staff)}</td><td className="money"><strong>{brl(r.result)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="h-rel-cat">
        <h2 id="h-rel-cat" className="section-title">Despesas por categoria</h2>
        {cats && cats.length === 0 && <p className="empty">Nenhuma despesa no período.</p>}
        {cats && cats.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Categoria</th><th className="money">Total</th></tr></thead>
              <tbody>{cats.map((c) => <tr key={c.category}><td>{EXPENSE_CATEGORIES[c.category]}</td><td className="money">{brl(c.total)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
