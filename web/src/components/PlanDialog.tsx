import { useEffect, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { TextField } from "./Field";
import { brl } from "../lib/data";
import { addMonths, buildSchedule, formatCalendarDate, moneyInput, parseMoney, todayBR } from "../lib/finance";

interface Props {
  open: boolean;
  /** Saldo da OS: sugestão do valor a parcelar. */
  balance: number;
  /** Quantas parcelas ainda não recebidas já existem (elas serão substituídas). */
  replacing: number;
  onSubmit: (total: number, count: number, firstDue: string) => Promise<string | null>;
  onClose: () => void;
}

const PREVIEW_MAX = 12;

export function PlanDialog({ open, balance, replacing, onSubmit, onClose }: Props) {
  const [total, setTotal] = useState("");
  const [count, setCount] = useState("3");
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTotal(balance > 0 ? moneyInput(balance) : "");
    setCount("3");
    setFirst(addMonths(todayBR(), 1));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalN = parseMoney(total);
  const countN = /^\d{1,2}$/.test(count.trim()) ? Number(count.trim()) : NaN;
  const schedule = totalN != null && Number.isInteger(countN) && /^\d{4}-\d{2}-\d{2}$/.test(first) ? buildSchedule(totalN, countN, first) : null;

  async function submit() {
    if (totalN == null || totalN <= 0) { setError("Informe o valor a parcelar."); return; }
    if (!Number.isInteger(countN) || countN < 2 || countN > 60) { setError("Informe de 2 a 60 parcelas."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) { setError("Informe o vencimento da primeira parcela."); return; }
    if (!schedule) { setError("Valor muito pequeno para essa quantidade de parcelas."); return; }
    setBusy(true); setError(null);
    const msg = await onSubmit(totalN, countN, first);
    setBusy(false);
    if (msg) setError(msg);
  }

  return (
    <ConfirmDialog open={open} title="Gerar plano de parcelas" confirmLabel="Gerar parcelas" busy={busy} onConfirm={submit} onClose={onClose}>
      <div className="form">
        <p className="muted small">
          O valor é dividido em parcelas mensais iguais. A entrada, se houver, deve ser registrada como pagamento antes de gerar o plano.
          {replacing > 0 && ` As ${replacing} parcela(s) ainda não recebidas serão substituídas; as já recebidas ficam como estão.`}
        </p>
        <TextField label="Valor a parcelar (R$)" inputMode="decimal" autoComplete="off" value={total}
          onChange={(e) => { setTotal(e.target.value); setError(null); }} hint={balance > 0 ? `Saldo da OS: ${brl(balance)}` : undefined} />
        <div className="grid-2">
          <TextField label="Quantidade de parcelas" inputMode="numeric" autoComplete="off" value={count}
            onChange={(e) => { setCount(e.target.value.replace(/\D/g, "").slice(0, 2)); setError(null); }} />
          <TextField label="Vencimento da 1ª parcela" type="date" value={first} min={todayBR()}
            onChange={(e) => { setFirst(e.target.value); setError(null); }} />
        </div>
        {schedule && (
          <ul className="fin-split" aria-label="Prévia das parcelas">
            {schedule.slice(0, PREVIEW_MAX).map((s) => (
              <li key={s.number}>{s.number}ª, vence em {formatCalendarDate(s.due_date)}: <strong>{brl(s.amount)}</strong></li>
            ))}
            {schedule.length > PREVIEW_MAX && <li>… e mais {schedule.length - PREVIEW_MAX} parcela(s), uma por mês.</li>}
          </ul>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </ConfirmDialog>
  );
}
