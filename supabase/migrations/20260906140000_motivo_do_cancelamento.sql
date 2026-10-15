-- Motivo do cancelamento e aviso ao paciente.
--
-- Ate aqui o botao de cancelar na agenda so mudava o status e liberava o
-- horario. O paciente nao era avisado de nada: ele aparecia na unidade no dia
-- marcado, com a crianca, e descobria ali.
--
-- Guardar o motivo tem dois usos que se sustentam sozinhos: a recepcao entende
-- o que houve quando o paciente liga perguntando, e o consultorio consegue
-- olhar depois quantas consultas caem por imprevisto do medico e quantas a
-- pedido da familia. Sao coisas diferentes e hoje se perdem juntas.

begin;

alter table public.appointments
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_by uuid references auth.users (id),
  add column if not exists cancellation_notified_at timestamptz;

comment on column public.appointments.cancellation_reason is
  'Motivo do cancelamento, como foi escolhido ou escrito por quem cancelou.';
comment on column public.appointments.cancelled_by is
  'Quem cancelou pela plataforma. Nulo quando o proprio paciente cancelou pelo WhatsApp.';
comment on column public.appointments.cancellation_notified_at is
  'Quando o aviso chegou ao paciente. Nulo quando nao foi possivel avisar - e a diferenca que a recepcao precisa enxergar para decidir telefonar.';

-- Achar rapidamente quem foi cancelado e nao soube. E a fila de trabalho da
-- recepcao: cada linha aqui e um paciente que pode aparecer sem consulta.
create index if not exists appointments_cancelados_sem_aviso_idx
  on public.appointments (clinic_id, starts_at)
  where status = 'cancelled' and cancellation_notified_at is null;

-- Coluna a coluna, como o resto do projeto. Estas tres NAO entram no grant de
-- update do navegador: quem escreve e a Edge Function que cancela e avisa, em
-- uma operacao so. Deixar a tela marcar "avisado" sem ter avisado seria pior
-- do que nao ter o campo.

commit;
