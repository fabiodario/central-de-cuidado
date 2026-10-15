begin;

/**
 * "Destravar" passa a valer contra a regra das 12h (01/10/2026).
 *
 * O robo fica calado por 12h depois que alguem da equipe escreve, para nao
 * falar por cima da atendente (_shared/lembrete.ts, equipeFalouRecentemente).
 * O botao Destravar limpava a etapa e a bandeira, mas nao essa regra: o Edu
 * destravou a propria conversa as 23:02, escreveu "Oi", e o robo seguiu mudo -
 * a equipe tinha escrito as 16:50 - acendendo a conversa como "Quer falar com
 * a equipe" sem ninguem ter pedido.
 *
 * Agora o Destravar grava a hora aqui, e o que a equipe escreveu antes dela
 * deixa de contar. Coluna lida a parte pelo webhook (padrao da casa).
 */

alter table public.whatsapp_conversations
  add column if not exists robo_liberado_em timestamptz;

comment on column public.whatsapp_conversations.robo_liberado_em is
  'Ultimo "Destravar": mensagens da equipe anteriores a isto nao calam o robo.';

commit;
