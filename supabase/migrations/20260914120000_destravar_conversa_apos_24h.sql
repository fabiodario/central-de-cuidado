-- O robo se solta sozinho depois de 24 horas parado na mesma etapa.
--
-- A etapa da conversa (booking_state) existe para o robo lembrar onde parou:
-- qual unidade a pessoa escolheu, qual paciente, qual consulta esta sendo
-- trocada. Enquanto ela existe, o robo continua dentro daquele fluxo - e no
-- caso de 'atendente' ele fica mudo de proposito, porque alguem da equipe
-- assumiu.
--
-- O problema e que nada tirava a etapa. Uma conversa que parou no meio de um
-- agendamento as 18h de terca continuava "no meio de um agendamento" na sexta,
-- e a tela enchia de botoes "Destravar" que alguem precisava apertar um por um.
-- Pior: se a pessoa voltasse dias depois com um "oi", o robo respondia como se
-- a conversa nunca tivesse sido interrompida, cobrando o dado que faltava.
--
-- 24 horas nao e um numero escolhido no chute: e a mesma janela da Meta. Depois
-- dela a conversa anterior acabou para todos os efeitos, e a proxima mensagem
-- do paciente comeca uma sessao nova. Faz sentido que o robo tambem recomece do
-- menu.
--
-- O que NAO e apagado: mensagem, consulta, cadastro, e a bandeira de atencao
-- (needs_attention). Quem pediu atendente continua pedindo atendente: a etapa
-- expira, a pendencia com a equipe nao. Ela so sai quando alguem abre a
-- conversa, que e como sempre funcionou.

begin;

create or replace function public.liberar_conversas_travadas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  liberadas integer;
begin
  with alteradas as (
    update public.whatsapp_conversations
       set booking_state = null,
           booking_options = null,
           booking_unit_id = null,
           booking_modality = null,
           booking_patient_id = null,
           booking_replaces_id = null,
           booking_intake_id = null,
           booking_updated_at = now(),
           -- Zera tambem o controle de repeticao do menu: sem isso o robo
           -- poderia calar a proxima mensagem achando que ja mandou o menu
           -- ha pouco, justo quando a conversa recomeca.
           menu_sent_at = null
     where booking_state is not null
       -- coalesce porque linhas antigas, anteriores a coluna, tem o carimbo
       -- vazio. Sem isso elas nunca expirariam.
       and coalesce(booking_updated_at, last_message_at, created_at)
             <= now() - interval '24 hours'
    returning 1
  )
  select count(*) into liberadas from alteradas;
  return liberadas;
end;
$$;

revoke all on function public.liberar_conversas_travadas() from public, anon;
grant execute on function public.liberar_conversas_travadas() to authenticated, service_role;

comment on function public.liberar_conversas_travadas() is
  'Zera a etapa do robo em conversas paradas ha mais de 24h. Nao apaga mensagem, consulta, cadastro nem a bandeira de atencao.';

-- De hora em hora, no minuto 10, longe do minuto 5 que ja e da liberacao de
-- reservas: duas varreduras ao mesmo tempo disputariam as mesmas linhas sem
-- necessidade.
select cron.unschedule('liberar-conversas-travadas')
where exists (
  select 1 from cron.job where jobname = 'liberar-conversas-travadas'
);

select cron.schedule(
  'liberar-conversas-travadas',
  '10 * * * *',
  $$select public.liberar_conversas_travadas()$$
);

-- As que ja estao presas ha mais de um dia saem agora, e nao so na proxima
-- hora cheia: e o acumulo delas que motivou esta migration.
select public.liberar_conversas_travadas();

commit;
