import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/errors";
import { brl } from "../lib/data";
import { formatDate, formatPlate } from "../lib/format";
import {
  FINANCE_SITUATION, INSTALLMENT_STATUS, PAYMENT_METHODS, formatCalendarDate, installmentStatus, monthLabel, num, round2, todayBR,
  type FinanceOsRow, type Installment, type Payment,
} from "../lib/finance";
import type { OsStatus } from "../lib/types";
import { BarChart, type ChartPoint } from "../components/BarChart";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PaymentDialog, type PaymentValues } from "../components/PaymentDialog";
import { PlanDialog } from "../components/PlanDialog";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";

interface Header {
  id: string; number: string; status: OsStatus; opened_at: string;
  customers: { id: string; full_name: string }; vehicles: { id: string; plate_normalized: string; brand: string; model: string };
}
interface QuoteLite { id: string; version: number; approved_at: string | null; subtotal: number; discount: number; total: number }
interface Data {
  os: Header; payments: Payment[]; installments: Installment[]; counted: string[] | null; quotes: QuoteLite[]; overview: FinanceOsRow | null;
}

const toPayment = (r: Record<string, unknown>): Payment => ({
  ...(r as unknown as Payment), amount: num(r.amount), card_fee_amount: num(r.card_fee_amount), net_amount: num(r.net_amount),
});
const toInstallment = (r: Record<string, unknown>): Installment => ({ ...(r as unknown as Installment), amount: num(r.amount) });

