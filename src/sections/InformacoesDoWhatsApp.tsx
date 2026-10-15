import { ArrowRight, MapPinned } from 'lucide-react'

/**
 * O que o robo responde quando a familia pede informacoes.
 *
 * Ate 14/10/2026 os textos de cada unidade e da telemedicina eram editados
 * aqui, com o valor escrito a mao dentro deles. O valor e o endereco moravam
 * em outro lugar (Agenda), e mudar o preco era lembrar de tres telas. Agora
 * tudo fica no cartao da unidade, em Agenda > Configuracao > Unidades, e o
 * texto usa {valor} e {endereco}. Esta secao ficou so para quem vier procurar
 * aqui por habito achar o caminho - duas telas editando o mesmo texto, com
 * regras diferentes, seria pedir para uma desfazer a outra.
 */
export default function InformacoesDoWhatsApp() {
  return (
    <section className="surface-card overflow-hidden rounded-[26px]">
      <div className="bg-gradient-to-r from-white to-[#f0f6fc] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#dceaf7] text-[#1f4f78]">
            <MapPinned className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#1f4f78]">Atendimento automático</p>
            <h2 className="mt-1 text-base font-extrabold tracking-[-0.03em] text-[#081b2c]">Informações por unidade</h2>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-slate-500">
              O que o robô responde sobre cada unidade e sobre a telemedicina agora fica junto do
              endereço e do valor da consulta, no cartão de cada uma:
            </p>
            <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[11px] font-extrabold text-[#1f4f78]">
              Agenda <ArrowRight className="h-3 w-3" /> Configuração <ArrowRight className="h-3 w-3" /> Unidades
            </p>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              Nos textos, escreva {'{valor}'} e {'{endereco}'} em vez de digitar o preço e a rua: o robô
              troca pelo que está no cartão na hora de enviar. Mudou o valor lá, muda em toda mensagem.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
