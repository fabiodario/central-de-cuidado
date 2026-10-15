-- Tempo real na base clínica: pacientes, acompanhamentos e consultas.
--
-- Quem marca pelo WhatsApp agora vira cadastro sozinho, e a consulta entra na
-- agenda no mesmo instante. Sem transmissão, isso só aparecia depois de um F5:
-- a recepção olhava a lista, não via ninguém, e concluía que o robô falhou.
--
-- A RLS continua valendo na transmissão: o Supabase avalia as policies com o
-- JWT de quem está escutando, então cada usuário só recebe eventos da própria
-- clínica.

do $$
declare
  tabela text;
begin
  foreach tabela in array array['patients', 'followups', 'appointments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabela);
    end if;
  end loop;
end $$;

-- Sem a linha inteira, o cliente recebe só a chave em update e delete - e a
-- tela não consegue nem saber de que clínica era o registro que saiu.
alter table public.patients replica identity full;
alter table public.followups replica identity full;
alter table public.appointments replica identity full;
