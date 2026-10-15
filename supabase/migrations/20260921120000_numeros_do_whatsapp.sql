begin;

/**
 * Numeros do WhatsApp: o que o robo faz, em numero.
 *
 * Pedido em 21/09/2026. A clinica queria saber quantos contatos chegam, o que
 * as pessoas mais perguntam e quantas viram consulta. Fui ao banco e metade ja
 * dava: contato tem created_at, conversao tem appointments.source = 'whatsapp',
 * motivo de atencao tem attention_reason.
 *
 * A outra metade nao existia, e e esta migration:
 *
 * 1. O QUE ACONTECEU na conversa. O booking_state guarda so o estado de agora,
 *    e zera quando a conversa acaba: no dia seguinte ninguem sabe que doze
 *    pessoas desistiram na hora de escolher o horario, nem que a opcao 2 foi
 *    pedida trinta vezes. Faltava um registro do que passou.
 *
 * 2. DE QUAL CONVERSA veio a consulta. Hoje da para contar quantas consultas o
 *    robo marcou, mas nao quanto tempo levou entre o "oi" e o horario
 *    escolhido.
 *
 * NAO entrou aqui uma coluna de "quem mandou a mensagem", que era a terceira
 * ideia. Fui gravar e descobri que whatsapp_messages.automatic ja faz isso, e
 * ja esta preenchida em todos os pontos de envio desde o comeco: true no robo,
 * no lembrete e no cancelamento; false em whatsapp-reply e whatsapp-reopen,
 * que sao a equipe digitando. Da para separar ainda mais sem coluna nenhuma -
 * automatica com followup_id e acompanhamento, com template_name e lembrete, e
 * sem os dois e o robo no menu. Coluna nova ali seria uma segunda versao da
 * verdade para discordar da primeira.
 *
 * O HISTORICO NAO VOLTA para o que e novo. Contato, conversao, motivo de
 * atencao e quem mandou a mensagem ja estao gravados desde sempre, e valem
 * para tras. Evento e vinculo da consulta so existem do dia desta publicacao
 * em diante - essa serie comeca hoje, e a tela avisa isso em letra visivel
 * para ninguem ler "nenhuma opcao escolhida em agosto" como se o robo
 * estivesse quebrado.
 */

-- 1 ---------------------------------------------------------------------------

create table if not exists public.whatsapp_bot_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  -- cascade, e nao restrict como no resto do sistema: isto e registro derivado
  -- da conversa. Se um dia uma conversa precisar ser apagada por pedido de
  -- exclusao de dados, o rastro dela nao pode ser o que trava a exclusao.
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  evento text not null,
  -- O complemento do evento: o numero da opcao escolhida, a etapa em que a
  -- pessoa parou, o motivo do bloqueio. Texto curto, nunca o que o paciente
  -- escreveu - isto aqui e contagem, nao prontuario.
  detalhe text not null default '',
  criado_em timestamptz not null default now(),
  constraint whatsapp_bot_events_detalhe_curto check (char_length(detalhe) <= 120)
);

comment on table public.whatsapp_bot_events is
  'O que o robo fez em cada conversa, para contagem. Vocabulario de evento: '
  'menu_enviado, opcao_escolhida (detalhe = 1..5), agendou, desistiu, '
  'pediu_atendente, nao_entendi, controlado_bloqueado, documento_pedido, '
  'cancelou, remarcou. Nao guarda texto de paciente.';

create index if not exists whatsapp_bot_events_clinica_data
  on public.whatsapp_bot_events (clinic_id, criado_em desc);
create index if not exists whatsapp_bot_events_conversa
  on public.whatsapp_bot_events (conversation_id, criado_em);

alter table public.whatsapp_bot_events enable row level security;
alter table public.whatsapp_bot_events force row level security;

drop policy if exists whatsapp_bot_events_select_member on public.whatsapp_bot_events;
create policy whatsapp_bot_events_select_member on public.whatsapp_bot_events
for select to authenticated using ((select private.is_clinic_member(clinic_id)));

