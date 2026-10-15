begin;

/**
 * Fecha, de uma vez, as conversas que o robô já tinha resolvido sozinho.
 *
 * Desde 20/09/2026 o robô marca a conversa como resolvida ao terminar a ficha:
 * cadastro completo, consulta marcada, nada pendente para a equipe. Mas quem
 * grava isso é o webhook, no instante em que ele responde - o passado não se
 * marca sozinho.
 *
 * E o passado é justamente o que atrapalha. A conversa da Júlia, de 18/09, tem
 * cadastro feito e consulta marcada para 25/09, e mesmo assim aparecia sem
 * marca nenhuma na lista: "Respondida" é sobre alguém da equipe ter escrito, e
 * ali só o robô falou; "Resolvida" só vinha de alguém clicar em Concluir. Um
 * cartão com cara de pendência que não existe, e a recepção abrindo um por um
 * para descobrir isso.
 *
 * O CRITÉRIO, e por que ele é estreito:
 *
 *  - a ÚLTIMA mensagem da conversa é o comprovante do robô. Se a família
 *    escreveu qualquer coisa depois, alguém pode estar esperando resposta, e
 *    esta migration não toca. Ordenar por created_at e olhar só a primeira é o
 *    que garante isso.
 *  - a mensagem é do robô (automatic), não digitada por alguém da equipe.
 *  - a conversa está aberta e sem bandeira de atenção. Com bandeira, há pedido
 *    de pé - e pedido aberto vence "parece pronto".
 *
 * Não é definitivo em nenhum caso: a próxima mensagem da família devolve a
 * conversa para 'open', no mesmo ponto do webhook que trata toda mensagem
 * recebida. O pior caso aqui é uma conversa encerrada voltar à lista quando
 * alguém escrever - que é exatamente o comportamento desejado.
 *
 * Não apaga mensagem, cadastro nem consulta. Só muda status.
 */

update public.whatsapp_conversations as c
set status = 'resolved',
    unread_count = 0
where c.status = 'open'
  and c.needs_attention = false
  and exists (
    select 1
    from public.whatsapp_messages as m
    where m.conversation_id = c.id
      and m.direction = 'outbound'
      and m.automatic = true
      -- "Tudo certo, obrigado!" é o texto que o robô só escreve ao FECHAR a
      -- ficha. O acento vai no LIKE porque a mensagem é gravada como foi
      -- enviada, e o comprovante nunca variou desde que existe.
      and m.body like '%Tudo certo, obrigado!%'
      -- ... e precisa ser a última mensagem da conversa.
      and m.created_at = (
        select max(m2.created_at)
        from public.whatsapp_messages as m2
        where m2.conversation_id = c.id
      )
  );

commit;
