/**
 * Acompanhamento de 15 dias.
 *
 * O medico pediu um contato mais cedo: 15, 30 e 90 dias depois da consulta.
 * O tipo do banco so conhecia dois. Um valor novo num enum so pode ser usado
 * depois de confirmado, por isso esta migration so acrescenta o valor e a
 * mensagem; quem passa a gerar os acompanhamentos e a seguinte.
 *
 * Espelho do Dr. Fabio (15/10/2026): o texto padrao e o do Dr. Fabio, igual a
 * DEFAULT_TEMPLATES.d15 em src/lib/store.ts. No sistema de origem era o do Dr.
 * Marcello, e o default vale para toda clinica criada depois. Ajustada aqui
 * mesmo porque ainda nao tinha sido aplicada no banco do Dr. Fabio.
 */
alter type public.followup_key add value if not exists 'd15' before 'd30';

alter table public.clinic_settings
  add column if not exists template_d15 text not null default
    'Olá! Aqui é da equipe do Dr. Fábio Dario, otorrinolaringologista. Já se passaram 15 dias da consulta de {nome}. Como {pronome} está se adaptando ao tratamento? Se surgiu qualquer dúvida, é só responder por aqui. 💙';

alter table public.clinic_settings
  drop constraint if exists clinic_settings_template_d15_length,
  add constraint clinic_settings_template_d15_length
    check (char_length(template_d15) between 1 and 4096);

grant update (template_d15) on table public.clinic_settings to authenticated;
