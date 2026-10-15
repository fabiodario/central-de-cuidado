begin;

/**
 * Respostas prontas do robo: so o administrador escreve (24/09/2026).
 *
 * A tela de Preferencias saiu do menu da recepcao, e esta e a mesma regra no
 * banco - senao bastaria chamar a API para mudar o que o robo diz a todas as
 * familias. Ler continua liberado para qualquer membro: a tela de conversas
 * usa as respostas no atalho "Resposta pronta".
 *
 * clinic_settings ja era so do administrador desde o inicio. clinic_units
 * continua com perfil de edicao, porque a Agenda (horarios e unidades) e
 * trabalho da recepcao.
 */

drop policy if exists bot_answers_write_editor on public.bot_answers;
drop policy if exists bot_answers_write_owner on public.bot_answers;
create policy bot_answers_write_owner on public.bot_answers
for all to authenticated
using ((select private.is_clinic_owner(clinic_id)))
with check ((select private.is_clinic_owner(clinic_id)));

commit;
