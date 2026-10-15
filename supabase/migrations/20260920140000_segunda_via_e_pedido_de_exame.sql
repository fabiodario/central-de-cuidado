begin;

/**
 * 2ª via de receita e pedido de exame pelo WhatsApp.
 *
 * O caso real, contado pelo Dr. Marcello em 20/09/2026: a farmácia recusa a
 * receita porque a validade venceu, o laboratório devolve o pedido porque o CID
 * não confere. A família volta ao WhatsApp, escreve no meio da conversa, e o
 * recado se perde entre agendamentos. Refazer leva segundos na Memed; achar o
 * pedido é que custava.
 *
 * O QUE ESTE CAMINHO NÃO FAZ: emitir. Receita é ato médico e sai assinada por
 * quem prescreveu. E o próprio motivo do pedido - "troque o CID", "a validade
 * venceu" - é decisão clínica, não formulário. O robô coleta e entrega; o médico
 * refaz e envia. Automatizar a emissão seria assinar no lugar dele.
 *
 * DUAS BANDEIRAS, e a segunda existe por sigilo:
 *
 *   'documento'  o paciente (ou responsável) pedindo. Número com atendimento
 *                na clínica.
 *   'farmacia'   farmácia ou laboratório pedindo correção. Número que nunca
 *                consultou aqui.
 *
 * Separar as duas não é organização, é cuidado com dado de saúde. Para um
 * número desconhecido o robô não confirma que fulano é paciente daqui, não
 * mostra cadastro e não manda documento - só registra o que foi pedido e chama
 * a equipe. Quem recebe a receita corrigida é sempre o paciente, pelo canal
 * dele. Confirmar "sim, o Henrique se trata aqui" para quem quer que escreva
 * seria entregar prontuário a pedido.
 */

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho',
      'urgencia', 'anexo', 'documento', 'farmacia'
    )
  );

/**
 * 48h de espera, como 'anexo' e 'ajuda'.
 *
 * A regra de 24h existe para conversa que travou no meio de um agendamento:
 * ninguém respondeu, o robô solta e a pessoa recomeça. Aqui é o contrário - o
 * pedido foi recebido e a clínica é que está devendo. O robô voltando com "como
 * podemos ajudar hoje?" na manhã seguinte apagaria a bandeira de um pedido que
 * continua de pé, e a família leria isso como "esqueceram".
 *
 * 1 dia útil é o que o robô promete; 48h dão a folga do fim de semana.
 */
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
                          when attention_reason in ('anexo', 'ajuda', 'documento', 'farmacia')
                            then interval '48 hours'
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
  'Zera a etapa do robo em conversas paradas: 48h quando a espera e por anexo, pedido de ajuda, 2a via ou farmacia; 24h no resto. Nao apaga mensagem, consulta, cadastro nem a bandeira de atencao.';

/**
 * As etapas novas do robô não pedem coluna: booking_state é texto livre desde
 * 30/08/2026, e booking_options já guarda o que a pessoa respondeu no meio de
 * um fluxo. O pedido montado não vira tabela própria de propósito - ele sai
 * escrito no comprovante que a família recebe, e esse comprovante é a última
 * mensagem da conversa, visível na prévia da lista. Uma fila paralela seria um
 * segundo lugar para consultar, e um segundo lugar para esquecer.
 *
 * Acompanhar se foi atendido também já existe: desde 20/09/2026 a lista mostra
 * em cor apagada a conversa em que alguém da equipe escreveu depois do
 * paciente. O pedido respondido esmaece sozinho.
 */
comment on column public.whatsapp_conversations.booking_state is
  'Etapa da conversa automatica: menu, minha_consulta, confirmar_cancelamento, ja_tem_consulta, aguardando_paciente, aguardando_unidade, aguardando_convenio, aguardando_dia, aguardando_horario, atendente, documento_quem, documento_paciente, documento_tipo, documento_item, documento_exigencia, documento_farmacia, ou nulo.';

commit;
