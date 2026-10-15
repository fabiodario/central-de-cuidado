begin;

/**
 * A lista de conversas resumida no banco (25/09/2026).
 *
 * A tela de Conversas baixava TODAS as mensagens da clinica para descobrir, de
 * cada conversa, duas coisas: a ultima mensagem e se a equipe ja respondeu. E
 * fazia isso a cada evento de tempo real - inclusive a cada "entregue" e
 * "lida" que a Meta manda, que sao a maioria. Com 1.700 mensagens em um mes,
 * cada tiquinho azul custava duas paginas de download. E o que mais gasta o
 * trafego gratis do Supabase, e so cresce.
 *
 * Aqui o banco devolve uma linha por conversa, ja com a ultima mensagem e o
 * "respondida". A regra de "respondida" e a mesma da tela (repository.ts,
 * listConversations): a ultima mensagem que conta e do paciente, ou da equipe
 * escrita a mao, que nao falhou e nao e o convite para retomar.
 *
 * security invoker: as regras de acesso das duas tabelas valem como sempre.
 */

create index if not exists whatsapp_messages_conversa_quando_idx
  on public.whatsapp_messages (conversation_id, created_at desc);

create or replace function public.resumo_das_conversas(p_clinic uuid)
returns table (
  id uuid,
  patient_id uuid,
  display_phone text,
  wa_id text,
  profile_name text,
  status text,
  needs_attention boolean,
  attention_reason text,
  booking_state text,
  unread_count integer,
  last_message_at timestamptz,
  ultima_mensagem text,
  respondida boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    c.id,
    c.patient_id,
    c.display_phone,
    c.wa_id,
    c.profile_name,
    c.status::text,
    c.needs_attention,
    c.attention_reason::text,
    c.booking_state::text,
    c.unread_count,
    c.last_message_at,
    u.body,
    coalesce(r.respondida, false)
  from public.whatsapp_conversations c
  left join lateral (
    select m.body
      from public.whatsapp_messages m
     where m.conversation_id = c.id
     order by m.created_at desc, m.id desc
     limit 1
  ) u on true
  left join lateral (
    select m.direction = 'outbound' as respondida
      from public.whatsapp_messages m
     where m.conversation_id = c.id
       and (
         m.direction = 'inbound'
         or (
           m.direction = 'outbound'
           and m.automatic = false
           and m.status <> 'failed'
           and coalesce(m.body, '') not like 'Mensagem enviada para retomar o atendimento%'
         )
       )
     order by m.created_at desc, m.id desc
     limit 1
  ) r on true
  where c.clinic_id = p_clinic
  order by c.last_message_at desc nulls last, c.id;
$function$;

revoke all on function public.resumo_das_conversas(uuid) from public, anon;
grant execute on function public.resumo_das_conversas(uuid) to authenticated;

/**
 * Busca no texto das conversas, no banco. Antes a tela guardava o texto de
 * todas as mensagens na memoria so para a caixa de busca funcionar.
 */
create or replace function public.buscar_nas_conversas(p_clinic uuid, p_termo text)
returns table (conversation_id uuid)
language sql
stable
security invoker
set search_path = ''
as $function$
  select distinct m.conversation_id
    from public.whatsapp_messages m
   where m.clinic_id = p_clinic
     and length(btrim(coalesce(p_termo, ''))) >= 2
     and m.body ilike '%' || replace(replace(replace(btrim(p_termo), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   limit 2000;
$function$;

revoke all on function public.buscar_nas_conversas(uuid, text) from public, anon;
grant execute on function public.buscar_nas_conversas(uuid, text) to authenticated;

commit;
