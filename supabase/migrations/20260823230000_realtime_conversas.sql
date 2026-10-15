-- Tempo real na tela de Respostas.
--
-- Sem isto, a resposta do paciente so aparece quando alguem clica em Atualizar.
-- Numa clinica isso significa mensagem de paciente parada na tela sem ninguem
-- ver - inclusive um "Preciso de ajuda".
--
-- A RLS continua valendo na transmissao: o Supabase avalia as policies com o
-- JWT de quem esta escutando, entao cada usuario so recebe eventos das
-- conversas da propria clinica.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_messages'
  ) then
    alter publication supabase_realtime add table public.whatsapp_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'whatsapp_conversations'
  ) then
    alter publication supabase_realtime add table public.whatsapp_conversations;
  end if;
end $$;

-- A transmissao envia o registro anterior nos eventos de update/delete apenas
-- se a tabela guardar a linha inteira. Sem isso, o cliente recebe so a chave.
alter table public.whatsapp_messages replica identity full;
alter table public.whatsapp_conversations replica identity full;
