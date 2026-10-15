-- Feriados nacionais de 2026 e 2027 como dias fechados.
--
-- Ate 31/08/2026 a tabela de excecoes estava vazia. Como Santos atende
-- segunda, terca e quarta, e como 7 de setembro de 2026 cai numa segunda, o
-- robo ofereceria o feriado da Independencia como dia livre e alguem marcaria
-- consulta para uma clinica fechada. Onze dos feriados abaixo caem justamente
-- em seg/ter/qua ate o fim de 2027.
--
-- unit_id nulo de proposito: available_slots le
-- `(e.unit_id is null or e.unit_id = p_unit_id)`, entao uma linha so fecha a
-- data em todas as unidades - inclusive nas que forem criadas depois.
--
-- Carnaval e Quarta-feira de Cinzas sao ponto facultativo, nao feriado. Entram
-- porque consultorio parado nesses dias e a regra, e porque o erro de bloquear
-- um dia em que se atende (o paciente liga) e menos grave do que o de oferecer
-- um dia em que nao se atende (o paciente viaja e encontra a porta fechada).
-- Ficam marcados no motivo para a clinica poder apagar pela tela.
--
-- NAO inclui feriados municipais de Santos, Santo Andre e Sao Paulo: eu nao
-- tenho essa lista com seguranca, e inventar data seria pior do que deixar em
-- branco. Cadastre pela tela de Agenda quando precisar.

insert into public.schedule_exceptions (clinic_id, unit_id, exception_date, is_closed, reason)
select c.id, null, f.data, true, f.motivo
from public.clinics c
cross join (values
    ('2026-09-07'::date, 'Independência do Brasil'),
    ('2026-10-12'::date, 'Nossa Senhora Aparecida'),
    ('2026-11-02'::date, 'Finados'),
    ('2026-11-15'::date, 'Proclamação da República'),
    ('2026-11-20'::date, 'Consciência Negra'),
    ('2026-12-25'::date, 'Natal'),
    ('2027-01-01'::date, 'Confraternização Universal'),
    ('2027-02-08'::date, 'Carnaval (ponto facultativo)'),
    ('2027-02-09'::date, 'Carnaval (ponto facultativo)'),
    ('2027-02-10'::date, 'Quarta-feira de Cinzas (ponto facultativo)'),
    ('2027-03-26'::date, 'Sexta-feira Santa'),
    ('2027-04-21'::date, 'Tiradentes'),
    ('2027-05-01'::date, 'Dia do Trabalho'),
    ('2027-05-27'::date, 'Corpus Christi'),
    ('2027-09-07'::date, 'Independência do Brasil'),
    ('2027-10-12'::date, 'Nossa Senhora Aparecida'),
    ('2027-11-02'::date, 'Finados'),
    ('2027-11-15'::date, 'Proclamação da República'),
    ('2027-11-20'::date, 'Consciência Negra'),
    ('2027-12-25'::date, 'Natal')
  ) as f(data, motivo)
-- Roda de novo sem duplicar, e sem ressuscitar um feriado que a clinica tenha
-- apagado de proposito... exceto se ela apagar e a migration for reaplicada do
-- zero, o que so acontece em banco novo.
where not exists (
  select 1
  from public.schedule_exceptions e
  where e.clinic_id = c.id
    and e.exception_date = f.data
    and e.unit_id is null
);
