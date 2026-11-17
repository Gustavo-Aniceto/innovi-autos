-- Versões de orçamento são ACRÉSCIMOS (cada nova versão começa vazia: "serviços adicionais exigem nova versão").
-- Sem escolha do MasterAdm, o valor da OS passa a ser a soma de todas as versões aprovadas
-- (antes era só a última, o que deixava de fora peças/serviços aprovados em versões anteriores).
create or replace function public.finance_os_due(p_os uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(t.total), 0)
  from (
    select q.id, s.counted_quote_ids,
           greatest(coalesce((select sum(i.total) from public.quote_items i
                              where i.quote_id = q.id and i.approved), 0) - q.discount_amount, 0) as total
    from public.quotes q
    left join public.finance_os_settings s on s.service_order_id = q.service_order_id
    where q.service_order_id = p_os and q.status = 'aprovado'
  ) t
  where t.counted_quote_ids is null or t.id = any (t.counted_quote_ids)
$$;
revoke execute on function public.finance_os_due(uuid) from public, anon, authenticated;
