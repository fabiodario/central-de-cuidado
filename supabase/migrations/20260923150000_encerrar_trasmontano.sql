begin;

/**
 * O consultorio deixou de atender Trasmontano: SEM EFEITO NO BANCO DO DR.
 * FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: desfazia o Trasmontano que
 * 20260919120000 e 20260919140000 tinham ligado - esvaziava
 * clinic_units.accepts_insurance de quem aceitava Trasmontano e voltava a
 * resposta de Convenios e os textos das unidades e da telemedicina para "nao
 * atendemos convenio".
 *
 * Por que nao vale aqui: e o convenio da clinica DELE, e as duas migrations
 * que esta desfazia tambem ficaram sem efeito neste banco. Pior: o update da
 * resposta de Convenios nao filtrava por clinica. Se a clinica do Dr. Fabio ja
 * existisse quando ela rodasse, a resposta dele (Porto Saude, Unimed Santos e
 * Santa Saude) virava "Nao atendemos convenio". Entao nada e escrito.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
