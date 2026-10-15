-- Prescricao digital pela Memed.
--
-- A Memed nao substitui o prontuario: ela e a tela de prescricao, com a base de
-- medicamentos, os alertas de interacao e a rede de farmacias que reconhece o
-- documento. O prontuario continua sendo daqui. O que esta migration faz e
-- preparar o terreno para os dois conversarem.

begin;

/**
 * CPF e e-mail do paciente.
 *
 * O CPF nao e capricho da Memed: a RDC 1000/25, em vigor desde 13/02/2026,
 * exige CPF e data de nascimento em toda prescricao. Sem eles a emissao e
 * recusada na validacao.
 *
 * Em pediatria o CPF e o DA CRIANCA, nao o do responsavel - e um dado que a
 * recepcao passa a precisar pedir. Fica opcional na coluna de proposito: o
 * cadastro nao pode travar por falta dele, mas a tela de prescricao avisa
 * quando faltar, que e onde a falta realmente importa.
 */
alter table public.patients
  add column if not exists cpf text,
  add column if not exists email text;

comment on column public.patients.cpf is
  'CPF do proprio paciente. Exigido pela RDC 1000/25 para emitir prescricao.';
comment on column public.patients.email is
  'E-mail do paciente ou do responsavel. A Memed usa para enviar a receita.';

-- Coluna a coluna, como o resto desta tabela.
grant update (cpf, email) on table public.patients to authenticated;
grant insert (cpf, email) on table public.patients to authenticated;

/**
 * Dados do prescritor exigidos pela Memed.
 *
 * Ficam ao lado de signer_name e signer_crm, que a assinatura digital ja usa:
 * e a mesma pessoa, descrita para dois servicos diferentes.
 */
alter table public.clinic_settings
  add column if not exists prescriber_email text,
  add column if not exists prescriber_birth_date date,
  add column if not exists prescriber_specialty_id integer,
  add column if not exists prescriber_city_id integer,
  add column if not exists memed_prescritor_criado_em timestamptz;

comment on column public.clinic_settings.memed_prescritor_criado_em is
  'Quando o prescritor foi criado por esta integracao. Nulo quando a conta ja existia na Memed.';

comment on column public.clinic_settings.prescriber_specialty_id is
  'Id da especialidade na Memed (GET /v1/especialidades).';
comment on column public.clinic_settings.prescriber_city_id is
  'Id da cidade na Memed (GET /v1/cidades).';

grant update (prescriber_email, prescriber_birth_date, prescriber_specialty_id, prescriber_city_id)
  on table public.clinic_settings to authenticated;

/**
 * As receitas emitidas, guardadas junto do atendimento.
 *
 * A Memed guarda a receita do lado dela e devolve um link. Guardar so o link
 * seria confiar o prontuario a um servico externo: se a integracao acabar, ou o
 * link mudar, o atendimento fica sem o que foi prescrito. Por isso os itens
 * vem junto, em texto - e o que o medico precisa reler daqui a dois anos.
 *
 * A exclusao e registrada, e nao apagada: a Memed permite o prescritor apagar
 * uma receita, e um link morto no prontuario sem explicacao parece defeito do
 * sistema. Marcada como excluida, a tela sabe dizer o que houve.
 */
create table if not exists public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null references public.patients (id) on delete cascade,
  consultation_id uuid references public.consultations (id) on delete set null,
  memed_id text not null,
  memed_uuid text,
  link text,
  itens jsonb not null default '[]'::jsonb,
  emitida_em timestamptz not null default now(),
  excluida_em timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.prescriptions is
  'Receitas emitidas pela Memed, ligadas ao atendimento. Os itens ficam aqui para o prontuario nao depender do servico externo.';
comment on column public.prescriptions.itens is
  'Medicamentos e posologias como vieram da Memed, para leitura futura.';

create unique index if not exists prescriptions_memed_id_idx
  on public.prescriptions (clinic_id, memed_id);

create index if not exists prescriptions_por_consulta_idx
  on public.prescriptions (consultation_id, emitida_em desc);

alter table public.prescriptions enable row level security;
alter table public.prescriptions force row level security;

-- Quem enxerga o prontuario enxerga as receitas dele. Mesma regra, mesma
-- pergunta: voce e membro desta clinica?
drop policy if exists "membros leem as receitas da clinica" on public.prescriptions;
create policy "membros leem as receitas da clinica"
  on public.prescriptions for select
  to authenticated
  using (private.is_clinic_member(clinic_id));

-- Escrita fica com o servidor. A receita e emitida pela Memed e registrada pela
-- Edge Function a partir do que a Memed devolveu; deixar o navegador inserir
-- linha aqui seria deixar qualquer um dizer "isto foi prescrito".
grant select on table public.prescriptions to authenticated;
grant select, insert, update on table public.prescriptions to service_role;

commit;
