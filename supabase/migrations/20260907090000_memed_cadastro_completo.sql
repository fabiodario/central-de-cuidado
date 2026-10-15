-- Marca de "cadastro do prescritor completado na Memed".
--
-- A liberacao das chaves de producao da Memed exige o cadastro do medico com
-- e-mail, especialidade, cidade e telefone. O cadastro de teste foi feito
-- antes com o minimo; a Edge Function completa o resto uma vez e grava aqui
-- a data, para nao repetir a chamada a cada receita.

alter table public.clinic_settings
  add column if not exists memed_cadastro_completo_em timestamptz;

comment on column public.clinic_settings.memed_cadastro_completo_em is
  'Quando a Edge Function completou o cadastro do prescritor na Memed (e-mail, especialidade, cidade, telefone).';
