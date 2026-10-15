-- Palavra-chave respondida enquanto a equipe nao chega, ate tres vezes.
--
-- Quem pede atendente entra numa fila e o robo se cala, para nao falar por
-- cima de quem vai atender. So que a espera pode durar horas (a noite, o fim
-- de semana), e nesse tempo a pessoa costuma escrever as duvidas de sempre:
-- "convenio?", "quanto custa?", "qual o endereco?". Ficar mudo diante de uma
-- pergunta que a clinica ja respondeu mil vezes nao protege ninguem.
--
-- Agora o robo responde essas perguntas mesmo na fila, mas com limite: tres
-- respostas automaticas por espera. Passou disso, ele cala de novo. O limite
-- existe porque insistencia costuma significar que a resposta pronta nao
-- serviu - e a quarta repeticao de um texto que nao ajudou vira deboche.
--
-- O contador zera cada vez que a pessoa entra na fila, e nao conta a mensagem
-- de transferencia nem a resposta de urgencia: urgencia responde sempre.

alter table public.whatsapp_conversations
  add column if not exists auto_replies_while_waiting smallint not null default 0;

comment on column public.whatsapp_conversations.auto_replies_while_waiting is
  'Quantas respostas prontas o robo ja deu nesta espera pela equipe. Zera ao entrar na fila; no limite (3) ele para de responder.';

-- A tela tambem zera o contador ao soltar o robo: "Destravar" e um recomeco, e
-- recomeco com contador cheio nao seria recomeco nenhum.
grant update (auto_replies_while_waiting) on table public.whatsapp_conversations to authenticated;

-- A varredura das conversas travadas zera junto com o resto da etapa.
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
             <= now() - interval '24 hours'
    returning 1
  )
  select count(*) into liberadas from alteradas;
  return liberadas;
end;
$$;

revoke all on function public.liberar_conversas_travadas() from public, anon;
grant execute on function public.liberar_conversas_travadas() to authenticated, service_role;
