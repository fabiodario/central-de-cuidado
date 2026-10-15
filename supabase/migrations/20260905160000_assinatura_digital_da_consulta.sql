-- Estado da assinatura digital de cada atendimento.
--
-- A corrente de auditoria (migration anterior) prova que o registro nao foi
-- alterado. Estas colunas guardam a outra metade: QUEM assinou, QUANDO, e onde
-- esta o PDF assinado para conferencia por terceiros.
--
-- Sao coisas separadas de proposito. A corrente e nossa e roda sozinha; a
-- assinatura depende do certificado do medico e de uma chamada externa que
-- pode falhar. Guardar o estado dela aqui permite mostrar na tela quais
-- atendimentos ainda esperam assinatura - sem isso o medico nao teria como
-- saber, e um prontuario meio assinado e pior do que nenhum, porque da a
-- impressao de que esta resolvido.
--
-- Nada aqui e obrigatorio para o sistema funcionar. Consulta sem assinatura
-- continua valida e utilizavel; ela so nao serve para abolir o papel.

begin;

alter table public.consultations
  add column if not exists signed_at timestamptz,
  add column if not exists signed_by_name text,
  add column if not exists signature_provider text,
  add column if not exists signature_reference text,
  add column if not exists signed_pdf_path text,
  add column if not exists signed_pdf_hash text;

comment on column public.consultations.signed_at is
  'Momento em que a assinatura digital foi concluida. Nulo enquanto nao assinada.';
comment on column public.consultations.signed_by_name is
  'Nome que consta no certificado usado, como devolvido pelo provedor.';
comment on column public.consultations.signature_provider is
  'Quem intermediou e qual certificado. Ex.: "BRy/VIDaaS".';
comment on column public.consultations.signature_reference is
  'Identificador da assinatura no provedor, para reconsultar ou auditar depois.';
comment on column public.consultations.signed_pdf_path is
  'Caminho do PDF assinado no armazenamento. E ele que vale como documento.';
comment on column public.consultations.signed_pdf_hash is
  'SHA-256 do PDF assinado, para conferir o arquivo sem precisar abri-lo.';

-- Achar rapidamente o que falta assinar. Parcial porque o interesse e sempre
-- pelo que esta pendente, nunca pelo acervo inteiro.
create index if not exists consultations_pendentes_assinatura_idx
  on public.consultations (clinic_id, consultation_date desc)
  where signed_at is null and archived_at is null;

-- O grant de update e coluna a coluna nesta tabela. Sem incluir as novas, a
-- tela salvaria sem erro visivel e nada mudaria - ja aconteceu neste projeto.
--
-- Estas colunas NAO entram no grant de proposito: quem as escreve e a Edge
-- Function com service_role, depois de o provedor confirmar a assinatura.
-- Deixar o navegador marcar uma consulta como assinada seria permitir que
-- qualquer um dissesse "isto foi assinado" sem que tivesse sido.

commit;
