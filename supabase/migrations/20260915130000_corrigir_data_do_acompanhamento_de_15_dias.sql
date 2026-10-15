-- Mudar a data da consulta no cadastro deixava o acompanhamento de 15 dias para trás.
--
-- O gatilho que recalcula os acompanhamentos quando alguém corrige a "Data da
-- consulta" na ficha do paciente é de 16/08/2026, quando existiam dois:
--
--   set due_date = case followup_key
--     when 'd30' then new.consultation_date + 30
--     when 'm90' then new.consultation_date + 90
--   end
--
-- Em 08/09/2026 nasceu o de 15 dias, e este gatilho não foi junto. Duas coisas
-- ruins saem daí, e a segunda é pior:
--
-- 1. O 'd15' não é recalculado, então continua marcado para a data antiga.
--    Foi o que aconteceu com o Henrique: consulta corrigida para 11/09, o de 30
--    dias foi para 11/10 (certo) e o de 15 ficou em 15/09, quatro dias depois
--    da consulta. A mensagem "como você está?" saiu hoje, cedo demais.
--
-- 2. `case` sem `else` devolve NULL. Como due_date é NOT NULL, a correção da
--    data numa ficha com acompanhamento de 15 dias pendente FALHA, e a
--    recepção vê um erro sem entender o motivo.
--
-- A correção acrescenta o 'd15' e um `else due_date`, que mantém a data de
-- qualquer etapa futura que venha a existir em vez de apagá-la. Depois, uma
-- única passada conserta as linhas que já ficaram para trás.

begin;

create or replace function private.sync_patient_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.consultation_date is distinct from old.consultation_date then
    update public.followups
    set due_date = case followup_key
      when 'd15' then new.consultation_date + 15
      when 'd30' then new.consultation_date + 30
      when 'm90' then new.consultation_date + 90
      -- Sem o else, uma etapa nova devolveria NULL numa coluna NOT NULL e a
      -- simples correção de uma data viraria erro na tela da recepção.
      else due_date
    end
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and status = 'pending'
      and archived_at is null;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    update public.followups
    set archived_at = new.archived_at
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at is null;
  elsif new.archived_at is null and old.archived_at is not null then
    update public.followups
    set archived_at = null
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at is not null;
  end if;

  return new;
end;
$function$;

-- As linhas que ficaram para trás.
--
-- Só as pendentes e não arquivadas: o que já foi enviado é história, e
-- reescrever data de mensagem enviada seria falsear o registro. A conta é
-- sempre a data da consulta ativa do paciente mais os dias da etapa.
update public.followups f
set due_date = p.consultation_date + case f.followup_key
                 when 'd15' then 15
                 when 'd30' then 30
                 when 'm90' then 90
               end
from public.patients p
where p.id = f.patient_id
  and p.clinic_id = f.clinic_id
  and f.status = 'pending'
  and f.archived_at is null
  and p.consultation_date is not null
  and f.followup_key in ('d15', 'd30', 'm90')
  and f.due_date is distinct from (p.consultation_date + case f.followup_key
                                     when 'd15' then 15
                                     when 'd30' then 30
                                     when 'm90' then 90
                                   end);

commit;
