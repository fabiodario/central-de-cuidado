-- O robo se calava por causa da propria voz.
--
-- Para nao falar por cima da secretaria, o atendimento automatico fica quieto
-- quando alguem escreveu para a pessoa nas ultimas 12 horas. So que a unica
-- pergunta que o codigo sabia fazer era "saiu alguma mensagem daqui?" - e a
-- resposta era sim mesmo quando a mensagem tinha sido do proprio robo.
--
-- Resultado observado em 30/08/2026: o robo respondeu 11:36, a pessoa escreveu
-- "Oi" as 14:28 e nao recebeu nada. Faltava distinguir quem escreveu.

alter table public.whatsapp_messages
  add column if not exists automatic boolean not null default false;

comment on column public.whatsapp_messages.automatic is
  'Verdadeiro quando quem escreveu foi o sistema (menu, agendamento, lembrete, acompanhamento). Falso para mensagem digitada por alguem da equipe ou recebida do paciente.';

-- Consulta quente: "qual foi a ultima mensagem humana desta conversa?"
create index if not exists whatsapp_messages_humanas_idx
  on public.whatsapp_messages (conversation_id, created_at desc)
  where direction = 'outbound' and automatic = false;

-- Historico: nao da para separar retroativamente uma resposta da secretaria de
-- uma mensagem do menu - as duas sao texto livre, sem followup_id nem
-- template_name. Entao todo o passado entra como automatico.
--
-- E a escolha certa entre as duas erradas: marcar tudo como humano deixaria o
-- robo mudo por 12h em toda conversa existente, que e exatamente o defeito que
-- esta migration conserta. O risco oposto - o robo entrar numa conversa humana
-- em andamento - dura no maximo essas 12 horas e vale para tres conversas de
-- teste.
update public.whatsapp_messages
   set automatic = true
 where direction = 'outbound';
