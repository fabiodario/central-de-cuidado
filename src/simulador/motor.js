// O robo de verdade, o mesmo arquivo que roda no meta-webhook.
//
// Em .js, e nao .ts, de proposito: atendimento.ts importa um TIPO de
// whatsapp.ts, que importa 'npm:@supabase/supabase-js' e le Deno.env. Na
// execucao o import de tipo some, mas o tsc do site seguiria o caminho ate la e
// recusaria o build. Daqui o tsc nao passa (le motor.d.ts no lugar), e o Vite
// e o esbuild empacotam o robo normalmente.
//
// Copiar o robo para dentro do simulador nao era opcao: a demonstracao tem de
// responder exatamente o que a familia recebe no WhatsApp, inclusive depois da
// proxima correcao do robo.
export { tratarConversa, colherEventos } from '../../supabase/functions/_shared/atendimento.ts'
export { montarMensagens } from '../../supabase/functions/_shared/conteudo.ts'
