begin;

/**
 * Cadastro que nasceu com o nome do contato do WhatsApp. Vindo do sistema do
 * Dr. Marcello (20261018100000, de 18/10/2026), trazido em 25/10/2026 com
 * data nova: a publicacao so aplica migration posterior a ultima que ja esta
 * no banco.
 *
 * Quando a ficha fica sem o nome do paciente, o cadastro automatico usa o nome
 * do contato do WhatsApp. La, quase sempre era o da mae ou do pai; aqui
 * costuma ser o proprio paciente, mas pode ser um parente. O cadastro nasce do
 * mesmo jeito (sem ele nao ha prontuario), marcado: a tela mostra "Nome a
 * confirmar" ate alguem conferir.
 *
 * Nulo depois que alguem da equipe salva o cadastro com o nome conferido.
 */
alter table public.patients
  add column if not exists name_from_contact_at timestamptz;

comment on column public.patients.name_from_contact_at is
  'Quando o sistema criou o cadastro com o nome do contato do WhatsApp, porque a ficha ficou sem o nome do paciente. Nulo depois que alguem da equipe confere e salva o nome.';

-- A tela limpa a marca ao salvar o cadastro com o nome conferido.
grant update (name_from_contact_at) on table public.patients to authenticated;

commit;
