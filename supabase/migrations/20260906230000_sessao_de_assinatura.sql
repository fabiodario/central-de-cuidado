-- Sessao de assinatura: uma aprovacao no celular vale por um turno.
--
-- Ate aqui cada atendimento pedia uma ida ao VIDaaS: aba nova, notificacao,
-- digital. Para quem assina dez consultas numa manha, e dez interrupcoes
-- iguais. A BRy oferece o escopo "signature_session": a mesma credencial vale
-- por um periodo, e as assinaturas seguintes passam sem toque no celular.
--
-- Quatro horas por escolha do medico. E o tamanho de um turno; quem sai para
-- almocar aprova de novo a tarde. Mais que isso seria deixar o certificado
-- dele liberado num computador de consultorio por tempo demais.
--
-- A credencial e por usuario, nao por clinica: e o certificado de uma pessoa.

create table if not exists public.signature_sessions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  psc_name text not null default 'Vidaas',
  psc_credential text not null,
  created_at timestamptz not null default now(),
  -- Quando a credencial deixa de valer. Comeca como o pedido; a BRy pode
  -- encurtar, e o valor real e gravado depois da primeira assinatura.
  expires_at timestamptz not null,
  -- Momento em que o medico aprovou no celular. Nulo = ainda nao aprovada.
  ready_at timestamptz,
  revoked_at timestamptz
);

comment on table public.signature_sessions is
  'Credencial da BRy/VIDaaS valida por um periodo. Uma aprovacao no celular cobre varias assinaturas.';

create index if not exists signature_sessions_ativa
  on public.signature_sessions (user_id, created_at desc)
  where revoked_at is null;

-- Mesmo desenho de signature_requests: ninguem le isto pela aplicacao. So a
-- Edge Function, com service_role, que ignora RLS. Sem politica = sem acesso.
alter table public.signature_sessions enable row level security;
alter table public.signature_sessions force row level security;

grant select, insert, update, delete on table public.signature_sessions to service_role;
