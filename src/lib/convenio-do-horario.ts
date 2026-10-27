/**
 * O convenio de um horario da agenda (26/10/2026, vindo do sistema do
 * Dr. Marcello no mesmo dia).
 *
 * Pedido do Edu: a recepcao ver na agenda, de bate-olho, quem vem por
 * convenio e quem e particular, e filtrar por um deles. Vale o que foi
 * escolhido no agendamento (o robo pergunta o plano nas unidades que atendem
 * convenio); sem isso, o convenio do cadastro. O resto e particular, escrito
 * sempre do mesmo jeito para o filtro juntar.
 *
 * Sem a marca "(T)" do Dr. Marcello: ela e da Trasmontano, convenio que so
 * existe la.
 */
export function convenioDoHorario(daConsulta: string | null | undefined, doCadastro: string | null | undefined): string {
  const limpo = (v: string | null | undefined) => {
    const t = String(v ?? '').trim().replace(/\s+/g, ' ')
    return t && t.toLowerCase() !== 'particular' ? t : ''
  }
  const achado = limpo(daConsulta) || limpo(doCadastro)
  if (!achado) return 'Particular'
  // "PORTO SAUDE", "porto saude": um nome so no filtro. A grafia fica a da
  // primeira letra maiuscula de cada palavra so quando veio tudo em caixa
  // alta ou baixa; "SulAmérica" escrito certo fica como esta.
  if (achado === achado.toUpperCase() || achado === achado.toLowerCase()) {
    return achado.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espaco: string, letra: string) => espaco + letra.toUpperCase())
  }
  return achado
}
