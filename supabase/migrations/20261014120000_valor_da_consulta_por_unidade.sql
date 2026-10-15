begin;

/**
 * Valor da consulta no cartao da unidade (14/10/2026).
 *
 * Ate aqui o valor so existia escrito a mao nos textos do robo: no texto de
 * cada unidade, na resposta pronta "Valor e pagamento", no fecho do menu.
 * Quando Sao Paulo passou de R$ 550 para R$ 600 (20260928160000), a troca foi
 * uma migration cacando "R$ 550,00" em tres tabelas por replace(). Esquecer um
 * lugar e a familia receber dois precos.
 *
 * Agora o valor e um campo da unidade, e os textos dizem {valor} ou {valores}
 * (ver supabase/functions/_shared/campos-do-texto.ts). O robo troca na hora de
 * enviar: a equipe muda o valor no cartao, em Agenda > Configuracao, e toda
 * mensagem seguinte ja sai com o novo.
 *
 * Retorno nao tem custo (Edu, 14/10/2026), entao e um valor so por lugar.
 *
 * As colunas nascem vazias, de proposito. Os textos de hoje continuam com o
 * valor escrito a mao e seguem funcionando igual; a troca para {valor} e feita
 * pela equipe no cartao, que mostra a previa antes de salvar. Preencher daqui
 * seria repetir o chute de 28/09: o texto gravado pode ter sido editado na
 * tela depois da ultima migration que o conhecia.
 *
 * Em centavos e inteiro: dinheiro em ponto flutuante vira R$ 599,99.
 */

alter table public.clinic_units
  add column if not exists price_cents integer;

alter table public.clinic_units
  drop constraint if exists clinic_units_price_cents_check;
alter table public.clinic_units
  add constraint clinic_units_price_cents_check
  check (price_cents is null or price_cents between 1000 and 10000000);

comment on column public.clinic_units.price_cents is
  'Valor da consulta nesta unidade, em centavos. O robo usa nos textos com {valor} e {valores}. Nulo = ainda nao preenchido.';

alter table public.clinic_settings
  add column if not exists telemedicine_price_cents integer;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_telemedicine_price_cents_check;
alter table public.clinic_settings
  add constraint clinic_settings_telemedicine_price_cents_check
  check (telemedicine_price_cents is null or telemedicine_price_cents between 1000 and 10000000);

comment on column public.clinic_settings.telemedicine_price_cents is
  'Valor da consulta por telemedicina, em centavos. O robo usa no texto da telemedicina ({valor}) e na lista {valores}.';

-- clinic_units tem update liberado na tabela inteira (20260824000100); a
-- clinic_settings libera coluna por coluna, e coluna nova sem grant e o
-- "permission denied" de 01/10 (20261001180000) outra vez.
grant update (telemedicine_price_cents) on table public.clinic_settings to authenticated;

commit;
