-- Guardar quantas vezes uma consulta ja foi remarcada.
--
-- Remarcar pelo WhatsApp nao edita a consulta: cria uma nova e cancela a
-- antiga. E de proposito - se a pessoa desiste no meio da escolha, ela continua
-- com a consulta original em vez de ficar sem nenhuma. O efeito colateral e que
-- a linha nova nasce sem memoria: para ela, e um agendamento como qualquer
-- outro.
--
-- Estas duas colunas carregam a memoria de uma para a outra. O contador diz
-- quantas vezes, e o ponteiro diz de onde veio - assim da para percorrer a
-- corrente inteira quando alguem quiser ver o historico, e nao so o numero.
--
-- Comeca do zero para tudo que ja existe: nao ha como reconstruir com
-- honestidade quem foi remarcado antes de hoje, e chutar seria pior do que
-- admitir que a contagem comeca agora.

alter table public.appointments
  add column if not exists reschedule_count integer not null default 0,
  add column if not exists rescheduled_from uuid references public.appointments(id) on delete set null;

comment on column public.appointments.reschedule_count is
  'Quantas vezes esta consulta ja trocou de data. Zero na primeira marcacao.';
comment on column public.appointments.rescheduled_from is
  'Consulta cancelada que esta substitui, quando veio de uma remarcacao.';

-- Serve a busca do painel, que puxa a corrente para tras a partir da consulta
-- atual. Parcial porque a esmagadora maioria das linhas nao remarcou nada.
create index if not exists appointments_rescheduled_from_idx
  on public.appointments (rescheduled_from)
  where rescheduled_from is not null;
