import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/errors";
import { brl, useStaffList } from "../lib/data";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FinanceNav } from "../components/FinanceNav";
import { SelectField, TextArea, TextField } from "../components/Field";
import {
  addMonths, EXPENSE_CATEGORIES, EXPENSE_ORDER, STAFF_KINDS, STAFF_KIND_ORDER, dateToMonth, formatCalendarDate, moneyInput, monthToDate,
  num, parseMoney, todayBR, validateOutflow,
  type ExpenseCategory, type StaffPaymentKind,
} from "../lib/finance";

type Tab = "despesas" | "ferramentas" | "pessoal";
type Table = "finance_expenses" | "finance_tool_losses" | "finance_staff_payments";
type Form =
  | { tab: "despesas"; id?: string; date: string; amount: string; category: ExpenseCategory; text: string; os: string }
  | { tab: "ferramentas"; id?: string; date: string; amount: string; text: string; mechanic: string; notes: string }
  | { tab: "pessoal"; id?: string; date: string; amount: string; mechanic: string; kind: StaffPaymentKind; month: string; notes: string };

const TABLE: Record<Tab, Table> = { despesas: "finance_expenses", ferramentas: "finance_tool_losses", pessoal: "finance_staff_payments" };
const TITLES: Record<Tab, string> = { despesas: "Despesas da oficina", ferramentas: "Perdas de ferramenta", pessoal: "Pagamentos a mecânicos" };
const DATE_COL: Record<Tab, string> = { despesas: "expense_date", ferramentas: "loss_date", pessoal: "paid_at" };

const blank = (tab: Tab): Form => {
  const date = todayBR();
  if (tab === "despesas") return { tab, date, amount: "", category: "outros", text: "", os: "" };
  if (tab === "ferramentas") return { tab, date, amount: "", text: "", mechanic: "", notes: "" };
  return { tab, date, amount: "", mechanic: "", kind: "salario", month: dateToMonth(date), notes: "" };
};

