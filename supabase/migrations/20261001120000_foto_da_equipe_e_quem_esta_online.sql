begin;

/**
 * Foto da equipe e "quem esta online" (01/10/2026).
 *
 * Pedido do Edu: no topo da tela, a fotinho de quem esta com a Central aberta
 * (iniciais quando nao tem foto), clicavel para trocar a propria. E um painel
 * "Administracao" que so o responsavel pelo sistema ve, com a chave que liga
 * ou desliga isso POR CLINICA - "para o Dr. Marcello da para liberar, medicos
 * mais chatos nao".
 *
 * Ligado: todos da clinica se veem. Desligado: ninguem ve ninguem (cada um ve
 * so a propria foto, para poder troca-la).
 *
 * A chave vale no SERVIDOR, nao so na tela: a presenca roda num canal privado
 * do Realtime ("presenca:<clinic_id>"), e as politicas em realtime.messages
 * so deixam entrar membro ativo da clinica com a chave ligada. Quem tentar
 * entrar com ela desligada recebe recusa, mesmo mexendo no navegador.
 *
 * As colunas novas sao lidas pela tela em consulta separada, com try/catch:
 * a funcao sobe antes desta migration, e a falta delas custa a foto, nao o
 * sistema.
 */

-- 1. A foto. Caminho no bucket, nao URL: o bucket e privado e a tela pede um
--    link temporario para mostrar.
alter table public.profiles add column if not exists avatar_path text;

alter table public.profiles drop constraint if exists profiles_avatar_path_formato;
alter table public.profiles add constraint profiles_avatar_path_formato
  check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-da-equipe', 'fotos-da-equipe', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Caminho: <user_id>/<arquivo>. Cada um mexe so na propria pasta; ver, quem
-- divide clinica ativa com a pessoa (o mesmo criterio de ler o nome dela em
-- profiles).
drop policy if exists "fotos da equipe: ver de colegas" on storage.objects;
create policy "fotos da equipe: ver de colegas"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'fotos-da-equipe'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or private.shares_active_clinic(((storage.foldername(name))[1])::uuid)
    )
  );

drop policy if exists "fotos da equipe: subir a propria" on storage.objects;
create policy "fotos da equipe: subir a propria"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'fotos-da-equipe'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "fotos da equipe: trocar a propria" on storage.objects;
create policy "fotos da equipe: trocar a propria"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'fotos-da-equipe' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'fotos-da-equipe' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "fotos da equipe: apagar a propria" on storage.objects;
create policy "fotos da equipe: apagar a propria"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'fotos-da-equipe' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 2. A chave, por clinica. Desligada por padrao: cada clinica nova comeca sem.
alter table public.clinic_settings add column if not exists presenca_ligada boolean not null default false;

create or replace function public.sou_responsavel_pelo_sistema()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.e_responsavel_pelo_sistema(auth.uid());
$$;

revoke all on function public.sou_responsavel_pelo_sistema() from public, anon;
grant execute on function public.sou_responsavel_pelo_sistema() to authenticated;

create or replace function public.presenca_ligada(p_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.presenca_ligada
      from public.clinic_settings s
     where s.clinic_id = p_clinic
       and private.is_clinic_member(p_clinic)
  ), false);
$$;

revoke all on function public.presenca_ligada(uuid) from public, anon;
grant execute on function public.presenca_ligada(uuid) to authenticated;

create or replace function public.definir_presenca_ligada(p_clinic uuid, p_ligada boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.e_responsavel_pelo_sistema(auth.uid()) then
    raise exception 'Só o responsável pelo sistema muda esta opção.' using errcode = '42501';
  end if;
  if not private.is_clinic_member(p_clinic) then
    raise exception 'Sem acesso a esta clínica.' using errcode = '42501';
  end if;

  update public.clinic_settings set presenca_ligada = p_ligada where clinic_id = p_clinic;
  if not found then
    raise exception 'Clínica sem configurações.' using errcode = 'P0002';
  end if;
  return p_ligada;
end
$$;

revoke all on function public.definir_presenca_ligada(uuid, boolean) from public, anon;
grant execute on function public.definir_presenca_ligada(uuid, boolean) to authenticated;

-- 3. O canal de presenca. So membro ativo, so com a chave ligada.
create or replace function private.pode_usar_presenca(p_topico text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.clinic_memberships m
      join public.clinic_settings s on s.clinic_id = m.clinic_id
     where 'presenca:' || m.clinic_id::text = p_topico
       and m.user_id = auth.uid()
       and m.status = 'active'::public.membership_status
       and s.presenca_ligada
  );
$$;

revoke all on function private.pode_usar_presenca(text) from public, anon;
grant execute on function private.pode_usar_presenca(text) to authenticated;

drop policy if exists "presenca: ver colegas da clinica" on realtime.messages;
create policy "presenca: ver colegas da clinica"
  on realtime.messages for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and private.pode_usar_presenca((select realtime.topic()))
  );

drop policy if exists "presenca: aparecer para colegas da clinica" on realtime.messages;
create policy "presenca: aparecer para colegas da clinica"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and private.pode_usar_presenca((select realtime.topic()))
  );

commit;
