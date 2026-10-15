-- A funcao de assinatura precisa GRAVAR a assinatura na consulta.
--
-- Em 06/09/2026 a BRy assinou, o PDF foi arquivado, e o ultimo passo - marcar
-- a consulta como assinada - caiu com "permission denied for table
-- consultations". O service_role, que a Edge Function usa, tinha so select
-- nesta tabela (concedido em 20260823 para o WhatsApp ler consultas).
--
-- A permissao e coluna a coluna, de proposito: a funcao so pode escrever as
-- colunas da propria assinatura. O conteudo clinico continua fora do alcance
-- dela - e, depois de assinada, fora do alcance de qualquer um (gatilho
-- consultations_assinada_nao_muda).

grant update (
  signed_at,
  signed_by_name,
  signature_provider,
  signature_reference,
  signed_pdf_path,
  signed_pdf_hash
) on table public.consultations to service_role;