export function FinanceiroSaidas() {
  const staff = useStaffList();
  const names = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s.full_name])), [staff]);
  const mechanics = useMemo(() => staff.filter((s) => s.role === "mecanico"), [staff]);
  const [tab, setTab] = useState<Tab>("despesas");
  const [month, setMonth] = useState(dateToMonth(todayBR()));
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [osList, setOsList] = useState<{ id: string; number: string }[]>([]);

  const load = useCallback(async () => {
    setError(null); setRows(null);
    const from = monthToDate(month);
    if (!from) { setRows([]); return; }
    const next = addMonths(from, 1);
    const col = DATE_COL[tab];
    const { data, error: e } = await supabase.from(TABLE[tab]).select("*").gte(col, from).lt(col, next).order(col, { ascending: false });
    if (e) { setError(friendlyError(e)); return; }
    setRows(data as Record<string, unknown>[]);
  }, [tab, month]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    supabase.from("service_orders").select("id, number").order("opened_at", { ascending: false }).limit(200)
      .then(({ data }) => setOsList((data ?? []) as { id: string; number: string }[]));
  }, []);

  const total = (rows ?? []).reduce((s, r) => s + num(r.amount), 0);

  function openEdit(r: Record<string, unknown>) {
    const base = { id: String(r.id), amount: moneyInput(num(r.amount)) };
    if (tab === "despesas") setForm({ tab, ...base, date: String(r.expense_date), category: r.category as ExpenseCategory, text: String(r.description), os: String(r.service_order_id ?? "") });
    else if (tab === "ferramentas") setForm({ tab, ...base, date: String(r.loss_date), text: String(r.tool_name), mechanic: String(r.mechanic_id ?? ""), notes: String(r.notes ?? "") });
    else setForm({ tab, ...base, date: String(r.paid_at), mechanic: String(r.mechanic_id), kind: r.kind as StaffPaymentKind, month: dateToMonth(String(r.reference_month)), notes: String(r.notes ?? "") });
    setFormError(null);
  }

  async function save() {
    if (!form) return;
    const amount = parseMoney(form.amount);
    const text = form.tab === "pessoal" ? undefined : form.text;
    const bad = validateOutflow({ amount, date: form.date, text, textLabel: form.tab === "despesas" ? "Descrição" : "Ferramenta" });
    if (bad) { setFormError(bad); return; }
    if (form.date > todayBR()) { setFormError("A data não pode ser futura."); return; }
    let payload: Record<string, unknown>;
    if (form.tab === "despesas") payload = { expense_date: form.date, amount, category: form.category, description: form.text.trim(), service_order_id: form.os || null };
    else if (form.tab === "ferramentas") payload = { loss_date: form.date, amount, tool_name: form.text.trim(), mechanic_id: form.mechanic || null, notes: form.notes.trim() || null };
    else {
      const ref = monthToDate(form.month);
      if (!form.mechanic) { setFormError("Escolha o mecânico."); return; }
      if (!ref) { setFormError("Informe o mês de referência."); return; }
      payload = { paid_at: form.date, amount, mechanic_id: form.mechanic, kind: form.kind, reference_month: ref, notes: form.notes.trim() || null };
    }
    setBusy(true); setFormError(null);
    const t = TABLE[form.tab];
    const { error: e } = form.id ? await supabase.from(t).update(payload).eq("id", form.id) : await supabase.from(t).insert(payload);
    setBusy(false);
    if (e) { setFormError(friendlyError(e)); return; }
    setForm(null); load();
  }

  async function remove() {
    if (!del) return;
    setBusy(true);
    const { error: e } = await supabase.from(TABLE[tab]).delete().eq("id", del);
    setBusy(false); setDel(null);
    if (e) { setError(friendlyError(e)); return; }
    load();
  }

  const set = (patch: Partial<Form>) => { setForm((f) => (f ? ({ ...f, ...patch } as Form) : f)); setFormError(null); };

  return (
    <div className="page">
      <header className="page-head page-head-row">
        <h1>Financeiro</h1>
        <button className="btn btn-primary" onClick={() => { setForm(blank(tab)); setFormError(null); }}>Registrar</button>
      </header>
      <FinanceNav />

      <div className="seg" role="radiogroup" aria-label="Tipo de saída">
        {(Object.keys(TITLES) as Tab[]).map((t) => (
          <label key={t} className={tab === t ? "on" : ""}>
            <input type="radio" name="saida-tab" checked={tab === t} onChange={() => setTab(t)} />{TITLES[t]}
          </label>
        ))}
      </div>

      <div className="filters">
        <TextField label="Mês" type="month" value={month} max={dateToMonth(todayBR())} onChange={(e) => setMonth(e.target.value)} />
        <div className="tile tile-stop"><span className="tile-value">{rows ? brl(total) : "–"}</span><span className="tile-label">Total no mês</span></div>
      </div>

      {error && <p className="form-error" role="alert">{error} <button className="btn btn-link" onClick={load}>Tentar de novo</button></p>}
      {rows && rows.length === 0 && <p className="empty">Nada registrado neste mês.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Data</th>
                {tab === "despesas" && <><th>Categoria</th><th>Descrição</th></>}
                {tab === "ferramentas" && <><th>Ferramenta</th><th>Mecânico</th></>}
                {tab === "pessoal" && <><th>Mecânico</th><th>Tipo</th><th>Referência</th></>}
                <th className="money">Valor</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)}>
                  <td className="nowrap">{formatCalendarDate(String(r[DATE_COL[tab]]))}</td>
                  {tab === "despesas" && <><td>{EXPENSE_CATEGORIES[r.category as ExpenseCategory]}</td>
                    <td>{String(r.description)}{r.service_order_id ? <span className="badge badge-work">{osList.find((o) => o.id === r.service_order_id)?.number ?? "OS"}</span> : null}</td></>}
                  {tab === "ferramentas" && <><td>{String(r.tool_name)}{r.notes ? <span className="muted small"> — {String(r.notes)}</span> : null}</td>
                    <td>{r.mechanic_id ? names[String(r.mechanic_id)] ?? "—" : "—"}</td></>}
                  {tab === "pessoal" && <><td>{names[String(r.mechanic_id)] ?? "—"}</td><td>{STAFF_KINDS[r.kind as StaffPaymentKind]}</td>
                    <td>{dateToMonth(String(r.reference_month)).split("-").reverse().join("/")}</td></>}
                  <td className="money">{brl(num(r.amount))}</td>
                  <td><div className="row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>Corrigir</button>
                    <button className="btn btn-danger-ghost btn-sm" onClick={() => setDel(String(r.id))}>Excluir</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog open={!!form} title={form ? `${form.id ? "Corrigir" : "Registrar"}: ${TITLES[form.tab].toLowerCase()}` : ""}
        confirmLabel="Salvar" busy={busy} onConfirm={save} onClose={() => setForm(null)}>
        {form && (
          <div className="form">
            <TextField label="Valor (R$)" inputMode="decimal" autoComplete="off" placeholder="0,00" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
            <TextField label="Data" type="date" value={form.date} max={todayBR()} onChange={(e) => set({ date: e.target.value })} />
            {form.tab === "despesas" && (
              <>
                <SelectField label="Categoria" value={form.category} onChange={(e) => set({ category: e.target.value as ExpenseCategory })}>
                  {EXPENSE_ORDER.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORIES[c]}</option>)}
                </SelectField>
                <TextField label="Descrição" value={form.text} maxLength={200} onChange={(e) => set({ text: e.target.value })} />
                <SelectField label="Ligar a uma OS (opcional)" hint="Custos ligados a uma OS entram no lucro dela." value={form.os} onChange={(e) => set({ os: e.target.value })}>
                  <option value="">Despesa geral da oficina</option>
                  {osList.map((o) => <option key={o.id} value={o.id}>{o.number}</option>)}
                </SelectField>
              </>
            )}
            {form.tab === "ferramentas" && (
              <>
                <TextField label="Ferramenta" value={form.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} />
                <SelectField label="Mecânico (opcional)" value={form.mechanic} onChange={(e) => set({ mechanic: e.target.value })}>
                  <option value="">Não informar</option>
                  {mechanics.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </SelectField>
                <TextArea label="Observação (opcional)" value={form.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} />
              </>
            )}
            {form.tab === "pessoal" && (
              <>
                <SelectField label="Mecânico" value={form.mechanic} onChange={(e) => set({ mechanic: e.target.value })}>
                  <option value="">Escolha…</option>
                  {mechanics.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </SelectField>
                <SelectField label="Tipo" value={form.kind} onChange={(e) => set({ kind: e.target.value as StaffPaymentKind })}>
                  {STAFF_KIND_ORDER.map((k) => <option key={k} value={k}>{STAFF_KINDS[k]}</option>)}
                </SelectField>
                <TextField label="Mês de referência" type="month" value={form.month} onChange={(e) => set({ month: e.target.value })} />
                <TextArea label="Observação (opcional)" value={form.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} />
              </>
            )}
            {formError && <p className="form-error" role="alert">{formError}</p>}
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={!!del} title="Excluir este registro?" confirmLabel="Excluir" danger busy={busy} onConfirm={remove} onClose={() => setDel(null)}>
        <p>O registro some dos totais. A exclusão fica na auditoria.</p>
      </ConfirmDialog>
    </div>
  );
}
