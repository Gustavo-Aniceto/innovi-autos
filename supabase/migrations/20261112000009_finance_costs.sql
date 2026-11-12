-- Financeiro, etapas 2 a 4: despesas, perdas de ferramenta, pagamentos a mecânicos,
-- lucro por OS e relatórios. Tudo restrito ao MasterAdm (RLS + funções que checam is_master()).

create type public.expense_category as enum (
  'aluguel', 'contas', 'pecas_insumos', 'ferramentas', 'impostos_taxas', 'marketing', 'manutencao', 'outros');
create type public.staff_payment_kind as enum ('salario', 'adiantamento', 'comissao', 'outro');

-- Despesas da oficina. Quando ligada a uma OS (ex.: peça comprada para aquele carro), entra no lucro da OS.
create table public.finance_expenses (
  id               uuid primary key default gen_random_uuid(),
  expense_date     date not null default public.finance_today(),
  category         public.expense_category not null,
  description      text not null check (length(btrim(description)) between 2 and 200),
  amount           numeric(12,2) not null check (amount > 0),
  service_order_id uuid references public.service_orders(id) on delete restrict,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now()
);
create index finance_expenses_date_idx on public.finance_expenses (expense_date);
create index finance_expenses_os_idx   on public.finance_expenses (service_order_id) where service_order_id is not null;

-- Perdas de ferramenta (extravio, quebra), com valor. O mecânico é opcional (só para registro).
create table public.finance_tool_losses (
  id          uuid primary key default gen_random_uuid(),
  loss_date   date not null default public.finance_today(),
  tool_name   text not null check (length(btrim(tool_name)) between 2 and 120),
  amount      numeric(12,2) not null check (amount > 0),
  mechanic_id uuid references public.profiles(id),
  notes       text check (notes is null or length(notes) <= 500),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);
create index finance_tool_losses_date_idx on public.finance_tool_losses (loss_date);

-- Pagamentos aos mecânicos (salário, adiantamento, comissão). reference_month = 1º dia do mês a que se refere.
create table public.finance_staff_payments (
  id              uuid primary key default gen_random_uuid(),
  mechanic_id     uuid not null references public.profiles(id) on delete restrict,
  kind            public.staff_payment_kind not null default 'salario',
  reference_month date not null check (reference_month = date_trunc('month', reference_month::timestamp)::date),
  paid_at         date not null default public.finance_today(),
  amount          numeric(12,2) not null check (amount > 0),
  notes           text check (notes is null or length(notes) <= 500),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now()
);
create index finance_staff_payments_paid_idx on public.finance_staff_payments (paid_at);
create index finance_staff_payments_mech_idx on public.finance_staff_payments (mechanic_id, reference_month);

do $$
declare t text;
begin
  foreach t in array array['finance_expenses', 'finance_tool_losses', 'finance_staff_payments'] loop
    execute format('create trigger %I_stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('create policy %I_master on public.%I for all to authenticated using ((select public.is_master())) with check ((select public.is_master()))', t, t);
  end loop;
end $$;

-- Custo direto por OS (despesas ligadas a ela) e lucro = recebido líquido de taxas - custo.
create or replace function public.finance_os_profit()
returns table (service_order_id uuid, received_net numeric, cost numeric, profit numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  return query
  with ids as (
    select fp.service_order_id as id from public.finance_payments fp
    union select fe.service_order_id from public.finance_expenses fe where fe.service_order_id is not null
  ),
  p as (select fp.service_order_id as id, sum(fp.net_amount) as net from public.finance_payments fp group by 1),
  c as (select fe.service_order_id as id, sum(fe.amount) as cost from public.finance_expenses fe
        where fe.service_order_id is not null group by 1)
  select ids.id, coalesce(p.net, 0), coalesce(c.cost, 0), coalesce(p.net, 0) - coalesce(c.cost, 0)
  from ids left join p on p.id = ids.id left join c on c.id = ids.id;
end $$;

-- Relatório mensal: entradas líquidas e saídas por tipo; resultado = entradas - saídas.
create or replace function public.finance_report_monthly(p_from date, p_to date)
returns table (month date, revenue numeric, expenses numeric, tool_losses numeric, staff numeric, result numeric)
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
  select m::date, r.v, e.v, t.v, s.v, r.v - e.v - t.v - s.v
  from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as m
  cross join lateral (select coalesce(sum(fp.net_amount), 0) as v from public.finance_payments fp
                      where date_trunc('month', fp.paid_at::timestamp) = m) r
  cross join lateral (select coalesce(sum(fe.amount), 0) as v from public.finance_expenses fe
                      where date_trunc('month', fe.expense_date::timestamp) = m) e
  cross join lateral (select coalesce(sum(fl.amount), 0) as v from public.finance_tool_losses fl
                      where date_trunc('month', fl.loss_date::timestamp) = m) t
  cross join lateral (select coalesce(sum(fs.amount), 0) as v from public.finance_staff_payments fs
                      where date_trunc('month', fs.paid_at::timestamp) = m) s
  order by 1;
end $$;

-- Despesas por categoria no período (para o relatório).
create or replace function public.finance_expense_by_category(p_from date, p_to date)
returns table (category public.expense_category, total numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  return query
  select fe.category, sum(fe.amount) from public.finance_expenses fe
  where fe.expense_date between p_from and p_to
  group by 1 order by 2 desc;
end $$;

revoke execute on function
  public.finance_os_profit(), public.finance_report_monthly(date, date),
  public.finance_expense_by_category(date, date)
from public, anon, authenticated;
grant execute on function
  public.finance_os_profit(), public.finance_report_monthly(date, date),
  public.finance_expense_by_category(date, date)
to authenticated;
