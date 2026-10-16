# Arte de fundo da barra lateral

## Dr. Fábio: `sidebar-otorrino.jpg` (15/10/2026)

Perfil de cabeça e pescoço olhando para a esquerda, com o caminho do ar aceso:
nariz e seios da face, ouvido com a cóclea, faringe, laringe e traqueia até os
pulmões. Entrou no lugar de `sidebar-gastro-full.jpg`, a criança com o aparelho
digestivo do Dr. Marcello, que ainda aparecia no primeiro login publicado deste
sistema. Está no menu (`src/pages/Home.tsx`) e no login (`src/pages/Login.tsx`).

Gerada no GPT Image 2.5 (qualidade média, 9:16, 752 × 1344, reduzida para
640 × 1144 em JPEG 88%), com este pedido:

> Vertical 9:16 anatomical line illustration on a solid very dark navy blue
> background (#081b2c). Side profile view of an adult human head, neck and upper
> chest, facing left, centered horizontally, drawn with thin, delicate, softly
> glowing pale blue and white lines, like a calm medical hologram. The ear, nose
> and throat anatomy is the luminous highlight, glowing gently in warm white: the
> outer ear and the inner ear with the cochlea, the nasal cavity and the
> paranasal sinuses, the mouth and tongue, the pharynx, the larynx with the vocal
> cords, and the trachea descending down the neck into the upper chest where it
> branches into the two main bronchi. The skull, face contour, neck and shoulders
> are drawn only with faint thin outlines. Elegant, minimal, clinical, serene.
> The whole head is fully inside the frame with dark space above it, and there is
> generous empty dark navy space on the left and right sides. No text, no labels,
> no numbers, no letters, no logos, no arrows, no watermark, no border, no frame.

**Foco em 40% da largura (`object-[40%_center]`).** Ao contrário da criança de
corpo inteiro, esta arte ocupa a largura toda, e a coluna do menu (286 px)
mostra só uma faixa dela: num monitor alto, cerca de 40%. Centralizada, o nariz
ficava na borda e o ouvido saía da coluna. Com o foco em 40%, nariz e ouvido
ficam dentro dela do notebook (760 px de altura) ao monitor alto (1265 px). Arte
nova com outro enquadramento pede a conta de novo.

## A arte anterior (Dr. Marcello)

`sidebar-gastro-full.jpg` era a marca-d'água atrás do menu: uma criança de corpo
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
da imagem some no azul e sobra apenas o brilho do desenho, sem emenda.

**O degradê por cima.** Escurece topo e base, clareia o meio. Protege as duas
pontas onde há conteúdo: o logo em cima, o cartão "Dados protegidos" embaixo.

## Como gerar uma imagem nova

1. Gere em **9:16**, pedindo personagem de **corpo inteiro, centralizado, com
   bastante espaço vazio nas laterais**. O espaço não é enfeite: é o que o
   `object-cover` vai comer.
2. Baixe o **arquivo original** do resultado. Nunca print de tela, miniatura ou
   prévia: elas vêm comprimidas e às vezes com elementos de interface.
3. Salve aqui, em `src/assets/`. Para web, ~640 × 1133 px, JPEG 85 a 90%, fica
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
   notebook: o corte muda com a altura da janela.
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
