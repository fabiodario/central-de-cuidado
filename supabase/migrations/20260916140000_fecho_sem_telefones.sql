begin;

/**
 * Tira os telefones da recepção do fecho das informações.
 *
 * O contato da clínica passou a ser um só: o número do robô, que é o mesmo do
 * site e da bio do Instagram. Oferecer dois telefones alternativos no fim de
 * toda resposta desfaz essa escolha - quem liga para a recepção sai do sistema,
 * e a conversa, o agendamento e o histórico ficam sem registro.
 *
 * Quem quer gente continua tendo caminho: o *9* chama a equipe, e ela responde
 * na mesma conversa.
 *
 * POR QUE UMA MIGRATION NOVA: este mesmo texto já tinha sido corrigido dentro
 * da migration 20260914130000, editada depois de ela ter sido aplicada. Como
 * migration roda uma vez só, a correção ficou no arquivo e nunca no banco, e o
 * paciente continuou lendo os telefones. Arquivo aplicado não se edita: se
 * precisa mudar, vem outro na frente.
 */

update public.clinic_settings
set whatsapp_menu_info_text =
  E'⚡ *Agendar por aqui é mais rápido*: digite *2* e escolha unidade, dia e horário na hora.\n\n' ||
  E'🙋 Quer falar com alguém da equipe? Digite *9*.\n\n' ||
  E'⏰ Segunda a sexta, 8h às 18h. Fora desse horário, respondemos no próximo dia útil.'
where strpos(whatsapp_menu_info_text, '3273-6828') > 0
   or strpos(whatsapp_menu_info_text, '99786-7273') > 0
   or strpos(whatsapp_menu_info_text, 'preferir ligar') > 0;

commit;
