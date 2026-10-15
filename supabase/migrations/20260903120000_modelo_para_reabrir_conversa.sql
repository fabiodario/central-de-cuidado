-- Modelo aprovado para retomar uma conversa fora da janela de 24 horas.
--
-- Depois de 24 horas sem mensagem do paciente, a Meta bloqueia texto livre.
-- Ate aqui a tela apenas avisava disso e desligava a caixa de resposta - a
-- equipe lia "e preciso enviar um modelo aprovado" e nao tinha por onde
-- enviar. Ficava sem saida dentro do proprio sistema.
--
-- O template de utilidade nao resolve o assunto: ele reabre a porta. O
-- paciente responde, a janela de 24 horas volta a contar, e a partir dai a
-- equipe escreve o que precisar como sempre.
--
-- Nome guardado em coluna, e nao fixo no codigo, porque quem cria o template e
-- a clinica no Gerenciador da Meta - e o nome de la e que manda.

alter table public.clinic_settings
  add column if not exists whatsapp_reopen_template_name text not null default 'retomar_atendimento';

comment on column public.clinic_settings.whatsapp_reopen_template_name is
  'Template de utilidade usado para retomar conversa fora da janela de 24h. Uma variavel: o nome de quem recebe.';

-- Coluna a coluna, como o resto de clinic_settings. Sem isto a tela de
-- configuracao salvaria sem erro visivel e nada mudaria.
grant update (whatsapp_reopen_template_name)
  on table public.clinic_settings to authenticated;
