-- "Nao quero receber" no acompanhamento para so o acompanhamento (15/10/2026).
--
-- Ate aqui havia uma marca so, patients.whatsapp_opt_out_at, e ela barrava
-- tudo: acompanhamento, lembrete da vespera e aviso de cancelamento. Mas a
-- resposta que a familia ouvia ao tocar "Nao quero receber" (ou responder SAIR,
-- como o proprio modelo ensina) sempre foi "nao enviaremos mais mensagens de
-- ACOMPANHAMENTO". A mae do Vicente tocou o botao em 15/10; se ela marcar uma
-- consulta, precisa do lembrete - e o Dr. Marcello quer que ela receba.
--
-- Agora sao duas marcas:
--   followup_opt_out_at  so o acompanhamento (o botao, o SAIR);
--   whatsapp_opt_out_at  nada mais sai ("tirem meu numero", "parem de mandar").
--
-- Os pedidos que ja existem viram so-acompanhamento: todos ouviram aquela
-- frase, e e o que foi prometido. Quem quis sair de tudo pode pedir de novo, e
-- o robo agora entende a diferenca.

alter table public.patients
  add column if not exists followup_opt_out_at timestamptz;

comment on column public.patients.followup_opt_out_at is
  'Pediu para nao receber acompanhamento (botao "Nao quero receber" ou SAIR). Lembrete e aviso de consulta continuam. Para nao receber nada, ver whatsapp_opt_out_at.';

-- A tela limpa a marca no "Voltar a enviar mensagens".
grant update (followup_opt_out_at) on table public.patients to authenticated;

update public.patients
   set followup_opt_out_at = coalesce(followup_opt_out_at, whatsapp_opt_out_at),
       whatsapp_opt_out_at = null
 where whatsapp_opt_out_at is not null;

-- A conversa desses pacientes estava como "nao quer receber", o que tambem
-- barrava o lembrete e a resposta da equipe. Volta a "concluida": a proxima
-- mensagem da familia reabre, como qualquer outra.
update public.whatsapp_conversations c
   set status = 'resolved'
  from public.patients p
 where c.patient_id = p.id
   and c.status = 'opted_out'
   and p.followup_opt_out_at is not null
   and p.whatsapp_opt_out_at is null;
