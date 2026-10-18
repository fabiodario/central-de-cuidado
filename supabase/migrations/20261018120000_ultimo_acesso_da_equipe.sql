begin;

/**
 * Ultimo acesso de cada pessoa na lista "Quem tem acesso" (18/10/2026, pedido
 * do Edu: ver quem ainda usa o sistema antes de suspender alguem).
 *
 * Funcao separada da listar_acessos_da_clinica, no padrao da casa para dado
 * novo: se esta falhar, a lista de acessos continua de pe.
 *
 * A data e a mais nova entre:
 *  - auth.users.last_sign_in_at: a ultima entrada com senha ou link;
 *  - auth.sessions: a sessao se renova sozinha com o sistema aberto
 *    (refreshed_at, updated_at). So o last_sign_in_at enganaria: quem fica
 *    logado por semanas apareceria com o ultimo acesso de um mes atras.
 * Sair do sistema apaga a sessao; ai vale a ultima entrada.
 *
 * refreshed_at e "timestamp sem fuso", gravado em UTC pelo login do Supabase.
 * A data e da pessoa, nao da clinica: quem tem acesso a duas clinicas aparece
 * com o ultimo acesso em qualquer uma delas.
 */

create or replace function public.ultimos_acessos_da_clinica(p_clinic uuid)
returns table (
  user_id uuid,
  ultimo_acesso timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_clinic_owner(p_clinic) then
    raise exception 'Só o administrador da clínica vê os acessos.' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    greatest(
      u.last_sign_in_at,
      (
        select max(greatest(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at))
        from auth.sessions s
        where s.user_id = m.user_id
      )
    ) as ultimo_acesso
  from public.clinic_memberships m
  left join auth.users u on u.id = m.user_id
  where m.clinic_id = p_clinic;
end;
$$;

revoke all on function public.ultimos_acessos_da_clinica(uuid) from public, anon;
grant execute on function public.ultimos_acessos_da_clinica(uuid) to authenticated;

commit;