async function fetchAll(id: string): Promise<Data> {
  const [os, pay, ins, set, quo, ov] = await Promise.all([
    supabase.from("service_orders").select("id, number, status, opened_at, customers(id, full_name), vehicles(id, plate_normalized, brand, model)").eq("id", id).single(),
    supabase.from("finance_payments").select("*").eq("service_order_id", id).order("paid_at", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("finance_installments").select("*").eq("service_order_id", id).order("number"),
    supabase.from("finance_os_settings").select("counted_quote_ids").eq("service_order_id", id).maybeSingle(),
    supabase.from("quotes").select("id, version, discount_amount, approved_at, quote_items(total, approved)").eq("service_order_id", id).eq("status", "aprovado").order("version"),
    supabase.rpc("finance_os_overview"),
  ]);
  const err = [os, pay, ins, set, quo, ov].find((r) => r.error)?.error;
  if (err) throw err;
  const quotes = ((quo.data ?? []) as Record<string, unknown>[]).map((q) => {
    const items = (q.quote_items ?? []) as { total: number; approved: boolean }[];
    const subtotal = round2(items.filter((i) => i.approved).reduce((s, i) => s + num(i.total), 0));
    const discount = num(q.discount_amount);
    return { id: String(q.id), version: num(q.version), approved_at: (q.approved_at as string | null) ?? null, subtotal, discount, total: Math.max(round2(subtotal - discount), 0) };
  });
  const row = ((ov.data ?? []) as Record<string, unknown>[]).find((r) => r.service_order_id === id);
  return {
    os: os.data as unknown as Header,
    payments: ((pay.data ?? []) as Record<string, unknown>[]).map(toPayment),
    installments: ((ins.data ?? []) as Record<string, unknown>[]).map(toInstallment),
    counted: ((set.data as { counted_quote_ids: string[] | null } | null)?.counted_quote_ids) ?? null,
    quotes,
    overview: row
      ? { ...(row as unknown as FinanceOsRow), amount_due: num(row.amount_due), amount_paid: num(row.amount_paid), amount_net: num(row.amount_net),
          balance: num(row.balance), pending_installments: num(row.pending_installments), overdue_installments: num(row.overdue_installments) }
      : null,
  };
}

type Dialog = { kind: "new" } | { kind: "edit"; p: Payment } | { kind: "receive"; i: Installment } | null;

export function FinanceiroOS() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [del, setDel] = useState<Payment | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [mode, setMode] = useState<"ultima" | "escolher">("ultima");
  const [picked, setPicked] = useState<string[]>([]);
  const [savingVersions, setSavingVersions] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const d = await fetchAll(id);
      setData(d); setError(null);
      const latest = d.quotes[d.quotes.length - 1];
      setMode(d.counted ? "escolher" : "ultima");
      setPicked(d.counted ?? (latest ? [latest.id] : []));
    } catch (e) { setError(friendlyError(e)); }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  const today = todayBR();
  const instByPayment = useMemo(
    () => new Map((data?.installments ?? []).filter((i) => i.payment_id).map((i) => [i.payment_id as string, i.number])), [data]);

  const scheduleChart: ChartPoint[] = useMemo(() => {
    const byMonth = new Map<string, Record<string, number>>();
    for (const i of data?.installments ?? []) {
      const key = `${i.due_date.slice(0, 7)}-01`;
      const cur = byMonth.get(key) ?? {};
      const st = installmentStatus(i, today);
      cur[st] = round2((cur[st] ?? 0) + i.amount);
      byMonth.set(key, cur);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, values]) => ({ label: monthLabel(m), values }));
  }, [data, today]);

  if (error && !data) return <div className="page"><p className="form-error">{error} <button className="btn btn-link" onClick={reload}>Tentar de novo</button></p></div>;
  if (!data) return <div className="page"><p className="muted">Carregando…</p></div>;

  const { os, payments, installments, quotes, overview } = data;
  const due = overview?.amount_due ?? 0;
  const paid = overview?.amount_paid ?? 0;
  const net = overview?.amount_net ?? 0;
  const balance = overview?.balance ?? 0;
  const overdue = overview?.overdue_installments ?? 0;
  const situation = overview?.situation ?? "sem_valor";
  const unpaidInst = installments.filter((i) => !i.payment_id);

  // ---------- ações (devolvem a mensagem de erro, ou null quando deu certo) ----------
  const done = async (msg: string) => { toast("ok", msg); setDialog(null); setPlanOpen(false); await reload(); return null; };

  async function addPayment(v: PaymentValues) {
    const r = await supabase.from("finance_payments").insert({ service_order_id: os.id, ...v });
    return r.error ? friendlyError(r.error) : done("Pagamento registrado.");
  }
  async function editPayment(p: Payment, v: PaymentValues) {
    const r = await supabase.from("finance_payments").update(v).eq("id", p.id);
    return r.error ? friendlyError(r.error) : done("Pagamento corrigido.");
  }
  async function receive(i: Installment, v: PaymentValues) {
    const r = await supabase.rpc("finance_receive_installment", {
      p_installment: i.id, p_method: v.method, p_paid_at: v.paid_at, p_amount: v.amount,
      p_card_fee: v.card_fee_amount, p_card_installments: v.card_installments, p_notes: v.notes,
    });
    return r.error ? friendlyError(r.error) : done(`Parcela ${i.number} recebida.`);
  }
  async function createPlan(total: number, count: number, firstDue: string) {
    const r = await supabase.rpc("finance_create_installment_plan", { p_os: os.id, p_total: total, p_count: count, p_first_due: firstDue });
    return r.error ? friendlyError(r.error) : done(`Plano gerado: ${count} parcelas.`);
  }
  async function removePayment() {
    if (!del) return;
    setDelBusy(true);
    const r = await supabase.from("finance_payments").delete().eq("id", del.id);
    setDelBusy(false);
    if (r.error) { toast("error", friendlyError(r.error)); return; }
    setDel(null); toast("ok", "Pagamento excluído."); await reload();
  }
  async function saveVersions() {
    if (mode === "escolher" && picked.length === 0) { toast("error", "Marque pelo menos uma versão."); return; }
    setSavingVersions(true);
    const r = await supabase.from("finance_os_settings").upsert(
      { service_order_id: os.id, counted_quote_ids: mode === "escolher" ? picked : null }, { onConflict: "service_order_id" });
    setSavingVersions(false);
    if (r.error) { toast("error", friendlyError(r.error)); return; }
    toast("ok", "Valor da OS atualizado."); await reload();
  }

  const saldoNote = balance > 0 ? `Falta receber ${brl(balance)} nesta OS.` : due > 0 ? "Esta OS já está quitada; um novo pagamento ficará acima do valor." : undefined;
  const latest = quotes[quotes.length - 1];

  return (
    <div className="page">
      <header className="os-head">
        <div>
          <h1>Financeiro, {os.number}</h1>
          <p className="muted">
            <Link to={`/sistema/veiculos/${os.vehicles.id}`} className="plate-chip">{formatPlate(os.vehicles.plate_normalized)}</Link>{" "}
            {os.vehicles.brand} {os.vehicles.model}, <Link to={`/sistema/clientes/${os.customers.id}`}>{os.customers.full_name}</Link>
          </p>
          <p className="muted small">Aberta em {formatDate(os.opened_at)}</p>
        </div>
        <div className="row-actions">
          <StatusBadge status={os.status} />
          <Link className="btn btn-secondary btn-sm" to={`/sistema/os/${os.id}`}>Abrir OS</Link>
          <Link className="btn btn-secondary btn-sm" to="/sistema/financeiro">Voltar</Link>
        </div>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section aria-labelledby="h-os-resumo">
        <h2 id="h-os-resumo" className="section-title">Situação <span className={`badge badge-${FINANCE_SITUATION[situation].tone}`}>{FINANCE_SITUATION[situation].label}</span></h2>
        <div className="fin-tiles">
          <div className="tile tile-neutral"><span className="tile-value">{brl(due)}</span><span className="tile-label">Valor da OS</span></div>
          <div className="tile tile-ready">
            <span className="tile-value">{brl(paid)}</span><span className="tile-label">Recebido</span>
            {paid !== net && <span className="muted small">Líquido de taxas: {brl(net)}</span>}
          </div>
          <div className={`tile ${balance > 0 ? "tile-wait" : "tile-done"}`}><span className="tile-value">{brl(balance)}</span><span className="tile-label">Falta receber</span></div>
          {overdue > 0 && <div className="tile tile-stop"><span className="tile-value">{brl(overdue)}</span><span className="tile-label">Parcelas em atraso</span></div>}
        </div>
      </section>

      <section className="panel" aria-labelledby="h-os-valor">
        <h2 id="h-os-valor" className="section-title">Valor da OS</h2>
        {quotes.length === 0 && <p className="empty">Esta OS ainda não tem orçamento aprovado. O valor aparece quando o orçamento for aprovado.</p>}
        {quotes.length === 1 && (
          <p>Orçamento aprovado (versão {latest.version}): subtotal {brl(latest.subtotal)}{latest.discount > 0 ? `, desconto ${brl(latest.discount)}` : ""}. <strong>Total {brl(latest.total)}</strong></p>
        )}
        {quotes.length > 1 && (
          <>
            <p className="muted small">Há mais de uma versão aprovada. Por padrão vale só a última; se alguma versão for um acréscimo, marque quais somam.</p>
            <div className="fin-pick" role="radiogroup" aria-label="Quais versões contam no valor">
              <label className={mode === "ultima" ? "on" : ""}>
                <input type="radio" name="vers" checked={mode === "ultima"} onChange={() => setMode("ultima")} />
                <span>Só a última versão aprovada (versão {latest.version}: <strong>{brl(latest.total)}</strong>)</span>
              </label>
              <label className={mode === "escolher" ? "on" : ""}>
                <input type="radio" name="vers" checked={mode === "escolher"} onChange={() => setMode("escolher")} />
                <span>Escolher quais versões somam</span>
              </label>
            </div>
            {mode === "escolher" && (
              <div className="fin-pick">
                {quotes.map((q) => (
                  <label key={q.id} className={picked.includes(q.id) ? "on" : ""}>
                    <input type="checkbox" checked={picked.includes(q.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, q.id] : picked.filter((x) => x !== q.id))} />
                    <span>Versão {q.version}: <strong>{brl(q.total)}</strong>{q.approved_at ? `, aprovada em ${formatDate(q.approved_at)}` : ""}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={saveVersions} disabled={savingVersions || (mode === "ultima" && data.counted === null)}>
                {savingVersions ? "Salvando…" : "Salvar escolha"}
              </button>
            </div>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="h-os-pag">
        <div className="page-head-row">
          <h2 id="h-os-pag" className="section-title">Pagamentos recebidos</h2>
          <button className="btn btn-primary" onClick={() => setDialog({ kind: "new" })}>Registrar pagamento</button>
        </div>
        {payments.length === 0 ? <p className="empty">Nenhum pagamento registrado nesta OS.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Data</th><th>Forma</th><th className="money">Valor</th><th className="money">Taxa</th><th className="money">Líquido</th><th>Observação</th><th /></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="nowrap">{formatCalendarDate(p.paid_at)}</td>
                    <td>{PAYMENT_METHODS[p.method]}{p.card_installments ? ` em ${p.card_installments}x` : ""}
                      {instByPayment.has(p.id) && <span className="badge badge-work">Parcela {instByPayment.get(p.id)}</span>}</td>
                    <td className="money">{brl(p.amount)}</td>
                    <td className="money">{p.card_fee_amount > 0 ? brl(p.card_fee_amount) : "—"}</td>
                    <td className="money">{brl(p.net_amount)}</td>
                    <td className="small">{p.notes ?? ""}</td>
                    <td><div className="row-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => setDialog({ kind: "edit", p })}>Corrigir</button>
                      <button className="btn btn-danger-ghost btn-sm" onClick={() => setDel(p)}>Excluir</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="h-os-parc">
        <div className="page-head-row">
          <h2 id="h-os-parc" className="section-title">Parcelas a receber</h2>
          <button className="btn btn-secondary" onClick={() => setPlanOpen(true)} disabled={balance <= 0 && unpaidInst.length === 0}>
            {installments.length ? "Refazer plano de parcelas" : "Gerar plano de parcelas"}
          </button>
        </div>
        {installments.length === 0 ? (
          <p className="empty">Sem parcelas. Se o cliente vai pagar em várias vezes, gere um plano: o sistema divide o saldo em parcelas mensais.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th className="money">Valor</th><th>Situação</th><th /></tr></thead>
                <tbody>
                  {installments.map((i) => {
                    const st = installmentStatus(i, today);
                    return (
                      <tr key={i.id}>
                        <td>{i.number}ª</td>
                        <td className="nowrap">{formatCalendarDate(i.due_date)}</td>
                        <td className="money">{brl(i.amount)}</td>
                        <td><span className={`badge badge-${INSTALLMENT_STATUS[st].tone}`}>{INSTALLMENT_STATUS[st].label}</span></td>
                        <td><div className="row-actions">
                          {st !== "recebida" && <button className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: "receive", i })}>Receber</button>}
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <BarChart
              title="Parcelas por mês"
              points={scheduleChart}
              series={[
                { key: "recebida", label: "Recebida", color: "var(--fin-recebido)" },
                { key: "prevista", label: "Prevista", color: "var(--fin-previsto)" },
                { key: "atrasada", label: "Atrasada", color: "var(--fin-atraso)" },
              ]}
              format={brl}
              emptyText="Sem parcelas."
            />
          </>
        )}
      </section>

      <PaymentDialog
        open={dialog?.kind === "new"} title="Registrar pagamento" confirmLabel="Registrar" initial={{}} note={saldoNote}
        onSubmit={addPayment} onClose={() => setDialog(null)} />
      <PaymentDialog
        open={dialog?.kind === "edit"} title="Corrigir pagamento" confirmLabel="Salvar correção"
        initial={dialog?.kind === "edit" ? dialog.p : {}}
        onSubmit={(v) => (dialog?.kind === "edit" ? editPayment(dialog.p, v) : Promise.resolve(null))} onClose={() => setDialog(null)} />
      <PaymentDialog
        open={dialog?.kind === "receive"} title={dialog?.kind === "receive" ? `Receber parcela ${dialog.i.number}` : "Receber parcela"} confirmLabel="Dar baixa"
        initial={dialog?.kind === "receive" ? { amount: dialog.i.amount } : {}}
        note={dialog?.kind === "receive" ? `Vence em ${formatCalendarDate(dialog.i.due_date)}, valor previsto ${brl(dialog.i.amount)}. Se o valor recebido for diferente, a diferença continua no saldo da OS.` : undefined}
        onSubmit={(v) => (dialog?.kind === "receive" ? receive(dialog.i, v) : Promise.resolve(null))} onClose={() => setDialog(null)} />
      <PlanDialog open={planOpen} balance={balance} replacing={unpaidInst.length} onSubmit={createPlan} onClose={() => setPlanOpen(false)} />
      <ConfirmDialog open={!!del} title="Excluir pagamento?" confirmLabel="Excluir" danger busy={delBusy} onConfirm={removePayment} onClose={() => setDel(null)}>
        {del && (
          <p>
            Pagamento de <strong>{brl(del.amount)}</strong> ({PAYMENT_METHODS[del.method]}) em {formatCalendarDate(del.paid_at)}.
            {instByPayment.has(del.id) && ` A parcela ${instByPayment.get(del.id)} volta a ficar como não recebida.`} A exclusão fica registrada na auditoria.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
