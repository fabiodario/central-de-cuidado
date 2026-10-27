-- Consulta e retorno (26/10/2026, vinda do sistema do Dr. Marcello no mesmo
-- dia, a pedido do Edu).
--
-- A regra: toda consulta da direito a UM retorno, no prazo que o medico
-- define no prontuario; o retorno nao abre outro. Ate aqui o prontuario abria
-- todo atendimento como "Retorno" (encounter_type = 'return'), e ninguem sabia
-- se o retorno incluido ja tinha sido usado (la, uma familia ouviu que o
-- retorno ia ate 02/11, contado de uma visita que ja era o retorno).
--
-- encounter_type continua como esta. Ele faz parte do atendimento assinado, e
-- consulta assinada nao muda (CFM 1.638/2002). As duas colunas novas sao
-- administrativas, como a etiqueta de um horario na agenda: o medico marca no
-- prontuario, a equipe pode corrigir depois da assinatura, e o PDF assinado
-- continua contando a mesma historia.
--
-- visita: 'consulta' ou 'retorno'. Nulo: atendimento de antes da regra; o
--   sistema deduz pela sequencia (ver supabase/functions/_shared/prazo-do-retorno.ts).
-- retorno_ate: ate quando vale o retorno desta consulta. Nulo: 30 dias. O
--   proprio dia do atendimento e "sem retorno".

begin;

alter table public.consultations
  add column if not exists visita text,
  add column if not exists retorno_ate date;

alter table public.consultations
  drop constraint if exists consultations_visita_check;
alter table public.consultations
  add constraint consultations_visita_check
    check (visita is null or visita in ('consulta', 'retorno'));

-- As duas ficam de fora de private.recusar_edicao_de_consulta_assinada de
-- proposito (ver acima). Escrever nelas depende das mesmas politicas de linha
-- do resto do atendimento.
grant insert (visita, retorno_ate) on table public.consultations to authenticated;
grant update (visita, retorno_ate) on table public.consultations to authenticated;

commit;
