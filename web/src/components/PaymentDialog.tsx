import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { TextArea, TextField } from "./Field";
import { brl } from "../lib/data";
import {
  METHOD_ORDER, PAYMENT_METHODS, feeFromPercent, isCard, moneyInput, parseMoney, round2, todayBR, validatePayment,
  type PaymentMethod,
} from "../lib/finance";

export interface PaymentValues {
  amount: number; method: PaymentMethod; paid_at: string; card_fee_amount: number; card_installments: number | null; notes: string | null;
}
export interface PaymentInitial {
  amount?: number; method?: PaymentMethod; paid_at?: string; card_fee_amount?: number; card_installments?: number | null; notes?: string | null;
}

interface Draft { amount: string; method: PaymentMethod; paid_at: string; fee: string; feeUnit: "reais" | "pct"; installments: string; notes: string }

const toDraft = (i: PaymentInitial): Draft => ({
  amount: i.amount != null ? moneyInput(i.amount) : "", method: i.method ?? "pix", paid_at: i.paid_at ?? todayBR(),
  fee: i.card_fee_amount ? moneyInput(i.card_fee_amount) : "", feeUnit: "reais",
  installments: i.card_installments ? String(i.card_installments) : "", notes: i.notes ?? "",
});

function read(d: Draft): { values: PaymentValues } | { error: string } {
  const amount = parseMoney(d.amount);
  if (amount == null || amount <= 0) return { error: "Informe o valor recebido (ex.: 350,00)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.paid_at)) return { error: "Informe a data do pagamento." };
  if (d.paid_at > todayBR()) return { error: "A data do pagamento não pode ser futura." };
  let fee = 0;
  if (isCard(d.method) && d.fee.trim() !== "") {
    const f = d.feeUnit === "pct" ? feeFromPercent(amount, d.fee) : parseMoney(d.fee);
    if (f == null) return { error: "Taxa inválida. Use apenas números, ex.: 2,99." };
    fee = f;
  }
  let inst: number | null = null;
  if (d.method === "credito" && d.installments.trim() !== "") {
    if (!/^\d{1,2}$/.test(d.installments.trim())) return { error: "Parcelas do cartão: informe um número de 1 a 24." };
    inst = Number(d.installments.trim());
  }
  if (d.notes.length > 500) return { error: "A observação pode ter até 500 caracteres." };
  const bad = validatePayment({ amount, method: d.method, fee, installments: inst });
  if (bad) return { error: bad };
  return { values: { amount, method: d.method, paid_at: d.paid_at, card_fee_amount: fee, card_installments: inst, notes: d.notes.trim() || null } };
}

interface Props {
  open: boolean;
  title: string;
  confirmLabel: string;
  initial: PaymentInitial;
  /** Texto de apoio acima do formulário. */
  note?: string;
  /** Faz o pedido ao servidor. Devolva a mensagem de erro, ou null se deu certo (o pai fecha o diálogo). */
  onSubmit: (v: PaymentValues) => Promise<string | null>;
  onClose: () => void;
}

export function PaymentDialog({ open, title, confirmLabel, initial, note, onSubmit, onClose }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Só reinicia o formulário quando o diálogo abre (o objeto "initial" muda a cada renderização do pai).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setD(toDraft(initial)); setError(null); } }, [open]);

  const parsed = read(d);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); setError(null); };

  async function submit() {
    const r = read(d);
    if ("error" in r) { setError(r.error); return; }
    setBusy(true); setError(null);
    const msg = await onSubmit(r.values);
    setBusy(false);
    if (msg) setError(msg);
  }

  const v = "values" in parsed ? parsed.values : null;
  return (
    <ConfirmDialog open={open} title={title} confirmLabel={confirmLabel} busy={busy} onConfirm={submit} onClose={onClose}>
      <div className="form">
        {note && <p className="muted small">{note}</p>}
        <TextField label="Valor recebido (R$)" inputMode="decimal" autoComplete="off" value={d.amount} placeholder="0,00"
          onChange={(e) => set("amount", e.target.value)} />
        <fieldset>
          <legend className="legend">Forma de pagamento</legend>
          <div className="seg" role="radiogroup" aria-label="Forma de pagamento">
            {METHOD_ORDER.map((m) => (
              <label key={m} className={d.method === m ? "on" : ""}>
                <input type="radio" name="forma" value={m} checked={d.method === m} onChange={() => set("method", m)} />{PAYMENT_METHODS[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField label="Data do pagamento" type="date" value={d.paid_at} max={todayBR()} onChange={(e) => set("paid_at", e.target.value)} />

        {isCard(d.method) && (
          <>
            <div className="grid-2">
              <TextField label={d.feeUnit === "pct" ? "Taxa da maquininha (%)" : "Taxa da maquininha (R$)"} inputMode="decimal" autoComplete="off"
                value={d.fee} placeholder={d.feeUnit === "pct" ? "Ex.: 2,99" : "0,00"} hint="Opcional. Sem taxa, vale o valor cobrado."
                onChange={(e) => set("fee", e.target.value)} />
              <div className="field">
                <label htmlFor="pay-fee-unit">Informar taxa em</label>
                <select id="pay-fee-unit" value={d.feeUnit} onChange={(e) => set("feeUnit", e.target.value as Draft["feeUnit"])}>
                  <option value="reais">Reais (R$)</option><option value="pct">Porcentagem (%)</option>
                </select>
              </div>
            </div>
            {d.method === "credito" && (
              <TextField label="Parcelas no cartão (informativo)" inputMode="numeric" autoComplete="off" value={d.installments} placeholder="Ex.: 3"
                hint="A oficina recebe o valor de uma vez; isto só registra como o cliente pagou."
                onChange={(e) => set("installments", e.target.value.replace(/\D/g, "").slice(0, 2))} />
            )}
            {v && v.card_fee_amount > 0 && (
              <p className="notice">Taxa de {brl(v.card_fee_amount)}. Entra no caixa: <strong>{brl(round2(v.amount - v.card_fee_amount))}</strong></p>
            )}
          </>
        )}

        <TextArea label="Observação (opcional)" value={d.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </ConfirmDialog>
  );
}
