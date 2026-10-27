begin;

/**
 * Coexistencia (27/10/2026, pedido do Edu depois de fechar com o Dr. Fabio):
 * o numero fixo do consultorio continua no app WhatsApp Business dos
 * aparelhos da equipe e passa a falar tambem pela API, com o robo e a Central.
 * Ver supabase/functions/_shared/coexistencia.ts.
 *
 * De onde veio a mensagem que nao nasceu na Central nem no robo:
 *  - 'historico': conversa do app de antes da ligacao, trazida pela Meta (os
 *    ultimos 6 meses, uma vez);
 *  - 'celular': escrita pela equipe no app do celular depois da ligacao (o
 *    aviso smb_message_echoes da Meta).
 * Nulo = como sempre: recebida do paciente ao vivo, robo ou Central.
 */
alter table public.whatsapp_messages
  add column if not exists origem text;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_origem_check;
alter table public.whatsapp_messages
  add constraint whatsapp_messages_origem_check
  check (origem is null or origem in ('historico', 'celular'));

comment on column public.whatsapp_messages.origem is
  'historico = conversa do app WhatsApp Business de antes da ligacao a API; celular = escrita pela equipe no app depois dela. Nulo = recebida ao vivo, robo ou Central.';

/**
 * Os contatos da agenda do app do celular (aviso smb_app_state_sync).
 *
 * A Meta manda todos de uma vez logo depois da ligacao, antes do historico, e
 * depois cada contato salvo, mudado ou apagado. O nome que a equipe deu ao
 * contato vira o nome da conversa sem cadastro (nome_personalizado); guardar
 * aqui e o que permite isso para conversas que o historico so cria depois.
 * Removido fica com a data, e nao some: a conversa que ja levou o nome nao
 * perde.
 */
create table if not exists public.whatsapp_contatos_do_celular (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  wa_id text not null,
  nome text check (nome is null or char_length(nome) between 1 and 120),
  removido_em timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (clinic_id, wa_id)
);

alter table public.whatsapp_contatos_do_celular enable row level security;
alter table public.whatsapp_contatos_do_celular force row level security;

drop policy if exists whatsapp_contatos_do_celular_select_member on public.whatsapp_contatos_do_celular;
create policy whatsapp_contatos_do_celular_select_member on public.whatsapp_contatos_do_celular for select to authenticated
using ((select private.is_clinic_member(clinic_id)));

revoke all on table public.whatsapp_contatos_do_celular from public, anon, authenticated;
grant select on table public.whatsapp_contatos_do_celular to authenticated;
grant all on table public.whatsapp_contatos_do_celular to service_role;

commit;
