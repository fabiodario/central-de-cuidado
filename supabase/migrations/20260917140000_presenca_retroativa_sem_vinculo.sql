begin;

/**
 * Segunda passada da presença retroativa, agora achando o paciente sem o
 * vínculo formal.
 *
 * POR QUE UMA MIGRATION NOVA: a de 20260917120000 rodou e não marcou nada.
 * Ela exigia appointments.patient_id preenchido, e descobri conferindo os
 * dados do dia 16/09 que a agenda da clínica está quase toda sem esse vínculo:
 * a equipe marca digitando o nome e o telefone na mão, e o cadastro do
 * paciente existe em paralelo, sem se falar com a consulta. Arquivo aplicado
 * não se edita, então vem esta na frente.
 *
 * COMO ACHA O PACIENTE quando o vínculo falta:
 *
 *  - pelos ÚLTIMOS 8 DÍGITOS do telefone. A agenda guarda 5511987654321, com
 *    código do país, e o cadastro guarda 11912345678, sem. Comparar inteiro
 *    não casa nunca; os últimos 8 são o número do assinante e sobrevivem ao
 *    nono dígito, ao DDD escrito de formas diferentes e ao +55.
 *  - ou pelo NOME idêntico, para quem foi marcado sem telefone.
 *
 * E só aceita quando UM ÚNICO paciente casa. Dois homônimos, ou duas fichas no
 * mesmo telefone (a mãe que cadastrou os dois filhos), e o sistema não escolhe
 * por conta própria: fica sem marca, para a recepção decidir. Errar de quem é
 * a presença é pior do que não ter presença.
 *
 * O resto da regra é o da migration anterior: só consulta passada, só o que
 * ainda está "marcada", e só quando existe prontuário com conteúdo clínico
 * naquele dia - esqueleto de cadastro não é prova de que alguém esteve na sala.
 *
 * Não altera o patient_id. Esta migration só escreve presença. O vínculo
 * faltando é um problema maior, e mexer nele em massa merece decisão própria.
 */

with casamentos as (
  select
    a.id as agendamento,
    -- array_agg e nao min(): o Postgres nao tem min() para uuid, e essa linha
    -- derrubou o db push inteiro em 17/09/2026. Como a migration que falha
    -- bloqueia todas as seguintes, tres dias de alteracoes de banco ficaram
    -- paradas - e o robo foi ao ar pedindo colunas que nunca chegaram.
    -- Como so vale quando quantos = 1, qualquer elemento serve.
    (array_agg(p.id))[1] as paciente,
    count(p.id) as quantos
  from public.appointments as a
  join public.patients as p
    on p.clinic_id = a.clinic_id
   and p.archived_at is null
   and (
     (
       length(regexp_replace(coalesce(a.contact_phone, ''), '\D', '', 'g')) >= 8
       and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 8)
           = right(regexp_replace(coalesce(a.contact_phone, ''), '\D', '', 'g'), 8)
     )
     or (
       btrim(coalesce(a.contact_name, '')) <> ''
       and upper(btrim(p.name)) = upper(btrim(a.contact_name))
     )
   )
  where a.patient_id is null
  group by a.id
),
resolvidos as (
  select agendamento, paciente
  from casamentos
  where quantos = 1
)
update public.appointments as a
set status = 'attended'
from public.clinics as cl
where cl.id = a.clinic_id
  and a.status = 'scheduled'
  and a.starts_at < date_trunc('day', now())
  and exists (
    select 1
    from public.consultations as c
    where c.clinic_id = a.clinic_id
      and c.archived_at is null
      and c.consultation_date = (a.starts_at at time zone cl.timezone)::date
      and c.patient_id = coalesce(
        a.patient_id,
        (select r.paciente from resolvidos as r where r.agendamento = a.id)
      )
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
