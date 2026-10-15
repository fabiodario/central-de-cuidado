begin;

/**
 * Painel de saude: falha de robo que ja se resolveu sai do alarme (28/09/2026).
 *
 * As 09:20 de 28/09 a chamada do lembrete estourou os 5 segundos do pg_net
 * (corrigido em 20260928130000). As 10:20 o mesmo robo ja rodava normal, mas o
 * painel continuava vermelho ate as 15:20, nas duas clinicas, porque contava
 * qualquer recusa das ultimas 6 horas. Alarme vermelho de um problema que ja
 * passou ensina a equipe a ignorar o painel - o contrario do que ele existe
 * para fazer.
 *
 * Agora so contam as recusas DEPOIS da ultima chamada bem-sucedida. Se o robo
 * continua falhando, nenhuma chamada boa aparece depois e o alarme fica; se
 * voltou a responder, o alarme apaga sozinho na passada seguinte.
 *
 * Igual a versao de 20260927120000 em todo o resto.
 */

create or replace function public.saude_dos_envios(p_clinic uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  resultado jsonb := '{}'::jsonb;
  agora_local timestamp := now() at time zone 'America/Sao_Paulo';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  fim_de_amanha timestamptz := ((hoje + 2)::timestamp at time zone 'America/Sao_Paulo');
  lembrete_ligado boolean;
  numero_whatsapp text;
  lista_teste text[];
begin
  if not private.is_clinic_member(p_clinic) then
    raise exception 'sem acesso a esta clinica' using errcode = '42501';
  end if;

  select coalesce(s.appointment_reminder_enabled, true), s.whatsapp_phone_number_id, s.whatsapp_telefones_teste
    into lembrete_ligado, numero_whatsapp, lista_teste
    from public.clinic_settings s
   where s.clinic_id = p_clinic;

  -- Sem numero, nao ha envio automatico - e nao ha o que cobrar. A tela
  -- mostra isso em cinza, nao em vermelho.
  if nullif(btrim(coalesce(numero_whatsapp, '')), '') is null then
    return jsonb_build_object('whatsapp_conectado', false, 'agora', now());
  end if;

  resultado := jsonb_build_object(
    'whatsapp_conectado', true,
    'modo_teste', lista_teste is not null,
    'telefones_teste', coalesce(cardinality(lista_teste), 0),
    'lembrete_ligado', coalesce(lembrete_ligado, true)
  );

  -- 1. Robos agendados: a ultima execucao de cada um.
  begin
    resultado := resultado || jsonb_build_object('robos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', j.jobname,
               'agenda', j.schedule,
               'ultimo_inicio', r.start_time,
               'status', r.status,
               'mensagem', left(coalesce(r.return_message, ''), 200)
             ) order by j.jobname)
        from cron.job j
        left join lateral (
          select d.start_time, d.status, d.return_message
            from cron.job_run_details d
           where d.jobid = j.jobid
           order by d.start_time desc
           limit 1
        ) r on true
    ), '[]'::jsonb));
  exception when others then
    resultado := resultado || jsonb_build_object('robos_erro', sqlerrm);
  end;

  -- 2. Chamadas recusadas pelo outro lado nas ultimas 6 horas - mas so as que
  -- vieram DEPOIS da ultima chamada que deu certo. Ver o comentario do arquivo.
  begin
    resultado := resultado || (
      with ultima_boa as (
        select coalesce(max(created), '-infinity'::timestamptz) as quando
          from net._http_response
         where created > now() - interval '6 hours'
           and status_code < 400 and error_msg is null
      ),
      recusas as (
        select r.created, r.status_code, r.error_msg, r.content
          from net._http_response r, ultima_boa
         where r.created > now() - interval '6 hours'
           and r.created > ultima_boa.quando
           and (r.status_code >= 400 or r.error_msg is not null)
      )
      select jsonb_build_object(
        'chamadas_6h', (select count(*) from net._http_response where created > now() - interval '6 hours'),
        'chamadas_recusadas_6h', (select count(*) from recusas),
        'ultima_recusa', (
          select left(coalesce(error_msg, status_code::text || ' ' || coalesce(content, '')), 200)
            from recusas order by created desc limit 1
        )
      )
    );
  exception when others then
    resultado := resultado || jsonb_build_object('chamadas_erro', sqlerrm);
  end;

  -- 3. Lembretes que ja deviam ter saido (mesma regra de 25/09/2026), agora
  -- sem contar telefone que o modo teste pula de proposito.
  resultado := resultado || jsonb_build_object(
    'lembretes_atrasados', (
      select count(*)
        from public.appointments a
        left join public.patients p on p.id = a.patient_id
       where a.clinic_id = p_clinic
         and a.status = 'scheduled'
         and a.reminder_sent_at is null
         and a.reminder_failed_at is null
         and a.starts_at >= now() + interval '2 hours'
         and a.starts_at < fim_de_amanha
         and a.created_at < now() - interval '90 minutes'
         and (btrim(coalesce(a.contact_phone, '')) <> '' or btrim(coalesce(p.phone, '')) <> '')
         and private.telefone_liberado_no_teste(coalesce(nullif(btrim(p.phone), ''), a.contact_phone), lista_teste)
         and extract(hour from agora_local) >= 10
         and extract(hour from agora_local) < 21
    ),
    'lembretes_falhos_48h', (
      select count(*) from public.appointments a
       where a.clinic_id = p_clinic
         and a.reminder_failed_at > now() - interval '48 hours'
         and a.reminder_sent_at is null
         and a.status = 'scheduled'
    ),
    'lembretes_enviados_24h', (
      select count(*) from public.appointments a
       where a.clinic_id = p_clinic
         and a.reminder_sent_at > now() - interval '24 hours'
    )
  );

  -- 4. Acompanhamentos, com o mesmo cuidado do modo teste.
  resultado := resultado || jsonb_build_object(
    'acompanhamentos_hoje_parados', (
      select count(*) from public.followups f
        left join public.patients p on p.id = f.patient_id
       where f.clinic_id = p_clinic
         and f.archived_at is null
         and f.status = 'pending'
         and f.due_date = hoje
         and f.whatsapp_sent_at is null
         and f.whatsapp_failed_at is null
         and private.telefone_liberado_no_teste(p.phone, lista_teste)
         and extract(hour from agora_local) >= 10
    ),
    'acompanhamentos_enviados_7d', (
      select count(*) from public.followups f
       where f.clinic_id = p_clinic and f.whatsapp_sent_at > now() - interval '7 days'
    ),
    'acompanhamentos_falhos_7d', (
      select count(*) from public.followups f
       where f.clinic_id = p_clinic
         and f.whatsapp_failed_at > now() - interval '7 days'
         and f.whatsapp_sent_at is null
    )
  );

  -- 5. Mensagens. Em modo teste ninguem escreve todo dia, e o "numero pode
  -- ter caido" viraria um aviso permanente: la, a ultima recebida nao vai.
  resultado := resultado || jsonb_build_object(
    'mensagens_falhas_24h', (
      select count(*) from public.whatsapp_messages m
       where m.clinic_id = p_clinic and m.direction = 'outbound'
         and m.status = 'failed' and m.created_at > now() - interval '24 hours'
    ),
    'ultima_recebida', case when lista_teste is null then (
      select max(m.created_at) from public.whatsapp_messages m
       where m.clinic_id = p_clinic and m.direction = 'inbound'
    ) end,
    'agora', now()
  );

  return resultado;
end
$function$;


commit;
