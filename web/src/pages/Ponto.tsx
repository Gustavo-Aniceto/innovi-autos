import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/errors";
import { useAuth } from "../lib/auth";
import { useStaffList } from "../lib/data";
import { addMonths, formatCalendarDate, todayBR } from "../lib/finance";
import {
  PUNCH_LABEL, PUNCH_ORDER, PUNCH_SHORT, formatClock, formatDistance, formatMinutes, geoErrorText, locationText, nextPunch,
  readPosition, workedMinutes, type Punch, type PunchKind,
} from "../lib/ponto";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SelectField, TextField } from "../components/Field";
import { useToast } from "../components/Toast";

interface Settings { latitude: number; longitude: number; radius_m: number; address: string | null }
interface Fixing { user: string; date: string; kind: PunchKind; time: string; reason: string; existing: boolean }

const byKind = (list: Punch[]) => Object.fromEntries(list.map((p) => [p.kind, p])) as Partial<Record<PunchKind, Punch>>;

export function Ponto() {
  const { profile } = useAuth();
  const isMaster = profile?.role === "master";
  const toast = useToast();
  const staff = useStaffList();
  const today = todayBR();

  const [mine, setMine] = useState<Punch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Equipe (só master)
  const [day, setDay] = useState(today);
  const [team, setTeam] = useState<Punch[] | null>(null);
  const [fix, setFix] = useState<Fixing | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const [del, setDel] = useState<Punch | null>(null);
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [radius, setRadius] = useState("50");
  const [cfgBusy, setCfgBusy] = useState(false);
  const [confirmPlace, setConfirmPlace] = useState(false);

  const loadMine = useCallback(async () => {
    if (!profile) return;
    const { data, error: e } = await supabase.from("time_punches").select("*").eq("user_id", profile.id)
      .gte("work_date", addMonths(today, -1)).order("punched_at", { ascending: false });
    if (e) { setError(friendlyError(e)); return; }
    setError(null); setMine(data as Punch[]);
  }, [profile, today]);
  useEffect(() => { loadMine(); }, [loadMine]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  const loadTeam = useCallback(async () => {
    if (!isMaster) return;
    const [p, s] = await Promise.all([
      supabase.from("time_punches").select("*").eq("work_date", day).order("punched_at"),
      supabase.from("time_clock_settings").select("latitude, longitude, radius_m, address").maybeSingle(),
    ]);
    if (p.error || s.error) { setError(friendlyError(p.error ?? s.error)); return; }
    setTeam(p.data as Punch[]);
    const c = s.data as Settings | null;
    setCfg(c); if (c) setRadius(String(c.radius_m));
  }, [isMaster, day]);
  useEffect(() => { loadTeam(); }, [loadTeam]);

  const todayMine = useMemo(() => (mine ?? []).filter((p) => p.work_date === today), [mine, today]);
  const next = nextPunch(todayMine.map((p) => p.kind));
  const history = useMemo(() => {
    const days = new Map<string, Punch[]>();
    (mine ?? []).filter((p) => p.work_date !== today).forEach((p) => days.set(p.work_date, [...(days.get(p.work_date) ?? []), p]));
    return [...days.entries()];
  }, [mine, today]);

  async function punch(kind?: PunchKind) {
    setBusy(true); setNotice(null); setError(null);
    const pos = await readPosition();
    const f = "fix" in pos ? pos.fix : null;
    const { data, error: e } = await supabase.rpc("time_punch", {
      p_lat: f?.lat ?? null, p_lng: f?.lng ?? null, p_accuracy: f?.accuracy ?? null, p_kind: kind ?? null,
    });
    setBusy(false);
    if (e) { setError(friendlyError(e)); return; }
    const row = data as Punch;
    toast("ok", `${PUNCH_LABEL[row.kind]} registrada às ${formatClock(row.punched_at)}.`);
    if (!f && "errorCode" in pos) setNotice(geoErrorText(pos.errorCode));
    else if (row.location_status === "fora") setNotice(`O ponto foi salvo, mas o celular indicou que você está fora da oficina${row.distance_m != null ? ` (a ${formatDistance(row.distance_m)})` : ""}. O administrador verá este aviso.`);
    loadMine(); loadTeam();
  }

  async function saveFix() {
    if (!fix) return;
    if (!/^\d{2}:\d{2}$/.test(fix.time)) { setFixError("Informe o horário (ex.: 08:00)."); return; }
    if (fix.reason.trim().length < 3) { setFixError("Informe o motivo da correção."); return; }
    setBusy(true); setFixError(null);
    const { error: e } = await supabase.rpc("time_punch_admin_save", {
      p_user: fix.user, p_work_date: fix.date, p_kind: fix.kind, p_time: fix.time, p_reason: fix.reason.trim(),
    });
    setBusy(false);
    if (e) { setFixError(friendlyError(e)); return; }
    setFix(null); toast("ok", "Ponto salvo."); loadTeam(); loadMine();
  }

  async function removePunch() {
    if (!del) return;
    setBusy(true);
    const { error: e } = await supabase.from("time_punches").delete().eq("id", del.id);
    setBusy(false); setDel(null);
    if (e) { setError(friendlyError(e)); return; }
    loadTeam(); loadMine();
  }

  async function saveLocation(useHere: boolean) {
    const r = Number(radius);
    if (!Number.isInteger(r) || r < 20 || r > 2000) { setError("O raio deve ficar entre 20 e 2000 metros."); return; }
    setCfgBusy(true); setError(null);
    let lat = cfg?.latitude, lng = cfg?.longitude;
    if (useHere) {
      const pos = await readPosition(20000);
      if (!("fix" in pos)) { setCfgBusy(false); setConfirmPlace(false); setError("Não foi possível ler a localização deste aparelho. Permita a localização no navegador e tente de novo."); return; }
      lat = pos.fix.lat; lng = pos.fix.lng;
    }
    if (lat == null || lng == null) { setCfgBusy(false); setError("Defina o local usando a posição atual."); return; }
    const { error: e } = await supabase.rpc("time_clock_set_location", { p_lat: lat, p_lng: lng, p_radius: r });
    setCfgBusy(false); setConfirmPlace(false);
    if (e) { setError(friendlyError(e)); return; }
    toast("ok", useHere ? "Local da oficina atualizado para a posição deste aparelho." : "Raio atualizado."); loadTeam();
  }

  const people = useMemo(() => staff.filter((s) => s.active || (team ?? []).some((p) => p.user_id === s.id)), [staff, team]);
  const alerts = (team ?? []).filter((p) => p.location_status === "fora" || p.location_status === "sem_localizacao").length;

  return (
    <div className="page">
      <header className="page-head"><h1>Ponto</h1></header>
      {error && <p className="form-error" role="alert">{error}</p>}

      <section className="panel" aria-labelledby="h-ponto-hoje">
        <h2 id="h-ponto-hoje" className="section-title">Hoje, {formatCalendarDate(today)}</h2>
        <ol className="ponto-steps">
          {PUNCH_ORDER.map((k) => {
            const p = byKind(todayMine)[k];
            return (
              <li key={k} className={p ? "done" : k === next ? "next" : ""}>
                <span className="ponto-step-label">{PUNCH_LABEL[k]}</span>
                {p ? (
                  <span><strong>{formatClock(p.punched_at)}</strong> <span className={`badge badge-${locationText(p).tone}`}>{locationText(p).label}</span></span>
                ) : <span className="muted">—</span>}
              </li>
            );
          })}
        </ol>
        {mine && next && (
          <div className="ponto-actions">
            <button className="btn btn-primary ponto-btn" disabled={busy} onClick={() => punch()}>
              {busy ? "Registrando…" : `Bater ponto: ${PUNCH_LABEL[next]}`}
            </button>
            {next === "saida_almoco" && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => punch("saida")}>Ir embora sem almoço (bater Saída)</button>
            )}
          </div>
        )}
        {mine && !next && <p className="notice">Ponto de hoje completo. Trabalhado: <strong>{formatMinutes(workedMinutes(todayMine))}</strong></p>}
        {mine && next && todayMine.length > 0 && <p className="muted small">Trabalhado até agora: {formatMinutes(workedMinutes(todayMine, now))}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <p className="muted small">O celular pede sua localização só no momento da batida, para confirmar que você está na oficina. O horário é o do sistema.</p>
      </section>

      <section aria-labelledby="h-ponto-hist">
        <h2 id="h-ponto-hist" className="section-title">Meus últimos 30 dias</h2>
        {mine && history.length === 0 && <p className="empty">Nenhum ponto em dias anteriores.</p>}
        {history.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Dia</th>{PUNCH_ORDER.map((k) => <th key={k}>{PUNCH_SHORT[k]}</th>)}<th>Trabalhado</th></tr></thead>
              <tbody>
                {history.map(([d, list]) => (
                  <tr key={d}>
                    <td className="nowrap">{formatCalendarDate(d)}</td>
                    {PUNCH_ORDER.map((k) => <td key={k}>{byKind(list)[k] ? formatClock(byKind(list)[k]!.punched_at) : "—"}</td>)}
                    <td>{formatMinutes(workedMinutes(list))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isMaster && (
        <>
          <section aria-labelledby="h-ponto-equipe">
            <h2 id="h-ponto-equipe" className="section-title">Equipe {alerts > 0 && <span className="badge badge-stop">{alerts} com alerta</span>}</h2>
            <div className="filters">
              <TextField label="Dia" type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Pessoa</th>{PUNCH_ORDER.map((k) => <th key={k}>{PUNCH_SHORT[k]}</th>)}<th>Trabalhado</th></tr></thead>
                <tbody>
                  {people.map((s) => {
                    const list = (team ?? []).filter((p) => p.user_id === s.id);
                    const m = byKind(list);
                    return (
                      <tr key={s.id}>
                        <td>{s.full_name}</td>
                        {PUNCH_ORDER.map((k) => {
                          const p = m[k];
                          return (
                            <td key={k}>
                              <button className="btn btn-link ponto-cell" title={p?.edit_reason ? `Motivo: ${p.edit_reason}` : "Corrigir ou incluir"}
                                onClick={() => { setFixError(null); setFix({ user: s.id, date: day, kind: k, time: p ? formatClock(p.punched_at) : "", reason: "", existing: !!p }); }}>
                                {p ? formatClock(p.punched_at) : "incluir"}
                              </button>
                              {p && p.location_status !== "na_oficina" && <span className={`badge badge-${locationText(p).tone}`}>{locationText(p).label}</span>}
                              {p && p.accuracy_m != null && p.location_status === "fora" && <span className="muted small"> precisão ±{p.accuracy_m} m</span>}
                            </td>
                          );
                        })}
                        <td>{formatMinutes(workedMinutes(list, day === today ? now : undefined))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small">Toque em um horário para corrigir, ou em "incluir" para lançar um ponto esquecido. Toda correção pede motivo e fica na auditoria.</p>
          </section>

          <section className="panel" aria-labelledby="h-ponto-local">
            <h2 id="h-ponto-local" className="section-title">Local da oficina</h2>
            {cfg ? (
              <p>{cfg.address ?? "Local definido pelo aparelho do administrador."} <span className="muted small">({cfg.latitude.toFixed(5)}, {cfg.longitude.toFixed(5)})</span></p>
            ) : <p className="empty">Local ainda não definido.</p>}
            <div className="filters">
              <TextField label="Raio aceito (metros)" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              <button className="btn btn-secondary" disabled={cfgBusy || !cfg} onClick={() => saveLocation(false)}>Salvar raio</button>
              <button className="btn btn-secondary" disabled={cfgBusy} onClick={() => setConfirmPlace(true)}>Usar minha posição atual</button>
            </div>
            <p className="muted small">Para o ponto ficar exato, toque em "Usar minha posição atual" estando dentro da oficina, de preferência perto do meio do galpão.</p>
          </section>
        </>
      )}

      <ConfirmDialog open={!!fix} title={fix ? `${fix.existing ? "Corrigir" : "Incluir"}: ${PUNCH_LABEL[fix.kind]}` : ""} confirmLabel="Salvar" busy={busy}
        onConfirm={saveFix} onClose={() => setFix(null)}>
        {fix && (
          <div className="form">
            <p className="muted small">{staff.find((s) => s.id === fix.user)?.full_name} — {formatCalendarDate(fix.date)}</p>
            <SelectField label="Ponto" value={fix.kind} onChange={(e) => setFix({ ...fix, kind: e.target.value as PunchKind })}>
              {PUNCH_ORDER.map((k) => <option key={k} value={k}>{PUNCH_LABEL[k]}</option>)}
            </SelectField>
            <TextField label="Horário" type="time" value={fix.time} onChange={(e) => setFix({ ...fix, time: e.target.value })} />
            <TextField label="Motivo da correção" value={fix.reason} maxLength={300} onChange={(e) => setFix({ ...fix, reason: e.target.value })} />
            {fixError && <p className="form-error" role="alert">{fixError}</p>}
            {fix.existing && (
              <button type="button" className="btn btn-danger-ghost btn-sm"
                onClick={() => { const p = (team ?? []).find((x) => x.user_id === fix.user && x.kind === fix.kind); setFix(null); if (p) setDel(p); }}>
                Excluir este ponto
              </button>
            )}
          </div>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={!!del} title="Excluir este ponto?" confirmLabel="Excluir" danger busy={busy} onConfirm={removePunch} onClose={() => setDel(null)}>
        <p>O ponto é apagado e a exclusão fica na auditoria.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirmPlace} title="Definir o local da oficina aqui?" confirmLabel="Usar esta posição" busy={cfgBusy}
        onConfirm={() => saveLocation(true)} onClose={() => setConfirmPlace(false)}>
        <p>O local passa a ser a posição atual deste aparelho. Faça isso somente estando dentro da oficina.</p>
      </ConfirmDialog>
    </div>
  );
}
