begin;

/**
 * Vindo do sistema do Dr. Marcello (20261025150000_anexos_para_equipe.sql),
 * trazido em 25/10/2026 junto com o anexo no alerta (pedido do Edu: "quando
 * tiver foto, anexo, audio vai junto para eles").
 *
 * Cada arquivo do paciente mandado a um celular do alerta (o Dr. Fabio e a
 * Dayane). A Meta aceita o envio na hora e pode recusar segundos depois, pelo
 * aviso de status (131047: o celular nao escreveu para o numero da clinica
 * nas ultimas 24 horas). Esta tabela liga o id da Meta ao arquivo e a
 * conversa:
 *  - a recusa que chega depois vira nota na conversa (ver
 *    _shared/anexos-pendentes.ts, acompanharEnvioDoAnexo);
 *  - o arquivo recusado fica pendente e vai sozinho quando aquele celular
 *    escrever para a clinica ou tocar num botao do alerta (entregarAnexosPendentes).
 *
 * Aqui a coluna da conversa e conversation_id, como em alertas_de_urgencia
 * deste sistema (no Dr. Marcello e conversa_whatsapp, por causa do Instagram).
 */

create table if not exists public.anexos_para_equipe (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  numero text not null,
  tipo text not null,
  caminho text not null,
  nome text,
  quem text not null default '',
  recebido_em timestamptz not null default now(),
  meta_id text,
  situacao text not null default 'enviado'
    check (situacao in ('enviado', 'entregue', 'pendente', 'reenviado')),
  erro text,
  tentativas integer not null default 1,
  nota_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists anexos_para_equipe_meta_id_idx on public.anexos_para_equipe (meta_id);
create index if not exists anexos_para_equipe_pendentes_idx
  on public.anexos_para_equipe (clinic_id, numero, recebido_em)
  where situacao = 'pendente';

alter table public.anexos_para_equipe enable row level security;
alter table public.anexos_para_equipe force row level security;

drop policy if exists anexos_para_equipe_select_member on public.anexos_para_equipe;
create policy anexos_para_equipe_select_member on public.anexos_para_equipe for select to authenticated
using ((select private.is_clinic_member(clinic_id)));

revoke all on table public.anexos_para_equipe from public, anon, authenticated;
grant select on table public.anexos_para_equipe to authenticated;
grant all on table public.anexos_para_equipe to service_role;

commit;
