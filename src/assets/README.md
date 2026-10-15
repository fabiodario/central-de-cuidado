# Arte de fundo da barra lateral

`sidebar-gastro-full.jpg` é a marca-d'água atrás do menu: uma criança de corpo
inteiro com o aparelho digestivo aceso. Este arquivo existe porque chegar nela
custou uma tarde inteira de tentativas erradas, em 20/09/2026, e o próximo que
for trocar essa imagem merece o atalho.

## Como a imagem é aplicada

```tsx
<img
  src={sidebarWatermark}
  alt=""
  aria-hidden="true"
  className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-[0.17] mix-blend-screen"
/>
<div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#081b2c]/80 via-[#081b2c]/25 to-[#081b2c]/80" />
```

Duas escolhas fazem esse trecho funcionar, e nenhuma é óbvia:

**`mix-blend-screen`.** A arte tem fundo escuro. Com opacidade pura, esse fundo
vira um retângulo de borda visível sobre o azul da barra. Com `screen`, o preto
da imagem some no azul e sobra apenas o brilho do desenho — sem emenda.

**O degradê por cima.** Escurece topo e base, clareia o meio. Protege as duas
pontas onde há conteúdo: o logo em cima, o cartão "Dados protegidos" embaixo.

## Como gerar uma imagem nova

1. Gere em **9:16**, pedindo personagem de **corpo inteiro, centralizado, com
   bastante espaço vazio nas laterais**. O espaço não é enfeite: é o que o
   `object-cover` vai comer.
2. Baixe o **arquivo original** do resultado. Nunca print de tela, miniatura ou
   prévia — elas vêm comprimidas e às vezes com elementos de interface.
3. Salve aqui, em `src/assets/`. Para web, ~640 × 1133 px, JPEG 85–90%, fica
   leve e nítido (o atual tem 69 KB).
4. **Abra o arquivo e confira** antes de integrar: sem texto, número ou marca;
   cabeça, mãos e pés inteiros; vertical; figura centralizada; sobra lateral.
5. Para corrigir, mande o original de volta como referência e peça **uma
   mudança por vez**, preservando o resto:

   > "Preserve o personagem, a anatomia, as cores e o estilo. Deixe a figura
   > mais estreita e centralizada. Aproxime os braços do corpo e as pernas entre
   > si. Acrescente espaço azul-escuro nas duas laterais. Mantenha cabeça, mãos
   > e pés completamente visíveis. Não adicione textos, números, logos, setas ou
   > marcas-d'água."

6. Veja **no tamanho real da barra**, não a imagem isolada. Confira se o
   `object-cover` está cortando braços ou pés. Teste numa tela alta E num
   notebook — o corte muda com a altura da janela.
7. Só publique depois de compilar e abrir a página no navegador.

## O que não funciona (aprendido do jeito difícil)

**Ajustar CSS não conserta arte de proporção errada.** A primeira tentativa usou
uma ilustração quase quadrada. Numa coluna de 286 × ~1265, não existe número que
a mostre inteira E cubra a altura: para preencher a altura ela precisaria de
~595 px de largura, e metade ficaria fora. Foram quatro rodadas mexendo em
largura, opacidade e `cover`/`contain` antes de perceber que o problema era a
imagem, não o CSS. **Quando dois ajustes seguidos não convergem, o defeito está
numa camada acima.**

**Encolher pelo CSS não resolve corte.** Diminuir a largura só reduz a figura na
coluna; o que falta é espaço vazio *dentro da arte*. Esse espaço se pede ao
gerador, não ao navegador.

**Prévia na altura errada é pior que prévia nenhuma.** Uma versão foi aprovada
numa simulação de 900 px de altura e chegou irreconhecível numa tela de 1265:
o `object-cover` escala pela altura da janela, então o mesmo CSS vira um close
gigante em monitor grande. Simule sempre na altura real de quem vai olhar.

**Vetorizar não era o caminho.** Houve uma tentativa de converter o PNG em SVG
com potrace para "afinar o traço". Funciona, mas troca uma arte pronta por um
preenchimento que engorda as linhas (o anti-aliasing da borda vira tinta) e
exige erosão para compensar. Para marca-d'água, JPEG com `mix-blend-screen`
entrega mais com muito menos.
