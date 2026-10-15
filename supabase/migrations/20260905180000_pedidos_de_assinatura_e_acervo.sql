-- Onde mora o pedido de assinatura enquanto o medico autoriza no celular.
--
-- O fluxo tem um intervalo inevitavel: o sistema pede a permissao a BRy,
-- o medico sai para o VIDaaS, aprova com a digital, e volta. Entre a ida e a
-- volta e preciso lembrar de tres coisas - qual consulta ele foi assinar, qual
-- credencial a BRy devolveu, e ate quando ela vale.
--
-- A credencial guardada aqui e o que autoriza assinar em nome do medico, entao
-- nada disto pode ser lido pelo navegador. A tabela vive em public porque a API
-- do Supabase so enxerga esse schema - mas com RLS ligada e NENHUMA policy,
-- que e a forma mais forte de negar: sem regra, nada passa. A Edge Function
-- entra com service_role, que ignora RLS por definicao.
--
-- Se um dia esta tabela aparecer num select da tela, e bug grave, nao
-- conveniencia.

begin;

create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  requested_by uuid references auth.users (id),
  psc_name text not null default 'Vidaas',
  psc_credential text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  failed_at timestamptz,
  failure_reason text
);

comment on table public.signature_requests is
  'Pedido de assinatura aguardando a autorizacao do medico no PSC. Credencial sensivel: so a Edge Function acessa.';
comment on column public.signature_requests.psc_credential is
  'Token devolvido pela BRy no /psc/link. Autoriza UMA assinatura ate expires_at.';

-- Achar o pedido em aberto de uma consulta sem varrer a tabela.
create index if not exists signature_requests_pendentes_idx
  on public.signature_requests (consultation_id, created_at desc)
  where used_at is null and failed_at is null;

alter table public.signature_requests enable row level security;
alter table public.signature_requests force row level security;

-- Sem policy nenhuma de proposito: com RLS ligada e nenhuma regra, ninguem
-- passa. service_role ignora RLS, entao a Edge Function continua funcionando.
revoke all on table public.signature_requests from public, anon, authenticated;

-- O revoke acima precisa deste grant logo atras.
--
-- "public" no revoke nao e o schema: e o papel generico do Postgres, do qual
-- todos os outros herdam - inclusive o service_role. Revogar dele fecha a
-- tabela ate para a Edge Function, que foi exatamente o que aconteceu na
-- primeira tentativa de assinar: "permission denied for table
-- signature_requests". O acesso do servidor precisa ser dito em voz alta.
grant select, insert, update, delete on table public.signature_requests to service_role;

/**
 * Acervo dos PDFs assinados.
 *
 * Privado. O arquivo assinado tem o atendimento inteiro dentro dele - nome,
 * queixa, exame, conduta - e um link publico seria um vazamento de prontuario
 * a espera de acontecer. Quem precisar ver recebe um link temporario gerado na
 * hora pela funcao.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prontuarios-assinados', 'prontuarios-assinados', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- Caminho do arquivo: <clinic_id>/<consultation_id>.pdf
--
-- A pasta e o id da clinica de proposito: assim a permissao de leitura e uma
-- pergunta simples - "voce e membro desta clinica?" - respondida pelo mesmo
-- helper que o resto do sistema usa.
drop policy if exists "membros leem os assinados da propria clinica" on storage.objects;
create policy "membros leem os assinados da propria clinica"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'prontuarios-assinados'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and private.is_clinic_member(((storage.foldername(name))[1])::uuid)
  );

-- Escrita nao tem policy: o unico que grava aqui e o assinador, com
-- service_role. O navegador poder subir um PDF neste acervo seria o mesmo que
-- deixar qualquer um dizer "este e o documento assinado".

/**
 * Quem assina, como consta no cabecalho do documento.
 *
 * Fica no banco e nao no codigo porque e dado da clinica, nao do programa: se
 * um dia entrar um segundo medico, ou o CRM mudar de estado, ninguem deveria
 * precisar de um programador para corrigir o cabecalho de um documento legal.
 *
 * O CPF continua fora daqui de proposito - ele so serve para o VIDaaS achar o
 * certificado, vive nos segredos da funcao e nunca precisa aparecer na tela.
 */
alter table public.clinic_settings
  add column if not exists signer_name text,
  add column if not exists signer_crm text;

comment on column public.clinic_settings.signer_name is
  'Nome do medico como deve aparecer no documento assinado.';
comment on column public.clinic_settings.signer_crm is
  'CRM como deve aparecer no documento assinado.';

-- Coluna a coluna, como o resto desta tabela. Ja perdemos uma tarde neste
-- projeto com um campo que salvava sem erro e nao mudava nada.
grant update (signer_name, signer_crm) on table public.clinic_settings to authenticated;

-- No sistema do Dr. Marcello aqui vinha o nome e o CRM DELE, gravados em toda
-- clinica com signer_name vazio ("o que hoje e uma clinica so").
--
-- No banco do Dr. Fabio (15/10/2026) esse update saiu; as colunas acima
-- ficam. Este e o nome que vai no documento assinado digitalmente: se a
-- clinica do Dr. Fabio ja existisse quando isto rodasse, o prontuario dele
-- sairia com o nome e o CRM de outro medico. Nome e CRM do Dr. Fabio sao
-- preenchidos em Preferencias. Esta migration ainda nao tinha sido aplicada
-- no banco do Dr. Fabio, entao foi ajustada aqui mesmo; o original esta no
-- repositorio do Dr. Marcello.

commit;
