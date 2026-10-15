begin;

/**
 * Respostas prontas do robô.
 *
 * Até aqui o robô só entendia o que ele mesmo tinha perguntado: número do menu,
 * dia, horário, nome. Quem escrevia "quanto custa a consulta?" recebia o menu
 * de volta, como se a pergunta não existisse - e ficava esperando alguém da
 * clínica responder algo que está escrito na parede da recepção.
 *
 * Aqui ficam os assuntos que a clínica quer que o robô responda sozinho. Cada
 * linha tem as palavras que identificam o assunto e o texto da resposta. Quem
 * escreve as respostas é a clínica, na tela de Preferências: nada aqui é
 * gerado, inventado ou deduzido pelo robô.
 *
 * O que NÃO entra aqui, por decisão e não por esquecimento: qualquer coisa
 * clínica. Dose de remédio, sintoma, "posso dar dipirona?" - isso é consulta,
 * vai para a equipe. A trava que garante isso está no código do atendimento,
 * antes da busca, e não depende do que for cadastrado nesta tabela.
 */

create table if not exists public.bot_answers (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  -- Nome do assunto. Aparece só para a equipe, na tela e no histórico.
  subject text not null,
  -- As palavras que identificam a pergunta, uma por linha na tela. Guardadas
  -- como array porque a busca compara palavra a palavra: com tudo num campo de
  -- texto seria preciso separar de novo a cada mensagem que chega.
  keywords text[] not null default '{}',
  -- O que o robô responde, exatamente como está escrito.
  answer text not null,
  is_active boolean not null default true,
  -- Empate de pontuação é resolvido pela ordem: o assunto de cima ganha.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bot_answers_subject_length check (char_length(btrim(subject)) between 1 and 120),
  constraint bot_answers_answer_length check (char_length(btrim(answer)) between 1 and 1024),
  constraint bot_answers_keywords_limit check (array_length(keywords, 1) is null or array_length(keywords, 1) <= 40)
);

comment on table public.bot_answers is
  'Respostas prontas que o robo do WhatsApp da sozinho, escritas pela clinica.';
comment on column public.bot_answers.keywords is
  'Palavras que identificam o assunto. A busca ignora acento e maiuscula.';
comment on column public.bot_answers.answer is
  'Texto enviado ao paciente, sem alteracao. Limite de 1024 por causa do corpo com botoes da Meta.';

create index if not exists bot_answers_clinic_idx
  on public.bot_answers (clinic_id, position) where is_active;

drop trigger if exists bot_answers_set_updated_at on public.bot_answers;
create trigger bot_answers_set_updated_at
before update on public.bot_answers
for each row execute function private.set_updated_at();

alter table public.bot_answers enable row level security;
alter table public.bot_answers force row level security;

-- Ler: qualquer membro. Escrever: só perfil de edição, como nas unidades - o
-- que o robô fala para as famílias não é coisa de perfil somente-visualização.
drop policy if exists bot_answers_select_member on public.bot_answers;
create policy bot_answers_select_member on public.bot_answers
for select to authenticated using ((select private.is_clinic_member(clinic_id)));

drop policy if exists bot_answers_write_editor on public.bot_answers;
create policy bot_answers_write_editor on public.bot_answers
for all to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

grant select, insert, update, delete on table public.bot_answers to authenticated;
-- O webhook roda como service_role e só lê.
grant select on table public.bot_answers to service_role;

/**
 * Os quatro assuntos que a clínica pediu para começar.
 *
 * No sistema do Dr. Marcello aqui vinha o rascunho desativado de quatro
 * respostas (valor, convenios, endereco, o que levar), criado para toda
 * clinica sem resposta nenhuma - com os enderecos DELE (Livance Ibirapuera e
 * Liferty Santos), "sem convenio credenciado" e "carteirinha de vacinacao da
 * crianca".
 *
 * No banco do Dr. Fabio (15/10/2026) esse insert saiu; a tabela acima fica.
 * Num banco novo ele nao acharia clinica nenhuma, mas se a do Dr. Fabio ja
 * existisse quando isto rodasse, ela ganharia rascunhos com o endereco e o
 * convenio de outra clinica. As respostas prontas do Dr. Fabio sao as de
 * src/simulador/dados.ts, cadastradas pela tela ou na carga inicial da
 * clinica. Esta migration ainda nao tinha sido aplicada no banco do Dr.
 * Fabio, entao foi ajustada aqui mesmo; o original esta no repositorio do Dr.
 * Marcello.
 */

commit;
