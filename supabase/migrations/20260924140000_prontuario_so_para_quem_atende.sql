begin;

/**
 * PDF assinado e receitas: so quem atende (24/09/2026).
 *
 * O texto das consultas ja era restrito a owner e clinician desde 17/08
 * (private.is_clinic_clinician). Mas duas copias do mesmo conteudo ficaram com
 * a regra larga, "qualquer membro da clinica":
 *
 *  - o PDF assinado, que tem o atendimento inteiro dentro (queixa, exame,
 *    conduta, prescricao), no acervo prontuarios-assinados;
 *  - a tabela prescriptions, com os medicamentos e exames de cada paciente.
 *
 * Resultado: a recepcao, sem acesso a tela do prontuario, conseguia ler o
 * prontuario completo pelo caminho de lado. Aqui as duas passam a fazer a
 * mesma pergunta que a tabela de consultas ja fazia.
 *
 * A recepcao nao perde nada que usa: as telas dela (Agenda, Respostas,
 * Pacientes) nao leem nenhum dos dois.
 */

drop policy if exists "membros leem os assinados da propria clinica" on storage.objects;
drop policy if exists "quem atende le os assinados da propria clinica" on storage.objects;
create policy "quem atende le os assinados da propria clinica"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'prontuarios-assinados'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and private.is_clinic_clinician(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "membros leem as receitas da clinica" on public.prescriptions;
drop policy if exists "quem atende le as receitas da clinica" on public.prescriptions;
create policy "quem atende le as receitas da clinica"
  on public.prescriptions for select
  to authenticated
  using (private.is_clinic_clinician(clinic_id));

commit;