-- Ninguem escreve aqui pela tela. Quem registra e o robo, que roda como
-- service_role: evento inventado pela interface seria numero inventado.
grant select on table public.whatsapp_bot_events to authenticated;
grant select, insert on table public.whatsapp_bot_events to service_role;

-- 2 ---------------------------------------------------------------------------

alter table public.appointments
  add column if not exists conversation_id uuid
    references public.whatsapp_conversations(id) on delete set null;

comment on column public.appointments.conversation_id is
  'De qual conversa do WhatsApp saiu esta consulta. Nulo quando a recepcao '
  'marcou pela tela, e nas consultas anteriores a 21/09/2026.';

create index if not exists appointments_conversa
  on public.appointments (conversation_id)
  where conversation_id is not null;

-- Contagem por periodo, que e como o painel pergunta.
create index if not exists appointments_clinica_origem_data
  on public.appointments (clinic_id, source, created_at desc);
create index if not exists whatsapp_conversations_clinica_data
  on public.whatsapp_conversations (clinic_id, created_at desc);

-- 3 ---------------------------------------------------------------------------

/**
 * A conta dos numeros, feita no banco e nao no navegador.
 *
 * A tentacao era buscar as linhas e contar no TypeScript. Nao da: o PostgREST
 * devolve no maximo 1000 linhas por consulta, e um mes movimentado passa disso
 * facil em mensagens. O painel mostraria numeros menores que a realidade sem
 * nenhum erro aparecendo - exatamente o tipo de falha silenciosa que ja custou
 * semanas aqui. Contando no Postgres, o limite nao existe.
 *
 * security definer com checagem explicita de membro: e o mesmo desenho de
 * approve_access_request e conferir_integridade_prontuario.
 */
