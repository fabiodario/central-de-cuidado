/**
 * Leitura tolerante dos parametros do endereco.
 *
 * O sistema usa rota por hash ("/#/"), e a certificadora acrescenta "state"
 * ao endereco de volta do jeito dela. Na pratica o parametro pode chegar de
 * tres formas:
 *
 *   https://site/?paciente=X&state=Y#/        (o correto)
 *   https://site/?paciente=X?state=Y#/        (segundo "?" em vez de "&")
 *   https://site/?paciente=X#/?state=Y        (depois do hash)
 *
 * Ler so o "location.search" perdia as duas ultimas, e a volta da assinatura
 * caia na lista de pacientes em vez do prontuario. Aqui as tres viram a
 * mesma coisa.
 */
export function parametrosDoEndereco(): URLSearchParams {
  const busca = window.location.search.replace(/^\?/, '')
  const hash = window.location.hash
  const noHash = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const juntos = [busca, noHash]
    .filter(Boolean)
    .join('&')
    // Um "?" perdido no meio e um separador que veio errado.
    .replace(/\?/g, '&')
  return new URLSearchParams(juntos)
}

/**
 * Tira parametros do endereco visivel, sem recarregar a pagina.
 * Limpa tanto a parte antes quanto a parte depois do hash.
 */
export function apagarParametrosDoEndereco(nomes: string[]) {
  const endereco = new URL(window.location.href)
  const restantes = parametrosDoEndereco()
  for (const nome of nomes) restantes.delete(nome)

  const hashLimpo = endereco.hash.includes('?')
    ? endereco.hash.slice(0, endereco.hash.indexOf('?'))
    : endereco.hash
  const busca = restantes.toString()
  const novo = `${endereco.origin}${endereco.pathname}${busca ? `?${busca}` : ''}${hashLimpo}`
  window.history.replaceState({}, '', novo)
}
