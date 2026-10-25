-- "Mandar para o celular" e a conversa ativa de quem responde pelo WhatsApp
-- (25/10/2026). Vindo do sistema do Dr. Marcello: a ideia do pedido
-- (18/10/2026) e as colunas de 20261018180000_ultima_resposta_ao_alerta.sql,
-- trazidas com data nova.
begin;

-- O pedido (o "Mandar para o celular" da Central) fica na mesma tabela do
-- alerta: e o id dele que vai no botao "Eu respondo", e a resposta do medico
-- volta ao paciente pelo mesmo caminho (_shared/resposta-ao-alerta.ts). O
-- veredito da tela de Respostas nao fecha pedido, so alerta.
alter table public.alertas_de_urgencia
  drop constraint if exists alertas_de_urgencia_motivo_check;
alter table public.alertas_de_urgencia
  add constraint alertas_de_urgencia_motivo_check
  check (motivo in ('urgencia', 'sangramento', 'pedido'));

-- Com qual paciente o medico (ou a Dayane) esta conversando pelo WhatsApp.
--
-- No primeiro dia de uso do sistema do Dr. Marcello havia dois avisos abertos.
-- Quem tocou "Eu respondo" num deles e escreveu em seguida recebeu "Ha 2
-- alertas recentes... segure a mensagem do alerta certo", e de novo na
-- mensagem seguinte. Quem esta numa conversa quer mandar varias mensagens
-- seguidas sem escolher o paciente a cada uma.
--
-- respondido_em / respondido_por: a ultima vez que este numero respondeu a este
-- aviso (botao ou mensagem enviada). O texto sem citar segue para o aviso da
-- ultima resposta dele, enquanto nao chegar aviso novo. Tambem e o que liga o
-- repasse: o que o paciente escreve depois volta aos celulares por 6 horas.
-- Colunas novas: lidas em consulta separada, com try/catch; sem elas, volta a
-- pergunta de qual paciente.
alter table public.alertas_de_urgencia
  add column if not exists respondido_em timestamptz,
  add column if not exists respondido_por text;

create index if not exists alertas_de_urgencia_respondido_idx
  on public.alertas_de_urgencia (clinic_id, respondido_por, respondido_em desc);

commit;
