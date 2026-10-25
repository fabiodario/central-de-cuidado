-- Vindo do sistema do Dr. Marcello (20261016200000, de 16/10/2026), trazido
-- em 25/10/2026 com data nova: a publicacao so aplica migration posterior a
-- ultima que ja esta no banco.
--
-- Conversa aberta por um envio nosso para celular sem o nono digito
-- (16/10/2026). Ver comNonoDigito em supabase/functions/_shared/telefone-br.ts.
--
-- Um paciente cadastrado com o celular em 8 digitos teve os dois
-- acompanhamentos devolvidos como "Message undeliverable". O envio agora poe o
-- 9, mas a conversa dele ja existe com o numero sem o 9, e todo envio
-- seguinte (acompanhamento, lembrete, convite) reaproveita o numero da
-- conversa: falharia de novo.
--
-- So muda a conversa em que o numero sem o 9 nunca funcionou: nenhuma
-- mensagem da familia e nenhum envio entregue ou lido. Numero sem o 9 que veio
-- da Meta (conta antiga) tem mensagem da familia e fica como esta. Se ja
-- existe outra conversa com o 9, esta fica como esta: o indice unico
-- (clinic_id, wa_id) recusaria a troca.

update public.whatsapp_conversations c
   set wa_id = substr(c.wa_id, 1, 4) || '9' || substr(c.wa_id, 5)
 where c.wa_id ~ '^55[1-9][1-9][6-9][0-9]{7}$'
   and not exists (
     select 1 from public.whatsapp_messages m
      where m.conversation_id = c.id
        and (m.direction = 'inbound' or m.status in ('delivered', 'read'))
   )
   and not exists (
     select 1 from public.whatsapp_conversations o
      where o.clinic_id = c.clinic_id
        and o.wa_id = substr(c.wa_id, 1, 4) || '9' || substr(c.wa_id, 5)
   );
