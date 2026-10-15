begin;

/**
 * Saude dos envios automaticos (25/09/2026).
 *
 * O lembrete da vespera ficou tres semanas sem sair e ninguem viu: o
 * agendador marcava "sucesso" (a chamada foi feita) e quem recusava era a
 * Edge Function, por um segredo com letra maiuscula trocada. Nenhuma tela
 * mostrava isso. Esta funcao junta, numa resposta so, as perguntas que teriam
 * pego aquele defeito no primeiro dia:
 *
 *  - os robos agendados rodaram, e quando? (cron.job_run_details)
 *  - as chamadas deles foram ACEITAS do outro lado? (net._http_response -
 *    exatamente o que o "sucesso" do agendador escondia)
 *  - tem consulta de amanha que ja devia ter recebido lembrete e nao recebeu?
 *  - os acompanhamentos de hoje sairam?
 *  - quantas mensagens falharam, e quando chegou a ultima mensagem de fora
 *    (se ninguem escreve ha um dia util inteiro, o numero pode ter caido)?
 *
 * security definer porque cron e net nao sao acessiveis ao navegador; a
 * pergunta "voce e da clinica?" vem antes de tudo. Cada bloco tem o proprio
 * tratamento de erro: faltar a extensao net nao pode apagar o resto.
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
begin
  if not private.is_clinic_member(p_clinic) then
    raise exception 'sem acesso a esta clinica' using errcode = '42501';
  end if;

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

  -- 2. Chamadas recusadas pelo outro lado nas ultimas 6 horas (o pg_net guarda
  -- as respostas por seis horas). E aqui que o segredo errado aparece.
  begin
    resultado := resultado || jsonb_build_object(
      'chamadas_6h', (select count(*) from net._http_response where created > now() - interval '6 hours'),
      'chamadas_recusadas_6h', (
        select count(*) from net._http_response
         where created > now() - interval '6 hours'
           and (status_code >= 400 or error_msg is not null)
      ),
      'ultima_recusa', (
        select left(coalesce(error_msg, status_code::text || ' ' || coalesce(content, '')), 200)
          from net._http_response
         where created > now() - interval '6 hours'
           and (status_code >= 400 or error_msg is not null)
         order by created desc
         limit 1
      )
    );
  exception when others then
    resultado := resultado || jsonb_build_object('chamadas_erro', sqlerrm);
  end;

  select coalesce(s.appointment_reminder_enabled, true)
    into lembrete_ligado
    from public.clinic_settings s
   where s.clinic_id = p_clinic;
  resultado := resultado || jsonb_build_object('lembrete_ligado', coalesce(lembrete_ligado, true));

  -- 3. Lembretes que ja deviam ter saido. A passada e de hora em hora, das 9h
  -- as 20h, e pega de "daqui a 2 horas" ate o fim de amanha. Consulta marcada
  -- ha mais de 90 minutos, com telefone, nessa janela, sem envio nem falha
  -- registrada, quer dizer que a passada nao rodou - ou rodou e nao fez nada.
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

  -- 4. Acompanhamentos. O disparo e as 9h; depois das 10h, o de hoje que nao
  -- saiu nem falhou esta parado (ou e de quem pediu para nao receber).
  resultado := resultado || jsonb_build_object(
    'acompanhamentos_hoje_parados', (
      select count(*) from public.followups f
       where f.clinic_id = p_clinic
         and f.archived_at is null
         and f.status = 'pending'
         and f.due_date = hoje
         and f.whatsapp_sent_at is null
         and f.whatsapp_failed_at is null
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

  -- 5. Mensagens.
  resultado := resultado || jsonb_build_object(
    'mensagens_falhas_24h', (
      select count(*) from public.whatsapp_messages m
       where m.clinic_id = p_clinic and m.direction = 'outbound'
         and m.status = 'failed' and m.created_at > now() - interval '24 hours'
    ),
    'ultima_recebida', (
      select max(m.created_at) from public.whatsapp_messages m
       where m.clinic_id = p_clinic and m.direction = 'inbound'
    ),
    'agora', now()
  );

  return resultado;
end
$function$;

revoke all on function public.saude_dos_envios(uuid) from public, anon;
grant execute on function public.saude_dos_envios(uuid) to authenticated;

commit;
