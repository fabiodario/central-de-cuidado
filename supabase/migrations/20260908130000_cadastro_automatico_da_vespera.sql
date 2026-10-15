begin;

/**
 * Cadastro criado pelo sistema na vespera da consulta.
 *
 * Quem marca pelo WhatsApp sem cadastro depende de alguem da recepcao abrir a
 * consulta e clicar em "cadastrar". Se ninguem clica, o medico abre o
 * atendimento e nao ha prontuario - descobre no consultorio, com a familia na
 * frente. Na vespera, junto com o lembrete, o sistema cria o cadastro com o que
 * a familia informou e liga a consulta a ele.
 *
 * A marca existe porque esse dado nao passou por ninguem: a tela mostra o
 * cadastro como "criado pelo WhatsApp, conferir", e some quando a equipe salva
 * o cadastro pela primeira vez.
 */
alter table public.patients
  add column if not exists auto_created_at timestamptz;

comment on column public.patients.auto_created_at is
  'Quando o sistema criou este cadastro sozinho, na vespera da consulta, com dados declarados pela familia. Nulo depois que alguem da equipe confere e salva.';

-- A tela precisa poder limpar a marca ao salvar o cadastro conferido.
grant update (auto_created_at) on table public.patients to authenticated;

-- O lembrete da vespera roda com service_role, que ate aqui so lia e atualizava
-- pacientes. Sem o insert, o cadastro automatico falharia em silencio.
grant insert on table public.patients to service_role;

create index if not exists patients_auto_created_idx
  on public.patients (clinic_id)
  where auto_created_at is not null;

commit;
