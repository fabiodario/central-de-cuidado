-- Duas coisas nesta migration: o conserto do bug que fazia toda unidade
-- responder "nao ha horarios", e o menu numerado do primeiro contato.

-- ---------------------------------------------------------------
-- 1. O bug: service_role nao podia ler public.clinics
--
-- available_slots e security invoker, entao roda com o papel de quem chama.
-- Pela tela, quem chama e o usuario logado (authenticated), que le clinics -
-- por isso a Agenda sempre mostrou os horarios certos. Pelo WhatsApp quem
-- chama e a edge function com service_role, e esse papel nao tinha SELECT em
-- clinics. A funcao morria na primeira linha do corpo, ao buscar o fuso:
--
--   ERROR 42501: permission denied for table clinics
--
-- O supabase-js devolve isso em `error`, com `data` nulo. Como o codigo lia
-- so o `data`, uma falha de permissao chegava ao paciente como "nao temos
-- horarios" - em Santos, que tem 42 vagas abertas, e em qualquer outra.
grant select on table public.clinics to service_role;

-- ---------------------------------------------------------------
-- 2. Textos do menu
--
-- O texto que existia hoje (valor da consulta, telefones, telemedicina) deixa
-- de ser a mensagem de boas-vindas e passa a ser o conteudo da opcao 1. A
-- saudacao vira uma linha curta, porque abaixo dela vem o menu.
-- ---------------------------------------------------------------

alter table public.clinic_settings
  add column if not exists whatsapp_menu_info_text text not null default '';

comment on column public.clinic_settings.whatsapp_menu_info_text is
  'Conteudo da opcao 1 do menu: valores, formas de contato e orientacoes.';
comment on column public.clinic_settings.whatsapp_autoreply_text is
  'Saudacao mostrada acima do menu para quem nao e paciente cadastrado.';
comment on column public.clinic_settings.whatsapp_autoreply_known_text is
  'Saudacao mostrada acima do menu para paciente cadastrado. Aceita {nome}.';

-- Move o texto atual para a opcao 1 sem reescrever nada: o que a clinica ja
-- revisou continua valendo, palavra por palavra.
update public.clinic_settings
   set whatsapp_menu_info_text = whatsapp_autoreply_text
 where whatsapp_menu_info_text = ''
   and whatsapp_autoreply_text <> '';

-- Saudacoes novas, curtas. No sistema do Dr. Marcello vinham aqui duas, com o
-- nome dele ("Aqui e o consultorio do Dr. Marcello Ruiz, gastropediatra").
--
-- No banco do Dr. Fabio (15/10/2026) esses dois updates sairam; o resto desta
-- migration fica. Nenhum dos dois olhava a clinica: o primeiro pegava toda
-- saudacao que acabou de ir para a opcao 1, o segundo toda saudacao de
-- paciente conhecido vazia. A clinica do Dr. Fabio, se ja existisse quando
-- isto rodasse, cumprimentaria os pacientes dele em nome do Dr. Marcello. As
-- saudacoes do Dr. Fabio sao escritas pela clinica em Preferencias. Esta
-- migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao foi
-- ajustada aqui mesmo; o original esta no repositorio do Dr. Marcello.

grant update (whatsapp_menu_info_text)
  on table public.clinic_settings to authenticated;

-- ---------------------------------------------------------------
-- 3. Estado do menu na conversa
-- ---------------------------------------------------------------

alter table public.whatsapp_conversations
  add column if not exists menu_sent_at timestamptz,
  add column if not exists attention_reason text;

comment on column public.whatsapp_conversations.menu_sent_at is
  'Quando o menu foi mostrado pela ultima vez. Evita repetir a cada mensagem.';
comment on column public.whatsapp_conversations.attention_reason is
  'Por que a conversa pede alguem da equipe: atendente, remarcacao, cancelamento, falha.';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in ('atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha')
  );

-- A tela precisa limpar o motivo junto com a bandeira quando a equipe assume.
grant update (attention_reason) on table public.whatsapp_conversations to authenticated;

-- booking_state ganhou dois valores novos ('menu' e 'atendente'), entao o
-- comentario antigo ficou desatualizado.
comment on column public.whatsapp_conversations.booking_state is
  'Etapa da conversa automatica: menu, aguardando_unidade, aguardando_horario, atendente, ou nulo.';

-- Quem parou no meio do fluxo antigo tem uma lista guardada que nao existe
-- mais na tela dele. Zerar evita que a proxima mensagem seja lida como escolha
-- de um menu que a pessoa nunca viu.
update public.whatsapp_conversations
   set booking_state = null,
       booking_options = null,
       booking_unit_id = null
 where booking_state is not null;
