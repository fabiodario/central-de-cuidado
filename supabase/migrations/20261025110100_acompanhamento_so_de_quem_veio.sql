begin;

-- Vindo do sistema do Dr. Marcello (20261025120000, de 25/10/2026), trazido
-- no mesmo dia com data nova, na ordem das outras trazidas hoje.

/**
 * Acompanhamento so de consulta que aconteceu (25/10/2026).
 *
 * Quem marca pelo robo ganha ficha na hora, e a ficha cria sozinha uma
 * consulta vazia com a data do agendamento - e dela que penduram os
 * acompanhamentos de 30 dias e 3 meses. Desde 23/10 o envio automatico segura
 * quem nao veio (_shared/consulta-aconteceu.ts), mas o acompanhamento
 * continuava na tela: em 25/10 eram 9 criancas que cancelaram ou faltaram e
 * nunca foram atendidas, e a equipe ja tinha aberto o de 15 e o de 30 dias de
 * uma delas. O Edu: "nao pode entrar p acompanhamento paciente que de fato nao
 * gerou consulta, erro grave".
 *
 * A regra segue a agenda, num lugar so (robo, Agenda e a falta automatica das
 * 3h passam todos por aqui):
 *  - cancelou ou faltou, e nao sobrou outro horario do paciente naquele dia:
 *    a consulta VAZIA daquele dia e arquivada, e o gatilho
 *    consultations_sync_active arquiva os acompanhamentos dela junto;
 *  - desfez (clique errado, ou o medico escreveu o prontuario depois da falta
 *    automatica) e o paciente ficou sem consulta ativa: ela volta, com os
 *    acompanhamentos arquivados no mesmo instante;
 *  - a consulta marcada mudou de dia: a consulta vazia vai junto, e com ela
 *    as datas dos acompanhamentos.
 *
 * Arquiva a consulta, e nao so os acompanhamentos, de proposito: quando o
 * medico escreve o primeiro atendimento, o sistema reaproveita a consulta
 * vazia ATIVA (createConsultation). Com os acompanhamentos arquivados e a
 * consulta viva, a crianca que remarcasse e viesse ficaria sem acompanhamento.
 * Arquivada, o atendimento de verdade cria uma consulta nova, com os
 * acompanhamentos contados da data em que ela veio.
 *
 * Consulta com prontuario escrito ou assinada nunca e mexida.
 */

create or replace function private.acompanhamento_segue_a_agenda()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  dia date := (new.starts_at at time zone 'America/Sao_Paulo')::date;
  dia_antigo date := (old.starts_at at time zone 'America/Sao_Paulo')::date;
  volta_id uuid;
  volta_em timestamptz;
begin
  if new.patient_id is null then
    return new;
  end if;

  -- Cancelou ou faltou.
  if new.status in ('cancelled', 'no_show') and old.status not in ('cancelled', 'no_show') then
    if not exists (
      select 1 from public.appointments a
       where a.patient_id = new.patient_id
         and a.clinic_id = new.clinic_id
         and a.id <> new.id
         and a.status in ('scheduled', 'attended')
         and (a.starts_at at time zone 'America/Sao_Paulo')::date = dia
    ) then
      update public.consultations c
         set archived_at = now()
       where c.patient_id = new.patient_id
         and c.clinic_id = new.clinic_id
         and c.archived_at is null
         and c.signed_at is null
         and c.consultation_date = dia
         and btrim(coalesce(c.chief_complaint, '')) = ''
         and btrim(coalesce(c.clinical_history, '')) = ''
         and btrim(coalesce(c.assessment, '')) = ''
         and btrim(coalesce(c.plan, '')) = '';
    end if;
    return new;
  end if;

  -- Desfez a falta ou o cancelamento.
  if new.status in ('scheduled', 'attended') and old.status in ('cancelled', 'no_show') then
    if not exists (
      select 1 from public.consultations c
       where c.patient_id = new.patient_id
         and c.clinic_id = new.clinic_id
         and c.archived_at is null
    ) and exists (
      select 1 from public.patients p
       where p.id = new.patient_id and p.archived_at is null
    ) then
      select c.id, c.archived_at
        into volta_id, volta_em
        from public.consultations c
       where c.patient_id = new.patient_id
         and c.clinic_id = new.clinic_id
         and c.archived_at is not null
         and c.signed_at is null
         and c.consultation_date = dia
       order by c.archived_at desc
       limit 1;

      if volta_id is not null then
        update public.consultations set archived_at = null where id = volta_id;
        update public.followups
           set archived_at = null
         where consultation_id = volta_id
           and archived_at = volta_em;
      end if;
    end if;
    return new;
  end if;

  -- Mudou de dia e continua marcada: a consulta vazia vai junto.
  if new.status = 'scheduled' and dia is distinct from dia_antigo then
    update public.consultations c
       set consultation_date = dia
     where c.patient_id = new.patient_id
       and c.clinic_id = new.clinic_id
       and c.archived_at is null
       and c.signed_at is null
       and c.consultation_date = dia_antigo
       and btrim(coalesce(c.chief_complaint, '')) = ''
       and btrim(coalesce(c.clinical_history, '')) = ''
       and btrim(coalesce(c.assessment, '')) = ''
       and btrim(coalesce(c.plan, '')) = '';
  end if;

  return new;
end
$function$;

revoke all on function private.acompanhamento_segue_a_agenda() from public, anon, authenticated;

drop trigger if exists appointments_acompanhamento_segue_a_agenda on public.appointments;
create trigger appointments_acompanhamento_segue_a_agenda
after update of status, starts_at on public.appointments
for each row execute function private.acompanhamento_segue_a_agenda();

commit;
