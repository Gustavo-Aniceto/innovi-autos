-- Ponto da equipe: chegada, saída para o almoço, volta do almoço e saída.
-- A batida grava o horário do SERVIDOR e a distância até a oficina (calculada aqui, não no celular).
-- O ponto nunca é bloqueado pela localização: fora do raio ou sem GPS, fica registrado com alerta.
-- Uso opcional: nada no restante do sistema depende destas tabelas.

create type public.punch_kind as enum ('chegada', 'saida_almoco', 'volta_almoco', 'saida');
create type public.punch_location as enum ('na_oficina', 'fora', 'sem_localizacao', 'manual');

-- Local da oficina (linha única). Só o MasterAdm lê e altera.
create table public.time_clock_settings (
  id         boolean primary key default true check (id),
  latitude   double precision not null check (latitude between -90 and 90),
  longitude  double precision not null check (longitude between -180 and 180),
  radius_m   integer not null default 50 check (radius_m between 20 and 2000),
  address    text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

-- Ponto aproximado do endereço informado; o master confirma o ponto exato pela tela ("Usar minha posição atual").
insert into public.time_clock_settings (latitude, longitude, radius_m, address)
values (-23.468473, -46.55284, 50,
        'Rua Cabo Antônio Pereira da Silva, 210 — Jardim Tranquilidade, Guarulhos/SP, 07051-011');

create table public.time_punches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete restrict,
  work_date       date not null,
  kind            public.punch_kind not null,
  punched_at      timestamptz not null default now(),
  latitude        double precision,
  longitude       double precision,
  accuracy_m      integer check (accuracy_m is null or accuracy_m >= 0),
  distance_m      integer check (distance_m is null or distance_m >= 0),
  location_status public.punch_location not null,
  edit_reason     text check (edit_reason is null or length(btrim(edit_reason)) between 3 and 300),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  unique (user_id, work_date, kind),
  constraint time_punches_manual_reason check (location_status <> 'manual' or edit_reason is not null)
);
create index time_punches_date_idx on public.time_punches (work_date);

do $$
declare t text;
begin
  foreach t in array array['time_clock_settings', 'time_punches'] loop
    execute format('create trigger %I_stamp before insert or update on public.%I for each row execute function public.tg_stamp()', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Escrita só pelas funções abaixo (o horário e a distância não podem vir prontos do celular).
grant select on table public.time_clock_settings to authenticated;
grant select, delete on table public.time_punches to authenticated;

create policy time_clock_settings_master on public.time_clock_settings for select to authenticated
  using ((select public.is_master()));
create policy time_punches_select on public.time_punches for select to authenticated
  using ((select public.is_staff()) and (user_id = (select auth.uid()) or (select public.is_master())));
create policy time_punches_delete on public.time_punches for delete to authenticated
  using ((select public.is_master()));

-- Distância em metros entre dois pontos (haversine).
create or replace function public.geo_distance_m(lat1 double precision, lon1 double precision,
                                                 lat2 double precision, lon2 double precision)
returns integer language sql immutable set search_path = public as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))::integer
$$;

-- Bate o próximo ponto do dia para quem está logado (ou p_kind, para pular etapas: ex. saída sem almoço).
create or replace function public.time_punch(p_lat double precision, p_lng double precision, p_accuracy double precision,
                                             p_kind public.punch_kind default null)
returns public.time_punches language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date := public.finance_today();
  v_kind public.punch_kind;
  v_cfg public.time_clock_settings%rowtype;
  v_dist integer;
  v_status public.punch_location;
  v_row public.time_punches%rowtype;
begin
  if v_uid is null or not public.is_staff() then
    raise exception 'Entre no sistema para bater o ponto.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('ponto:' || v_uid::text));
  -- próximo ponto que ainda falta, na ordem do dia (nunca antes de um ponto já batido)
  select k into v_kind from unnest(enum_range(null::public.punch_kind)) k
   where (p_kind is null or k = p_kind)
     and not exists (select 1 from public.time_punches where user_id = v_uid and work_date = v_day and kind = k)
     and not exists (select 1 from public.time_punches where user_id = v_uid and work_date = v_day and kind > k)
   order by k limit 1;
  if v_kind is null then
    raise exception 'Os pontos de hoje já foram batidos. Se algo ficou errado, fale com o administrador.';
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    v_status := 'sem_localizacao'; p_lat := null; p_lng := null; p_accuracy := null;
  else
    select * into v_cfg from public.time_clock_settings limit 1;
    if not found then
      v_status := 'sem_localizacao';
    else
      v_dist := public.geo_distance_m(p_lat, p_lng, v_cfg.latitude, v_cfg.longitude);
      v_status := case when v_dist <= v_cfg.radius_m then 'na_oficina' else 'fora' end;
    end if;
  end if;

  insert into public.time_punches (user_id, work_date, kind, latitude, longitude, accuracy_m, distance_m, location_status)
  values (v_uid, v_day, v_kind, p_lat, p_lng, least(round(p_accuracy), 100000)::integer, v_dist, v_status)
  returning * into v_row;
  return v_row;
end $$;

-- MasterAdm corrige ou inclui um ponto (motivo obrigatório). Fica marcado como manual e auditado.
create or replace function public.time_punch_admin_save(
  p_user uuid, p_work_date date, p_kind public.punch_kind, p_time time, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_at timestamptz;
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  if p_user is null or p_work_date is null or p_kind is null or p_time is null then
    raise exception 'Informe a pessoa, o dia, o tipo e o horário do ponto.';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Informe o motivo da correção.';
  end if;
  v_at := (p_work_date + p_time) at time zone 'America/Sao_Paulo';
  if v_at > now() + interval '1 minute' then
    raise exception 'O horário do ponto não pode ser no futuro.';
  end if;
  insert into public.time_punches (user_id, work_date, kind, punched_at, location_status, edit_reason)
  values (p_user, p_work_date, p_kind, v_at, 'manual', btrim(p_reason))
  on conflict (user_id, work_date, kind) do update
    set punched_at = excluded.punched_at, location_status = 'manual', edit_reason = excluded.edit_reason,
        latitude = null, longitude = null, accuracy_m = null, distance_m = null
  returning id into v_id;
  return v_id;
end $$;

-- MasterAdm define o local da oficina e o raio aceito.
create or replace function public.time_clock_set_location(p_lat double precision, p_lng double precision, p_radius integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then
    raise exception 'Acesso restrito ao MasterAdm.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Localização inválida.';
  end if;
  if p_radius is null or p_radius not between 20 and 2000 then
    raise exception 'O raio deve ficar entre 20 e 2000 metros.';
  end if;
  insert into public.time_clock_settings (id, latitude, longitude, radius_m) values (true, p_lat, p_lng, p_radius)
  on conflict (id) do update set latitude = excluded.latitude, longitude = excluded.longitude, radius_m = excluded.radius_m;
end $$;

revoke execute on function
  public.geo_distance_m(double precision, double precision, double precision, double precision),
  public.time_punch(double precision, double precision, double precision, public.punch_kind),
  public.time_punch_admin_save(uuid, date, public.punch_kind, time, text),
  public.time_clock_set_location(double precision, double precision, integer)
from public, anon, authenticated;
grant execute on function
  public.time_punch(double precision, double precision, double precision, public.punch_kind),
  public.time_punch_admin_save(uuid, date, public.punch_kind, time, text),
  public.time_clock_set_location(double precision, double precision, integer)
to authenticated;
