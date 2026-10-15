-- Resposta automatica diferente para quem ja e paciente.
--
-- Ate aqui a regra era so "nunca enviamos nada nesta conversa". Isso deixava um
-- buraco: paciente cadastrado ha tempos, que nunca recebeu acompanhamento -
-- porque a consulta e anterior ao sistema ou o acompanhamento foi arquivado -
-- escrevia e recebia a tabela de precos como se fosse desconhecido.
--
-- Agora sao dois textos. Quem o sistema reconhece pelo telefone recebe um
-- aceno curto; quem nao esta cadastrado recebe as informacoes de sempre.

alter table public.clinic_settings
  add column if not exists whatsapp_autoreply_known_text text not null default '';

comment on column public.clinic_settings.whatsapp_autoreply_known_text is
  'Resposta automatica para quem ja e paciente cadastrado. Aceita {nome}. Vazio nao envia nada.';

grant update (whatsapp_autoreply_known_text)
  on table public.clinic_settings to authenticated;

-- No sistema do Dr. Marcello aqui vinha o texto inicial para paciente
-- conhecido, com o nome do consultorio DELE.
--
-- No banco do Dr. Fabio (15/10/2026) esse update saiu; a coluna acima fica. O
-- filtro (texto vazio) nao olhava a clinica: a do Dr. Fabio, se ja existisse
-- quando isto rodasse, cumprimentaria os pacientes dele em nome do Dr.
-- Marcello. O texto do Dr. Fabio e escrito pela clinica em Preferencias. Esta
-- migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao foi
-- ajustada aqui mesmo; o original esta no repositorio do Dr. Marcello.
