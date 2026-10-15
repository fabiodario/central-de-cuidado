-- Um telefone, varios pacientes.
--
-- Em gastropediatria isso e a regra, nao a excecao: a mae cadastra os dois
-- filhos com o proprio celular. Ate aqui o robo pegava o primeiro paciente que
-- casasse com o numero, sem criterio nenhum de ordem, cumprimentava com o nome
-- dele e marcava a consulta no nome dele - mesmo quando a mae queria marcar
-- para o outro.
--
-- Agora, quando mais de um paciente compartilha o telefone, o robo pergunta
-- para quem e a consulta antes de mostrar as datas. A escolha precisa
-- sobreviver as etapas seguintes (unidade -> dia -> horario), e por isso ganha
-- coluna propria em vez de caber em booking_options, que e reescrito a cada
-- pergunta.

alter table public.whatsapp_conversations
  add column if not exists booking_patient_id uuid;

comment on column public.whatsapp_conversations.booking_patient_id is
  'Paciente escolhido para a consulta em andamento, quando o telefone atende a mais de um.';

comment on column public.whatsapp_conversations.booking_state is
  'Etapa da conversa automatica: menu, aguardando_paciente, aguardando_unidade, aguardando_dia, aguardando_horario, atendente, ou nulo.';

-- Indice para a busca por telefone que agora traz varios: ja existe
-- patients_clinic_phone_digits_idx desde 20260822120000 e continua servindo,
-- porque a consulta so deixou de ter LIMIT 1.
