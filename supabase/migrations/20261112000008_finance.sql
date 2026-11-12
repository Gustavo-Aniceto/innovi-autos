-- =====================================================================
-- INNOVI AUTOS — Migração 8: Financeiro (etapa 1)
-- Área EXCLUSIVA do MasterAdm: pagamentos, parcelas e visão por OS.
-- Não altera nenhuma tabela existente. Toda permissão é validada aqui (RLS + funções).
-- =====================================================================

create type public.payment_method as enum ('pix', 'dinheiro', 'debito', 'credito');

-- ---------- Pagamentos recebidos ----------
create table public.finance_payments (
  id                uuid primary key default gen_random_uuid(),
  service_order_id  uuid not null references public.service_orders(id) on delete restrict,
  paid_at           date not null default current_date,
  method            public.payment_method not null,
  amount            numeric(12,2) not null check (amount > 0),                       -- valor cobrado (bruto)
  card_fee_amount   numeric(12,2) not null default 0 check (card_fee_amount >= 0),   -- taxa da maquininha em R$
  net_amount        numeric(12,2) generated always as (amount - card_fee_amount) stored,
  card_installments smallint check (card_installments between 1 and 24),             -- informativo (crédito)
  notes             text check (notes is null or length(notes) <= 500),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  constraint finance_payments_fee_le_amount check (card_fee_amount <= amount),
  constraint finance_payments_fee_only_card check (card_fee_amount = 0 or method in ('debito', 'credito')),
  constraint finance_payments_inst_only_credit check (card_installments is null or method = 'credito')
);
create index finance_payments_os_idx   on public.finance_payments (service_order_id);
create index finance_payments_date_idx on public.finance_payments (paid_at);

-- ---------- Parcelas previstas (cliente paga a oficina em vários meses) ----------
create table public.finance_installments (
  id               uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete restrict,
  number           smallint not null check (number > 0),
  due_date         date not null,
  amount           numeric(12,2) not null check (amount > 0),
  payment_id       uuid unique references public.finance_payments(id) on delete set null,  -- preenchido na baixa
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  unique (service_order_id, number)
);
create index finance_installments_os_idx  on public.finance_installments (service_order_id);
create index finance_installments_due_idx on public.finance_installments (due_date) where payment_id is null;

-- ---------- Versões de orçamento que contam no valor da OS (nulo = só a última aprovada) ----------
create table public.finance_os_settings (
  id                uuid primary key default gen_random_uuid(),
  service_order_id  uuid not null unique references public.service_orders(id) on delete cascade,
  counted_quote_ids uuid[],
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now()
);

-- ---------- Regras de consistência ----------
create or replace function public.tg_finance_installment_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_id is not null and
     (select service_order_id from public.finance_payments where id = new.payment_id) is distinct from new.service_order_id then
    raise exception 'O pagamento da baixa pertence a outra OS.';
  end if;
  return new;
end $$;
create trigger finance_installments_check before insert or update on public.finance_installments
  for each row execute function public.tg_finance_installment_check();

create or replace function public.tg_finance_settings_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.counted_quote_ids is not null and exists (
    select 1 from unnest(new.counted_quote_ids) as qid
    where not exists (select 1 from public.quotes q
                      where q.id = qid and q.service_order_id = new.service_order_id and q.status = 'aprovado')) then
    raise exception 'Só versões de orçamento aprovadas desta OS podem contar no valor.';
  end if;
  return new;
end $$;
create trigger finance_os_settings_check before insert or update on public.finance_os_settings
  for each row execute function public.tg_finance_settings_check();

