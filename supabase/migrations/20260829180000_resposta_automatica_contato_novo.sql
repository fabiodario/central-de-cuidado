-- Resposta automatica para quem escreve pela primeira vez no numero da clinica.
--
-- Ate aqui o numero so falava: mandava acompanhamento e esperava resposta. Com
-- o site novo divulgando o WhatsApp, pessoa que nunca foi paciente vai escrever
-- perguntando preco e horario. Sem isso ela ficaria sem resposta ate alguem da
-- equipe abrir a tela.
--
-- Regra deliberada: a resposta NAO sai para quem esta respondendo um
-- acompanhamento. Paciente que escreve "Estou bem, obrigada" nao pode receber
-- de volta uma tabela de precos.

alter table public.clinic_settings
  add column if not exists whatsapp_autoreply_enabled boolean not null default false,
  add column if not exists whatsapp_autoreply_text text not null default '';

comment on column public.clinic_settings.whatsapp_autoreply_enabled is
  'Liga a resposta automatica para quem escreve pela primeira vez.';
comment on column public.clinic_settings.whatsapp_autoreply_text is
  'Texto enviado nessa primeira resposta. Vazio desliga o envio.';

-- A tela precisa poder editar estes dois campos. O update em clinic_settings e
-- liberado coluna a coluna: sem este grant a tela salva sem erro e nada muda.
grant update (whatsapp_autoreply_enabled, whatsapp_autoreply_text)
  on table public.clinic_settings to authenticated;

-- Marca na conversa quando a resposta automatica ja foi enviada, para nao
-- repetir a cada mensagem que a pessoa mandar.
alter table public.whatsapp_conversations
  add column if not exists autoreply_sent_at timestamptz;

comment on column public.whatsapp_conversations.autoreply_sent_at is
  'Quando a resposta automatica de primeiro contato foi enviada nesta conversa.';

-- No sistema do Dr. Marcello aqui vinha o texto inicial, exatamente como a
-- recepcao DELE enviava: nome e especialidade dele, valor da consulta,
-- telefones da recepcao e "nao aceitamos convenios".
--
-- No banco do Dr. Fabio (15/10/2026) esse update saiu; as colunas acima
-- ficam. O filtro (texto vazio) nao olhava a clinica: a do Dr. Fabio, se ja
-- existisse quando isto rodasse, passaria a responder aos pacientes dele com
-- o nome, o preco e os telefones do Dr. Marcello. A saudacao do Dr. Fabio e
-- escrita pela clinica em Preferencias. Esta migration ainda nao tinha sido
-- aplicada no banco do Dr. Fabio, entao foi ajustada aqui mesmo; o original
-- esta no repositorio do Dr. Marcello.
