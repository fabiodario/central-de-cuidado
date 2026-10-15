-- Foto, exame e áudio vão para a equipe, e a espera passa a ser de 48h neles.
--
-- O robô não lê anexo nenhum. Até 15/09/2026 a mensagem virava "[image]", não
-- casava com nada e a resposta era o menu inteiro: "como podemos ajudar hoje?"
-- para quem tinha acabado de mandar o ultrassom do filho. Agora a conversa é
-- entregue à equipe com a bandeira 'anexo', e o robô diz que entregou.
--
-- Sobre o prazo: as conversas travadas se soltam sozinhas depois de 24h
-- (migration de 14/09). Para dois motivos isso é pouco, e os dois têm a mesma
-- natureza - foi a clínica que puxou assunto e ficou devendo resposta:
--
--   'anexo'  alguém precisa abrir o arquivo, olhar com calma e responder;
--   'ajuda'  a pessoa apertou "Preciso de ajuda" no acompanhamento que NÓS
--            mandamos, e está esperando gente.
--
-- Nos dois, a equipe costuma precisar de mais de um dia útil. O robô voltando a
-- falar no meio disso seria atropelo. Quem pediu atendente pelo menu continua
-- em 24h: ali a dúvida costuma ser curta.

begin;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho',
      'urgencia', 'anexo'
    )
  );

create or replace function public.liberar_conversas_travadas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  liberadas integer;
begin
  with alteradas as (
    update public.whatsapp_conversations
       set booking_state = null,
           booking_options = null,
           booking_unit_id = null,
           booking_modality = null,
           booking_patient_id = null,
           booking_replaces_id = null,
           booking_intake_id = null,
           booking_updated_at = now(),
           menu_sent_at = null,
           auto_replies_while_waiting = 0
     where booking_state is not null
       and coalesce(booking_updated_at, last_message_at, created_at)
             <= now() - case
                          when attention_reason in ('anexo', 'ajuda') then interval '48 hours'
                          else interval '24 hours'
                        end
    returning 1
  )
  select count(*) into liberadas from alteradas;
  return liberadas;
end;
$$;

revoke all on function public.liberar_conversas_travadas() from public, anon;
grant execute on function public.liberar_conversas_travadas() to authenticated, service_role;

comment on function public.liberar_conversas_travadas() is
  'Zera a etapa do robo em conversas paradas: 48h quando a espera e por anexo ou pedido de ajuda, 24h no resto. Nao apaga mensagem, consulta, cadastro nem a bandeira de atencao.';

commit;
