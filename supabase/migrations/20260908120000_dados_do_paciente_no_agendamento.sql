begin;

/**
 * Dados que a familia informa ao marcar pelo WhatsApp.
 *
 * Quem marca sem cadastro chegava a consulta como um nome de perfil e um
 * telefone. O medico precisa de nome da crianca, nascimento, responsavel, CPF
 * (a RDC 1000/25 exige na receita) e e-mail para enviar documentos.
 *
 * Ficam na consulta, e nao em `patients`, de proposito: sao dados declarados
 * pela familia por mensagem, sem ninguem conferir. Viram cadastro quando a
 * recepcao abre a consulta e cria o paciente - ali o dado passa por gente.
 *
 * Texto, e nao date/varchar validado, pelo mesmo motivo: "12/03/2019", "março
 * de 2019" e "nao sei" sao respostas reais, e perder a resposta por causa do
 * formato seria pior do que guarda-la como veio.
 */
alter table public.appointments
  add column if not exists intake_patient_name text not null default '',
  add column if not exists intake_birth_date text not null default '',
  add column if not exists intake_guardian text not null default '',
  add column if not exists intake_cpf text not null default '',
  add column if not exists intake_email text not null default '';

comment on column public.appointments.intake_patient_name is
  'Nome da crianca informado pela familia no agendamento. Nao conferido.';
comment on column public.appointments.intake_birth_date is
  'Data de nascimento como a familia escreveu. Texto livre de proposito.';
comment on column public.appointments.intake_guardian is
  'Nome do responsavel informado no agendamento.';
comment on column public.appointments.intake_cpf is
  'CPF do paciente informado no agendamento. Pode estar vazio: nem toda crianca tem.';
comment on column public.appointments.intake_email is
  'E-mail informado para envio de receitas e documentos.';

-- Limites generosos, so para impedir que uma mensagem gigante entre inteira.
alter table public.appointments
  drop constraint if exists appointments_intake_length,
  add constraint appointments_intake_length check (
    char_length(intake_patient_name) <= 160
    and char_length(intake_birth_date) <= 60
    and char_length(intake_guardian) <= 160
    and char_length(intake_cpf) <= 40
    and char_length(intake_email) <= 160
  );

/**
 * Qual consulta esta recebendo os dados agora.
 *
 * A consulta e marcada ANTES das perguntas: quem escolheu o horario sai com a
 * vaga garantida, e as perguntas vem depois. Sem este ponteiro, a resposta
 * "Maria Clara" chegaria sem saber a qual consulta pertence.
 */
alter table public.whatsapp_conversations
  add column if not exists booking_intake_id uuid;

comment on column public.whatsapp_conversations.booking_intake_id is
  'Consulta recem-marcada cujos dados o robo esta perguntando. Nulo fora dessa etapa.';

-- O update em whatsapp_conversations e liberado coluna a coluna: sem isto o
-- botao de destravar o robo salvaria sem erro e deixaria a coluna preenchida.
grant update (booking_intake_id) on table public.whatsapp_conversations to authenticated;

commit;
