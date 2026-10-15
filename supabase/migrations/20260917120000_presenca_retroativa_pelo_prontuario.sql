begin;

/**
 * Marca presença nas consultas antigas que já têm prontuário escrito.
 *
 * A partir de hoje o sistema marca sozinho: quando o médico salva a evolução,
 * o agendamento daquele paciente naquele dia vira "compareceu". Isso não
 * alcança o que já aconteceu - e é justamente onde está o histórico inteiro da
 * clínica. Sem esta passada, a tela de Histórico abre com "0 compareceram" num
 * consultório que atende desde agosto, e a taxa de falta nasce mentindo.
 *
 * O CRITÉRIO é o mesmo que o sistema usa para saber se uma consulta foi
 * escrita: pelo menos um campo clínico preenchido. Cadastrar um paciente cria
 * uma consulta vazia, de esqueleto, só para pendurar os acompanhamentos de 15,
 * 30 e 90 dias - e esqueleto não é prova de que alguém esteve na sala. Se
 * contasse, metade dos cadastros viraria presença inventada.
 *
 * O peso e a altura entram no critério porque são os primeiros dados que a
 * enfermagem registra, muitas vezes antes de qualquer texto: a criança foi
 * pesada, logo ela estava lá.
 *
 * NÃO TOCA no que está cancelado nem no que já foi marcado à mão, e não mexe
 * em consulta de hoje para a frente. Só preenche o silêncio.
 *
 * A data é comparada no fuso da clínica, e não em UTC. Uma consulta das 17:20
 * em Santos é 20:20 UTC, e comparar cru jogaria o atendimento da tarde para o
 * dia seguinte - exatamente as consultas do fim do expediente, que são muitas.
 */

update public.appointments as a
set status = 'attended'
where a.status = 'scheduled'
  and a.patient_id is not null
  and a.starts_at < date_trunc('day', now())
  and exists (
    select 1
    from public.consultations as c
    join public.clinics as cl on cl.id = a.clinic_id
    where c.clinic_id = a.clinic_id
      and c.patient_id = a.patient_id
      and c.archived_at is null
      and c.consultation_date = (a.starts_at at time zone cl.timezone)::date
      and (
        btrim(coalesce(c.chief_complaint, '')) <> ''
        or btrim(coalesce(c.clinical_history, '')) <> ''
        or btrim(coalesce(c.personal_history, '')) <> ''
        or btrim(coalesce(c.family_history, '')) <> ''
        or btrim(coalesce(c.allergies, '')) <> ''
        or btrim(coalesce(c.current_medications, '')) <> ''
        or btrim(coalesce(c.physical_exam, '')) <> ''
        or btrim(coalesce(c.assessment, '')) <> ''
        or btrim(coalesce(c.plan, '')) <> ''
        or btrim(coalesce(c.prescription, '')) <> ''
        or btrim(coalesce(c.return_plan, '')) <> ''
        or btrim(coalesce(c.notes, '')) <> ''
        or btrim(coalesce(c.cid, '')) <> ''
        or c.weight_kg is not null
        or c.height_cm is not null
      )
  );

commit;
