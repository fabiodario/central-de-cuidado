begin;

/**
 * A virada de Santos para a Livance travou em 01/10/2026.
 *
 * A tarefa da madrugada (private.mudar_santos_para_livance) chegou na etapa
 * de 01/10 - trocar a unidade no cadastro dos pacientes - e o gatilho
 * sync_patient_consultations copiou essa troca para a ultima consulta de cada
 * paciente. 28 dos 51 tinham a ultima consulta assinada digitalmente, e
 * consultations_assinada_nao_muda recusou: "Este atendimento foi assinado
 * digitalmente e nao pode mais ser alterado". Como tudo era uma transacao so,
 * caiu junto o resto - a Liferty seguiu ativa e o robo continuou oferecendo o
 * endereco antigo para agendar.
 *
 * As consultas de outubro ja tinham sido movidas nos dias anteriores (nenhuma
 * familia ficou marcada na Liferty).
 *
 * Duas correcoes:
 *
 *  1. sync_patient_consultations nao tenta mais escrever em consulta
 *     assinada. O mesmo defeito acontecia na tela: mudar a unidade ou o CID
 *     no cadastro de um paciente com a ultima consulta assinada dava erro e
 *     nao salvava nada.
 *
 *  2. Troca em lote pode pedir para nao mexer no prontuario
 *     (set_config central.sem_sincronizar_prontuario). A virada usa isso: a
 *     consulta de setembro aconteceu na Liferty e assim continua registrada.
 *
 * E roda a virada de novo, agora.
 *
 * NO BANCO DO DR. FABIO (15/10/2026) so a primeira metade vale. As duas
 * correcoes de sync_patient_consultations ficam inteiras: servem a qualquer
 * clinica que assina o prontuario. A segunda metade - recriar
 * private.mudar_santos_para_livance, roda-la de novo e conferir a Liferty -
 * saiu: e a mudanca de endereco da clinica do Dr. Marcello, e a tarefa nao
 * existe aqui (20260926120000 tambem ficou sem efeito). Esta migration ainda
 * nao tinha sido aplicada no banco do Dr. Fabio, entao foi ajustada aqui
 * mesmo; o original esta no repositorio do Dr. Marcello.
 */

create or replace function private.sync_patient_consultations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_consultation_id uuid;
begin
  -- A consultation trigger writes the legacy summary back to patients. Do not
  -- mirror that nested write into the consultation a second time.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Troca em lote que NAO deve reescrever o prontuario (ver o cabecalho).
  if coalesce(current_setting('central.sem_sincronizar_prontuario', true), '') = 'on' then
    return new;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    update public.consultations
    set archived_at = new.archived_at
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at is null;
  elsif new.archived_at is null and old.archived_at is not null then
    update public.consultations
    set archived_at = null
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at = old.archived_at;

    update public.followups
    set archived_at = null
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at = old.archived_at;
  end if;

  if new.archived_at is null
     and row(new.consultation_date, new.cid, new.unit)
       is distinct from
       row(old.consultation_date, old.cid, old.unit) then
    select consultation.id
    into current_consultation_id
    from public.consultations consultation
    where consultation.patient_id = new.id
      and consultation.clinic_id = new.clinic_id
      and consultation.archived_at is null
    order by
      exists (
        select 1
        from public.followups followup
        where followup.consultation_id = consultation.id
          and followup.archived_at is null
      ) desc,
      consultation.consultation_date desc,
      consultation.created_at desc
    limit 1;

    if current_consultation_id is not null then
      update public.consultations
      set
        consultation_date = new.consultation_date,
        cid = new.cid,
        unit = new.unit
      where id = current_consultation_id
        -- Consulta assinada nao muda (consultations_assinada_nao_muda): tentar
        -- derrubava a edicao inteira do cadastro.
        and signed_at is null
        and row(consultation_date, cid, unit)
          is distinct from
          row(new.consultation_date, new.cid, new.unit);
    end if;
  end if;

  return new;
end
$function$;

commit;
