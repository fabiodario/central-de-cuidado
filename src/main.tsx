import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { parametrosDoEndereco } from './lib/endereco.ts'

/**
 * Volta da assinatura digital numa aba que o proprio sistema abriu.
 *
 * O VIDaaS devolve o navegador para ca com o numero do pedido. Se esta aba foi
 * aberta pelo prontuario (window.opener existe e continua viva), a aba de
 * origem ja esta acompanhando a assinatura - esta aqui nao tem o que fazer
 * alem de sumir. Sem isto, cada assinatura deixava uma aba do sistema a mais
 * aberta, e o medico voltava para a lista de pacientes sem entender por que.
 *
 * Quando nao ha aba de origem (celular, ou o medico fez tudo numa aba so), a
 * aplicacao carrega normalmente e o prontuario conclui a assinatura.
 */
const voltaDaAssinatura = parametrosDoEndereco().get('state')
if (voltaDaAssinatura && window.opener && !window.opener.closed) {
  window.close()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
)
