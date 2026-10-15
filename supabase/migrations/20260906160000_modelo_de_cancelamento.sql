-- Modelo aprovado para avisar cancelamento fora da janela de 24 horas.
--
-- Cancelamento quase sempre acontece com dias de antecedencia, e nessa altura
-- o paciente nao escreve ha muito tempo. A Meta so aceita texto livre nas 24
-- horas seguintes a mensagem dele; passado isso, sem modelo aprovado nao ha
-- como avisar, e a familia descobre o cancelamento ao chegar na unidade.
--
-- E o pior caso possivel do sistema: ele sabe que a consulta caiu, sabe o
-- telefone, e mesmo assim nao consegue falar.
--
-- O nome fica em coluna, e nao fixo no codigo, porque quem cria o modelo e a
-- clinica no Gerenciador da Meta - o nome de la e que manda.

alter table public.clinic_settings
  add column if not exists whatsapp_cancel_template_name text not null
    default 'consulta_cancelada';

comment on column public.clinic_settings.whatsapp_cancel_template_name is
  'Modelo de utilidade para avisar cancelamento fora da janela de 24h. Tres variaveis: nome, quando e motivo.';

-- Coluna a coluna, como o resto de clinic_settings.
grant update (whatsapp_cancel_template_name)
  on table public.clinic_settings to authenticated;