-- Autoria e auditoria (mesmo padrão das demais tabelas)
do $$
declare t text;
begin
  foreach t in array array['finance_payments', 'finance_installments', 'finance_os_settings'] loop
    execute format('create trigger %I_stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t, t);
  end loop;
end $$;

-- ---------- Acesso: somente MasterAdm (RLS) ----------
revoke all on table public.finance_payments, public.finance_installments, public.finance_os_settings from anon, authenticated;
grant select, insert, update, delete on table
  public.finance_payments, public.finance_installments, public.finance_os_settings to authenticated;

alter table public.finance_payments     enable row level security;
alter table public.finance_installments enable row level security;
alter table public.finance_os_settings  enable row level security;

create policy finance_payments_master on public.finance_payments for all to authenticated
  using ((select public.is_master())) with check ((select public.is_master()));
create policy finance_installments_master on public.finance_installments for all to authenticated
  using ((select public.is_master())) with check ((select public.is_master()));
create policy finance_os_settings_master on public.finance_os_settings for all to authenticated
  using ((select public.is_master())) with check ((select public.is_master()));

-- ---------- Valor devido de uma OS (uso interno; não exposta) ----------
create or replace function public.finance_os_due(p_os uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(t.total), 0)
  from (
    select q.id, q.version, s.counted_quote_ids,
           greatest(coalesce((select sum(i.total) from public.quote_items i
                              where i.quote_id = q.id and i.approved), 0) - q.discount_amount, 0) as total
    from public.quotes q
    left join public.finance_os_settings s on s.service_order_id = q.service_order_id
    where q.service_order_id = p_os and q.status = 'aprovado'
  ) t
  where (t.counted_quote_ids is not null and t.id = any (t.counted_quote_ids))
     or (t.counted_quote_ids is null and t.version = (select max(q2.version) from public.quotes q2
                                                      where q2.service_order_id = p_os and q2.status = 'aprovado'))
$$;

-- ---------- Visão geral por OS (somente MasterAdm) ----------
create or replace function public.finance_os_overview()
returns table (
  service_order_id uuid, number text, customer_name text, plate text, os_status public.os_status,
  opened_at timestamptz, amount_due numeric, amount_paid numeric, amount_net numeric, balance numeric,
  pending_installments numeric, overdue_installments numeric, next_due date, situation text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  return query
  select o.id, o.number, c.full_name, v.plate, o.status, o.opened_at,
         d.due,
         coalesce(p.gross, 0), coalesce(p.net, 0),
         greatest(d.due - coalesce(p.gross, 0), 0),
         coalesce(i.pending, 0), coalesce(i.overdue, 0), i.next_due,
         case when d.due = 0 and coalesce(p.gross, 0) = 0 then 'sem_valor'
              when coalesce(p.gross, 0) = 0 then 'sem_pagamento'
              when coalesce(p.gross, 0) >= d.due then 'quitada'
              else 'parcial' end
  from public.service_orders o
  join public.customers c on c.id = o.customer_id
  join public.vehicles v on v.id = o.vehicle_id
  cross join lateral (select public.finance_os_due(o.id) as due) d
  left join lateral (select sum(fp.amount) as gross, sum(fp.net_amount) as net
                     from public.finance_payments fp where fp.service_order_id = o.id) p on true
  left join lateral (select sum(fi.amount) filter (where fi.payment_id is null) as pending,
                            sum(fi.amount) filter (where fi.payment_id is null and fi.due_date < current_date) as overdue,
                            min(fi.due_date) filter (where fi.payment_id is null) as next_due
                     from public.finance_installments fi where fi.service_order_id = o.id) i on true
  where d.due > 0 or p.gross is not null
  order by o.opened_at desc;
end $$;

-- ---------- Recebido e a receber por mês (somente MasterAdm) ----------
create or replace function public.finance_monthly(p_from date, p_to date)
returns table (month date, received numeric, received_net numeric, expected numeric, overdue numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 1830 then
    raise exception 'Período inválido (máximo de 5 anos).';
  end if;
  return query
  select m::date,
         coalesce((select sum(fp.amount) from public.finance_payments fp
                   where date_trunc('month', fp.paid_at::timestamp) = m), 0),
         coalesce((select sum(fp.net_amount) from public.finance_payments fp
                   where date_trunc('month', fp.paid_at::timestamp) = m), 0),
         coalesce((select sum(fi.amount) from public.finance_installments fi
                   where fi.payment_id is null and fi.due_date >= current_date
                     and date_trunc('month', fi.due_date::timestamp) = m), 0),
         coalesce((select sum(fi.amount) from public.finance_installments fi
                   where fi.payment_id is null and fi.due_date < current_date
                     and date_trunc('month', fi.due_date::timestamp) = m), 0)
  from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as m
  order by 1;
end $$;

-- ---------- Gera o plano de parcelas (atômico). Substitui só as parcelas ainda não recebidas ----------
create or replace function public.finance_create_installment_plan(
  p_os uuid, p_total numeric, p_count int, p_first_due date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_start int; v_base numeric; v_rest numeric; i int;
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  if p_total is null or p_total <= 0 or p_count is null or p_count not between 2 and 60 or p_first_due is null then
    raise exception 'Informe valor, quantidade de parcelas (2 a 60) e o primeiro vencimento.';
  end if;
  if not exists (select 1 from public.service_orders where id = p_os) then
    raise exception 'OS não encontrada.';
  end if;
  v_base := trunc(p_total / p_count, 2);
  if v_base <= 0 then raise exception 'Valor muito pequeno para essa quantidade de parcelas.'; end if;
  v_rest := p_total - v_base * p_count;

  delete from public.finance_installments where service_order_id = p_os and payment_id is null;
  select coalesce(max(number), 0) into v_start from public.finance_installments where service_order_id = p_os;
  for i in 1..p_count loop
    insert into public.finance_installments (service_order_id, number, due_date, amount)
    values (p_os, v_start + i, (p_first_due + make_interval(months => i - 1))::date,
            v_base + case when i = p_count then v_rest else 0 end);
  end loop;
  return p_count;
end $$;

-- ---------- Dá baixa numa parcela: cria o pagamento e liga à parcela (atômico) ----------
create or replace function public.finance_receive_installment(
  p_installment uuid, p_method public.payment_method, p_paid_at date,
  p_amount numeric, p_card_fee numeric, p_card_installments smallint, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inst public.finance_installments%rowtype;
  v_payment uuid;
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  select * into v_inst from public.finance_installments where id = p_installment for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;
  if v_inst.payment_id is not null then raise exception 'Esta parcela já foi recebida.'; end if;

  insert into public.finance_payments (service_order_id, paid_at, method, amount, card_fee_amount, card_installments, notes)
  values (v_inst.service_order_id, coalesce(p_paid_at, current_date), p_method,
          coalesce(p_amount, v_inst.amount), coalesce(p_card_fee, 0), p_card_installments, p_notes)
  returning id into v_payment;

  update public.finance_installments set payment_id = v_payment where id = p_installment;
  return v_payment;
end $$;

-- ---------- Permissões das funções (ver migração 5): só usuário logado; cada função confere o master ----------
revoke execute on function
  public.finance_os_due(uuid), public.finance_os_overview(), public.finance_monthly(date, date),
  public.finance_create_installment_plan(uuid, numeric, int, date),
  public.finance_receive_installment(uuid, public.payment_method, date, numeric, numeric, smallint, text),
  public.tg_finance_installment_check(), public.tg_finance_settings_check()
from public, anon, authenticated;
grant execute on function
  public.finance_os_overview(), public.finance_monthly(date, date),
  public.finance_create_installment_plan(uuid, numeric, int, date),
  public.finance_receive_installment(uuid, public.payment_method, date, numeric, numeric, smallint, text)
to authenticated;