create or replace function public.numeros_do_whatsapp(
  p_clinic uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resposta jsonb;
begin
  if not (select private.is_clinic_member(p_clinic)) then
    raise exception 'Sem acesso aos numeros desta clinica.';
  end if;

  with conversas as (
    select c.id, c.created_at, c.attention_reason, c.status
    from public.whatsapp_conversations c
    where c.clinic_id = p_clinic
      and c.created_at >= p_de and c.created_at < p_ate
  ),
  msgs as (
    select m.conversation_id, m.direction, m.automatic,
           m.followup_id, m.template_name, m.created_at
    from public.whatsapp_messages m
    where m.clinic_id = p_clinic
      and m.created_at >= p_de and m.created_at < p_ate
  ),
  -- Conversas em que alguem da equipe digitou. O avesso disto e a contencao.
  com_gente as (
    select distinct m.conversation_id
    from msgs m
    where m.direction = 'outbound' and m.automatic = false
  ),
  eventos as (
    select e.conversation_id, e.evento, e.detalhe
    from public.whatsapp_bot_events e
    where e.clinic_id = p_clinic
      and e.criado_em >= p_de and e.criado_em < p_ate
  ),
  consultas as (
    select a.source, a.status
    from public.appointments a
    where a.clinic_id = p_clinic
      and a.created_at >= p_de and a.created_at < p_ate
  )
  select jsonb_build_object(
    'contatos', (select count(*) from conversas),
    -- Fora do expediente da clinica, no fuso de Santos. E o numero que
    -- justifica o robo existir: e gente que nao teria com quem falar.
    'contatos_fora_do_horario', (
      select count(*) from conversas
      where extract(dow from created_at at time zone 'America/Sao_Paulo') in (0, 6)
         or extract(hour from created_at at time zone 'America/Sao_Paulo') < 8
         or extract(hour from created_at at time zone 'America/Sao_Paulo') >= 19
    ),
    'pediram_para_nao_receber', (select count(*) from conversas where status = 'opted_out'),

    'mensagens_recebidas', (select count(*) from msgs where direction = 'inbound'),
    -- As quatro origens saem de automatic + de que lado veio a mensagem. Ver a
    -- nota no topo desta migration sobre nao ter criado coluna para isto.
    'enviadas_robo', (
      select count(*) from msgs
      where direction = 'outbound' and automatic
        and followup_id is null and template_name is null
    ),
    'enviadas_equipe', (
      select count(*) from msgs where direction = 'outbound' and not automatic
    ),
    'enviadas_lembrete', (
      select count(*) from msgs
      where direction = 'outbound' and automatic and template_name is not null
    ),
    'enviadas_acompanhamento', (
      select count(*) from msgs
      where direction = 'outbound' and automatic and followup_id is not null
    ),

    -- Conversas que comecaram no periodo e que ninguem da equipe precisou
    -- responder. E o indicador que traduz o robo em horas de recepcao.
    'contidas', (
      select count(*) from conversas
      where id not in (select conversation_id from com_gente)
    ),
    'atendidas_por_gente', (
      select count(*) from conversas
      where id in (select conversation_id from com_gente)
    ),

    'consultas_pelo_whatsapp', (select count(*) from consultas where source = 'whatsapp'),
    'consultas_pela_recepcao', (select count(*) from consultas where source = 'clinic'),
    -- Comparecimento por origem: responde se quem marca sozinho falta mais.
    'faltas_whatsapp', (
      select count(*) from consultas where source = 'whatsapp' and status = 'no_show'
    ),
    'faltas_recepcao', (
      select count(*) from consultas where source = 'clinic' and status = 'no_show'
    ),
    'compareceu_whatsapp', (
      select count(*) from consultas where source = 'whatsapp' and status = 'attended'
    ),
    'compareceu_recepcao', (
      select count(*) from consultas where source = 'clinic' and status = 'attended'
    ),

    -- Daqui para baixo vem da tabela de eventos, que so existe de 21/09/2026
    -- em diante. Zero aqui com contatos acima nao quer dizer robo parado:
    -- quer dizer periodo anterior ao registro. A tela precisa dizer isso.
    'opcoes_escolhidas', coalesce((
      select jsonb_object_agg(detalhe, quantas)
      from (
        select detalhe, count(*) as quantas
        from eventos where evento = 'opcao_escolhida' and detalhe <> ''
        group by detalhe
      ) x
    ), '{}'::jsonb),
    'eventos', coalesce((
      select jsonb_object_agg(evento, quantas)
      from (
        select evento, count(*) as quantas from eventos group by evento
      ) y
    ), '{}'::jsonb),
    'chamou_equipe_por_motivo', coalesce((
      select jsonb_object_agg(coalesce(nullif(detalhe, ''), 'sem motivo'), quantas)
      from (
        select detalhe, count(*) as quantas
        from eventos where evento = 'chamou_equipe'
        group by detalhe
      ) z
    ), '{}'::jsonb),
    -- Conversas que viram o menu e nunca chegaram a agendar, pedir documento
    -- ou chamar a equipe: sairam no meio do caminho.
    'desistiram', (
      select count(*) from (
        select conversation_id from eventos
        group by conversation_id
        having bool_or(evento = 'menu_enviado')
           and not bool_or(evento in ('agendou', 'remarcou', 'cancelou',
                                      'chamou_equipe', 'concluiu_sozinho'))
      ) w
    ),
    'inicio', p_de,
    'fim', p_ate
  ) into resposta;

  return resposta;
end;
$$;

comment on function public.numeros_do_whatsapp(uuid, timestamptz, timestamptz) is
  'Indicadores do atendimento por WhatsApp num periodo. Conta no banco porque '
  'o PostgREST corta em 1000 linhas e o painel mostraria menos do que houve.';

revoke all on function public.numeros_do_whatsapp(uuid, timestamptz, timestamptz) from public;
grant execute on function public.numeros_do_whatsapp(uuid, timestamptz, timestamptz) to authenticated;

commit;
