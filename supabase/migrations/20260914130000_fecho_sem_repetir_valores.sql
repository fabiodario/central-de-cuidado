-- O fecho das informações estava repetindo valor e convênio.
--
-- Quando as informações passaram a ser por unidade (11/09), o texto único da
-- clínica deveria virar só o fecho: como agendar, como falar com a equipe,
-- telefones e horário. A migration daquele dia tentou fazer isso, mas a
-- condição era "like '%R$ 450%'" - e o texto gravado usa espaço que não é o
-- espaço comum entre o "R$" e o número. A comparação falhou em silêncio, o
-- campo ficou como estava, e o robô passou a mandar valor e convênio duas
-- vezes: uma no texto da unidade, outra no fecho.
--
-- Aqui a condição não depende de pontuação nem de espaço: procura pedaços que
-- só existem no texto antigo. O "450" sozinho basta - o fecho novo não fala de
-- preço em lugar nenhum, então encontrá-lo é prova de que o campo ainda é o
-- texto de antes da divisão.
--
-- A linha sobre urgência por teleconsulta sai junto. Ela virou fluxo de
-- verdade: quem escolhe telemedicina recebe a saída de urgência na própria
-- resposta, e o robô transfere para a equipe. Repetir a frase em toda unidade
-- prometia teleconsulta urgente a quem perguntou sobre Santos.

begin;

update public.clinic_settings
set whatsapp_menu_info_text =
  E'⚡ *Agendar por aqui é mais rápido*: digite *2* e escolha unidade, dia e horário na hora.\n\n' ||
  -- *9* e nao *3*: o 9 chama a equipe em qualquer etapa da conversa, e o 3 so
  -- funciona enquanto a pessoa esta no menu. Como a mesma mensagem termina
  -- dizendo "digite 9 para falar com a nossa equipe", mandar 3 duas linhas
  -- acima era dar dois numeros para a mesma coisa.
  E'🙋 Quer falar com alguém da equipe? Digite *9*.\n\n' ||
  -- Sem os telefones da recepcao.
  --
  -- O contato da clinica passou a ser um so: este numero, o do robo. E o que
  -- esta no site e na bio do Instagram, e oferecer dois telefones alternativos
  -- aqui desfazia essa escolha - quem liga para a recepcao sai do sistema, e
  -- a conversa, o agendamento e o historico ficam sem registro.
  E'⏰ Segunda a sexta, 8h às 18h. Fora desse horário, respondemos no próximo dia útil.'
where strpos(whatsapp_menu_info_text, '450') > 0
   or strpos(whatsapp_menu_info_text, 'convênio') > 0
   or strpos(whatsapp_menu_info_text, 'convenio') > 0
   or strpos(whatsapp_menu_info_text, 'teleconsulta') > 0
   -- Tambem pega o texto que ja foi corrigido a mao na tela mas continua
   -- oferecendo os telefones da recepcao.
   or strpos(whatsapp_menu_info_text, '3273-6828') > 0
   or strpos(whatsapp_menu_info_text, '99786-7273') > 0;

commit;
