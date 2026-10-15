-- Pergunta de convênio reconhecida sem precisar saber o nome do plano.
--
-- Em 15/09/2026, três das seis conversas do dia perguntaram por convênio:
-- Unimed, Santa Saúde e Bluemed. Só a primeira foi reconhecida, porque a lista
-- de palavras tinha quatro marcas escritas à mão. A Rita perguntou "Dr Marcelo
-- atende santa saude?" e recebeu "Não entendi. Responda com o número da opção".
--
-- Correr atrás de nome de plano é briga perdida: são dezenas, mudam, e cada
-- região tem os seus. E é briga desnecessária, porque o consultório não atende
-- convênio nenhum: a resposta é a mesma para todos.
--
-- Então o que entra aqui são as palavras da PERGUNTA, e não as marcas:
-- "aceita", "atende", "cobertura", "saúde" (que pega "santa saúde", "amil
-- saúde", "plano de saúde"), "particular", "reembolso". As marcas mais comuns
-- ficam de reforço, para o caso de alguém escrever só o nome.
--
-- O preço disso: "vocês atendem crianças de 2 anos?" passa a receber o texto de
-- convênio. É um erro visível e de custo baixo - a família lê, entende que não
-- era aquilo e pergunta de novo, ou o *9* leva à equipe. O erro contrário,
-- responder "não entendi" para quem perguntou de plano, perde a pessoa em
-- silêncio.

begin;

update public.bot_answers
set keywords = array[
  -- as palavras da pergunta
  'convenio', 'convênio', 'convenios', 'convênios', 'plano', 'planos',
  'saude', 'saúde', 'aceita', 'aceitam', 'atende', 'atendem', 'atendimento',
  'cobertura', 'coberto', 'credenciado', 'credenciada', 'carteirinha',
  'reembolso', 'particular',
  -- as marcas mais ouvidas na Baixada e em São Paulo, de reforço
  'unimed', 'bradesco', 'amil', 'sulamerica', 'sulamérica', 'porto',
  'notredame', 'notre', 'hapvida', 'trasmontano', 'bluemed', 'blue',
  'santaria', 'santa', 'omint', 'careplus', 'golden', 'prevent', 'seguros'
]
where subject = 'Convênios';

commit;
