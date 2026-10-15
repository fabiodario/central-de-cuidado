-- Botao para a equipe destravar o robo numa conversa, sem depender de ninguem.
--
-- O robo guarda a etapa da conversa na propria linha (booking_state e
-- companhia). Se algo prender a conversa numa etapa - uma mudanca de codigo no
-- meio de um atendimento, um estado que ficou orfao - hoje nao havia como
-- soltar pela tela: so mexendo no banco.
--
-- O update em whatsapp_conversations e liberado coluna a coluna, entao sem
-- estes grants a tela salvaria sem erro nenhum e nada mudaria.

grant update (
  booking_state,
  booking_options,
  booking_unit_id,
  booking_patient_id,
  booking_replaces_id,
  booking_updated_at,
  menu_sent_at
) on table public.whatsapp_conversations to authenticated;
