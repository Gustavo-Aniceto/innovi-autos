import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/errors";
import { brl } from "../lib/data";
import { formatPlate } from "../lib/format";
import {
  FINANCE_SITUATION, formatCalendarDate, monthLabel, monthStart, normalizeText, num,
  type FinanceMonthRow, type FinanceOsRow, type OsProfit,
} from "../lib/finance";
import { BarChart, type ChartPoint } from "../components/BarChart";
import { FinanceNav } from "../components/FinanceNav";

type Filter = "todas" | "abertas" | "atrasadas" | "quitadas";
const PAGE = 40;

const toOsRow = (r: Record<string, unknown>): FinanceOsRow => ({
  ...(r as unknown as FinanceOsRow),
  amount_due: num(r.amount_due), amount_paid: num(r.amount_paid), amount_net: num(r.amount_net), balance: num(r.balance),
  pending_installments: num(r.pending_installments), overdue_installments: num(r.overdue_installments),
});
const toMonthRow = (r: Record<string, unknown>): FinanceMonthRow => ({
  month: String(r.month), received: num(r.received), received_net: num(r.received_net), expected: num(r.expected), overdue: num(r.overdue),
});

export function Financeiro() {
  const [rows, setRows] = useState<FinanceOsRow[] | null>(null);
  const [months, setMonths] = useState<FinanceMonthRow[] | null>(null);
  const [profit, setProfit] = useState<Map<string, OsProfit>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("abertas");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    setError(null);
    const [o, m, pf] = await Promise.all([
      supabase.rpc("finance_os_overview"),
      supabase.rpc("finance_monthly", { p_from: monthStart(-5), p_to: monthStart(11) }),
      supabase.rpc("finance_os_profit"),
    ]);
    if (o.error || m.error || pf.error) { setError(friendlyError(o.error ?? m.error ?? pf.error)); return; }
    setProfit(new Map((pf.data as Record<string, unknown>[]).map((x) => [String(x.service_order_id),
      { service_order_id: String(x.service_order_id), received_net: num(x.received_net), cost: num(x.cost), profit: num(x.profit) }])));
    setRows((o.data as Record<string, unknown>[]).map(toOsRow));
    setMonths((m.data as Record<string, unknown>[]).map(toMonthRow));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setShown(PAGE); }, [filter, q]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const balance = list.reduce((s, r) => s + r.balance, 0);
    const pending = list.reduce((s, r) => s + r.pending_installments, 0);
    const overdue = list.reduce((s, r) => s + r.overdue_installments, 0);
    const cur = (months ?? []).find((x) => x.month === monthStart(0));
    return { balance, dueLater: pending - overdue, overdue, received: cur?.received ?? 0, receivedNet: cur?.received_net ?? 0 };
  }, [rows, months]);

  const upcoming: ChartPoint[] = useMemo(() => {
    if (!months) return [];
    const cur = monthStart(0);
    const future = months.filter((x) => x.month >= cur);
    const curRow = future.find((x) => x.month === cur);
    // Atrasadas de meses anteriores aparecem juntas numa barra à parte (a do mês atual já traz as suas).
    const olderOverdue = Math.max(totals.overdue - (curRow?.overdue ?? 0), 0);
    const pts: ChartPoint[] = future.map((x) => ({ label: monthLabel(x.month), values: { previsto: x.expected, atrasado: x.overdue } }));
    return olderOverdue > 0 ? [{ label: "Atrasadas", values: { atrasado: olderOverdue } }, ...pts] : pts;
  }, [months, totals.overdue]);

  const received: ChartPoint[] = useMemo(() => (months ?? [])
    .filter((x) => x.month <= monthStart(0))
    .map((x) => ({ label: monthLabel(x.month), values: { liquido: x.received_net, taxas: Math.max(x.received - x.received_net, 0) } })), [months]);

  const list = useMemo(() => {
    const term = normalizeText(q);
    return (rows ?? []).filter((r) => {
      if (filter === "abertas" && !(r.balance > 0)) return false;
      if (filter === "atrasadas" && !(r.overdue_installments > 0)) return false;
      if (filter === "quitadas" && r.situation !== "quitada") return false;
      if (term && !normalizeText(`${r.number} ${r.plate} ${r.customer_name}`).includes(term)) return false;
      return true;
    });
  }, [rows, filter, q]);

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <h1>Financeiro</h1>
        <button className="btn btn-secondary btn-sm" onClick={load}>Atualizar</button>
      </header>
      <FinanceNav />
      <p className="muted">Área restrita ao Administrador Master. Valores calculados a partir dos orçamentos aprovados e dos pagamentos registrados.</p>

      {error && (
        <div className="form-error" role="alert">{error} <button className="btn btn-link" onClick={load}>Tentar de novo</button></div>
      )}

      <section aria-labelledby="h-fin-resumo">
        <h2 id="h-fin-resumo" className="section-title">Resumo</h2>
        <div className="fin-tiles">
          <div className="tile tile-wait"><span className="tile-value">{rows ? brl(totals.balance) : "–"}</span><span className="tile-label">Saldo em aberto nas OS</span></div>
          <div className="tile tile-ready">
            <span className="tile-value">{months ? brl(totals.received) : "–"}</span>
            <span className="tile-label">Recebido neste mês</span>
            {months && totals.received !== totals.receivedNet && <span className="muted small">Líquido de taxas: {brl(totals.receivedNet)}</span>}
          </div>
          <div className="tile tile-work"><span className="tile-value">{rows ? brl(totals.dueLater) : "–"}</span><span className="tile-label">Parcelas a vencer</span></div>
          <div className="tile tile-stop"><span className="tile-value">{rows ? brl(totals.overdue) : "–"}</span><span className="tile-label">Parcelas em atraso</span></div>
        </div>
      </section>

      <section aria-labelledby="h-fin-graficos">
        <h2 id="h-fin-graficos" className="section-title">Mês a mês</h2>
        <div className="fin-charts">
          <div className="panel">
            <BarChart
              title="A receber nos próximos meses (parcelas)"
              points={upcoming}
              series={[
                { key: "previsto", label: "Previsto", color: "var(--fin-previsto)" },
                { key: "atrasado", label: "Atrasado", color: "var(--fin-atraso)" },
              ]}
              format={brl}
              emptyText="Nenhuma parcela prevista. Gere um plano de parcelas no detalhe de uma OS."
            />
          </div>
          <div className="panel">
            <BarChart
              title="Recebido por mês"
              points={received}
              series={[
                { key: "liquido", label: "Líquido", color: "var(--fin-recebido)" },
                { key: "taxas", label: "Taxas da maquininha", color: "#9AA2AA" },
              ]}
              format={brl}
              emptyText="Nenhum pagamento registrado nos últimos meses."
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="h-fin-os">
        <h2 id="h-fin-os" className="section-title">Ordens de serviço</h2>
        <div className="filters">
          <div className="field filters-grow">
            <label htmlFor="fin-busca">Buscar por número, placa ou cliente</label>
            <input id="fin-busca" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex.: 000014, ABC1D23 ou Maria" />
          </div>
          <div className="field">
            <label htmlFor="fin-filtro">Mostrar</label>
            <select id="fin-filtro" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="abertas">Com saldo em aberto</option>
              <option value="atrasadas">Com parcela atrasada</option>
              <option value="quitadas">Quitadas</option>
              <option value="todas">Todas</option>
            </select>
          </div>
        </div>

        {rows && list.length === 0 && (
          <p className="empty">
            {rows.length === 0
              ? "Nenhuma OS com valor ainda. Os valores aparecem quando um orçamento é aprovado."
              : "Nenhuma OS neste filtro."}
          </p>
        )}
        <ul className="list">
          {list.slice(0, shown).map((r) => (
            <li key={r.service_order_id}>
              <Link className="list-row" to={`/sistema/financeiro/os/${r.service_order_id}`}>
                <span className="plate-chip">{formatPlate(r.plate)}</span>
                <div className="list-grow">
                  <p className="list-title">{r.number} <span className="muted">{r.customer_name}</span></p>
                  <p className="fin-row-meta muted small">
                    <span>Valor {brl(r.amount_due)}</span>
                    <span>Pago {brl(r.amount_paid)}</span>
                    {profit.has(r.service_order_id) && <span>Lucro da OS {brl(profit.get(r.service_order_id)!.profit)}</span>}
                    {r.next_due && <span>Próx. vencimento {formatCalendarDate(r.next_due)}</span>}
                  </p>
                </div>
                <div className="fin-amounts">
                  <strong>{r.balance > 0 ? `Falta ${brl(r.balance)}` : brl(0)}</strong>
                  <span>
                    <span className={`badge badge-${FINANCE_SITUATION[r.situation].tone}`}>{FINANCE_SITUATION[r.situation].label}</span>
                    {r.overdue_installments > 0 && <span className="badge badge-stop">Atrasada</span>}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {list.length > shown && (
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setShown(shown + PAGE)}>Mostrar mais ({list.length - shown})</button>
          </div>
        )}
      </section>
    </div>
  );
}
