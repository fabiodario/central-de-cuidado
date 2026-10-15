-- Consulta assinada nao muda mais. Correcao vira adendo.
--
-- Ate aqui o bloqueio existia so na tela: o cartao escondia o botao de editar
-- depois de assinada. Mas o formulario abre por outros caminhos - pela agenda,
-- por exemplo - e o banco aceitava a alteracao do mesmo jeito. Bloqueio que so
-- existe na tela nao e bloqueio: e um lembrete.
--
-- Por que isso importa mais aqui do que em qualquer outro campo do sistema: a
-- assinatura digital vale sobre um PDF especifico. Alterar uma letra do
-- atendimento depois de assinado faz o prontuario e o documento assinado
-- contarem historias diferentes, e o documento deixa de provar o que diz
-- provar. E a regra da nao-rasura do prontuario (Res. CFM 1.638/2002): o
-- registro original permanece, e a correcao entra como anotacao nova, datada e
-- assinada a parte.
--
-- O que continua permitido: escrever nas colunas da propria assinatura (e a
-- Edge Function marcando que assinou) e arquivar a consulta.

begin;

create or replace function private.recusar_edicao_de_consulta_assinada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- So interessa consulta que ja estava assinada antes desta alteracao.
  if old.signed_at is null then
    return new;
  end if;

  -- A propria assinatura pode ser escrita: e a Edge Function concluindo.
  if new.signed_at is distinct from old.signed_at
     or new.signed_pdf_path is distinct from old.signed_pdf_path
     or new.signed_pdf_hash is distinct from old.signed_pdf_hash then
    return new;
  end if;

  -- Arquivar continua valendo: some da lista, o conteudo fica intacto.
  if new.archived_at is distinct from old.archived_at then
    return new;
  end if;

  if
    new.consultation_date is distinct from old.consultation_date or
    new.encounter_type is distinct from old.encounter_type or
    new.unit is distinct from old.unit or
    new.weight_kg is distinct from old.weight_kg or
    new.height_cm is distinct from old.height_cm or
    new.chief_complaint is distinct from old.chief_complaint or
    new.clinical_history is distinct from old.clinical_history or
    new.personal_history is distinct from old.personal_history or
    new.family_history is distinct from old.family_history or
    new.allergies is distinct from old.allergies or
    new.current_medications is distinct from old.current_medications or
    new.physical_exam is distinct from old.physical_exam or
    new.assessment is distinct from old.assessment or
    new.cid is distinct from old.cid or
    new.plan is distinct from old.plan or
    new.prescription is distinct from old.prescription or
    new.return_plan is distinct from old.return_plan or
    new.notes is distinct from old.notes
  then
    raise exception
      'Este atendimento foi assinado digitalmente e não pode mais ser alterado. Para corrigir, registre um adendo.'
      using errcode = 'P0001';
  end if;

  return new;
end
$function$;

drop trigger if exists consultations_assinada_nao_muda on public.consultations;
create trigger consultations_assinada_nao_muda
before update on public.consultations
for each row execute function private.recusar_edicao_de_consulta_assinada();

revoke all on function private.recusar_edicao_de_consulta_assinada() from public, anon, authenticated;

comment on function private.recusar_edicao_de_consulta_assinada() is
  'Recusa alteracao de conteudo clinico depois da assinatura digital. Correcao e adendo, nao rasura.';

commit;
