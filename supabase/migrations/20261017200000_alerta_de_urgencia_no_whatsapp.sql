-- Alerta de urgencia no WhatsApp pessoal do medico, com botoes (17/10/2026,
-- pedido do Edu).
--
-- Ate aqui a urgencia e o sangramento so tocavam o celular do Dr. Fabio e da
-- Dayane pela notificacao do navegador (aviso-da-equipe.ts), e no iPhone ela
-- nao aceita botoes. Agora, quando uma conversa ENTRA em urgencia ou
-- sangramento, o robo manda tambem um modelo aprovado da Meta para o WhatsApp
-- de cada numero desta lista, a qualquer hora. O medico responde ali mesmo: "E
-- urgente", "Pode aguardar", "Eu respondo" ou um texto, e a resposta volta ao
-- paciente. Ver supabase/functions/_shared/alerta-de-urgencia.ts e
-- resposta-ao-alerta.ts. A notificacao do navegador continua.
--
-- Os numeros moram aqui, editaveis em Preferencias, e nao num segredo das Edge
-- Functions: trocar quem recebe nao pode depender de alguem mexer no painel do
-- Supabase. O PRIMEIRO numero e o do medico: so ele classifica a urgencia. Os
-- outros sao equipe. Coluna nova: as funcoes leem em consulta separada, com
-- try/catch, e sem ela so o alerta deixa de sair (com erro no log).

alter table public.clinic_settings
  add column if not exists alerta_urgencia_telefones text[] not null default '{}'::text[];

comment on column public.clinic_settings.alerta_urgencia_telefones is
  'Celulares (55 + DDD + numero) que recebem o alerta de urgencia no WhatsApp, a qualquer hora. O primeiro e o do medico, o unico que classifica. Editavel em Preferencias.';

-- O update em clinic_settings e liberado coluna a coluna (ver 20260829180000):
-- sem este grant a tela nao grava. Quem grava continua sendo so o responsavel
-- pela clinica (politica clinic_settings_update_owner).
grant update (alerta_urgencia_telefones) on table public.clinic_settings to authenticated;

-- Um registro por alerta, para a resposta do medico voltar ao paciente certo.
--
-- mensagens: os ids das mensagens de alerta na Meta. Quando o medico responde
-- "em cima" do alerta, o WhatsApp manda esse id junto, e e assim que se sabe de
-- qual paciente e a resposta sem perguntar.
-- veredito: vale o primeiro "e urgente" ou "pode aguardar" (nao_urgente), pelo
-- WhatsApp ou pela tela de Respostas. A gravacao e condicional (update ... where
-- veredito is null), o que evita corrida entre dois toques. "Eu respondo"
-- (responde) e o texto do medico (texto) nao fecham a classificacao.
-- rascunho: o texto que o medico escreveu, esperando o "Enviar". Orientacao
-- medica em nome dele nao sai sem confirmacao: um "liga pra ela" que era para a
-- Dayane nao pode chegar ao paciente.
create table if not exists public.alertas_de_urgencia (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- Nulo no alerta de teste da tela: nao ha paciente do outro lado.
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  teste boolean not null default false,
  motivo text not null default 'urgencia' check (motivo in ('urgencia', 'sangramento')),
  quem text not null default '',
  mensagens text[] not null default '{}'::text[],
  veredito text check (veredito is null or veredito in ('urgente', 'nao_urgente', 'responde', 'texto')),
  veredito_por text,
  veredito_em timestamptz,
  rascunho text check (rascunho is null or char_length(rascunho) <= 900),
  rascunho_de text,
  rascunho_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists alertas_de_urgencia_recentes_idx
  on public.alertas_de_urgencia (clinic_id, criado_em desc);
create index if not exists alertas_de_urgencia_conversa_idx
  on public.alertas_de_urgencia (conversation_id, criado_em desc);

comment on table public.alertas_de_urgencia is
  'Cada alerta de urgencia mandado ao WhatsApp do medico e da equipe, com os ids das mensagens na Meta e o veredito. So o servidor escreve.';

alter table public.alertas_de_urgencia enable row level security;
alter table public.alertas_de_urgencia force row level security;

-- Membro da clinica le (Preferencias mostra o ultimo alerta); so o servidor
-- escreve: um veredito gravado pela tela sem passar pelo envio ao paciente
-- seria um registro falso.
drop policy if exists alertas_de_urgencia_select_member on public.alertas_de_urgencia;
create policy alertas_de_urgencia_select_member on public.alertas_de_urgencia for select to authenticated
using ((select private.is_clinic_member(clinic_id)));

revoke all on table public.alertas_de_urgencia from public, anon, authenticated;
grant select on table public.alertas_de_urgencia to authenticated;
grant all on table public.alertas_de_urgencia to service_role;
