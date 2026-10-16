"""Logo e icones do Dr. Fabio Dario, a partir do simbolo em alta (15/10/2026).

Por que existe: o primeiro logo do sistema veio do cabecalho do site dele, com
262 x 47 px. Ampliado no login ele borrava, a caixa mais estreita que ele o
achatava, e o filtro que pinta o logo de branco (o mesmo do logo do produto)
fundia os tres circulos coloridos em manchas. Os icones (aba, atalho do
celular, selo das notificacoes) ainda eram o "M" do Dr. Marcello.

O simbolo (tres circulos com ouvido, perfil e pescoco) e o favicon do site
dele, que tem 1983 px: simbolo-original.png, nesta pasta. O texto do logo e
redesenhado em Century Gothic (vem com o Windows e o Office), a fonte
geometrica mais proxima do logo original.

Uso, da raiz do projeto:
    python scripts/marca/gerar_marca.py

Gera:
    src/assets/fabio-logo-fundo-claro.png   traco preto, texto escuro (impressao, troca de senha)
    src/assets/fabio-logo-fundo-escuro.png  traco creme, texto branco (login, menu, simulador)
    src/assets/fabio-icone.png              foto do robo no simulador
    public/logo-email.png                   cabecalho dos e-mails do login
    public/favicon.ico, icone-16/32/192/512, icone-maskable-512,
    apple-touch-icon, icone-badge
Depois de gerar, suba o ?v= dos icones em index.html, public/manifest.json e
public/sw.js: o navegador guarda icone por muito tempo.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parents[2]
ASSETS = RAIZ / 'src' / 'assets'
PUBLIC = RAIZ / 'public'
FONTES = Path('C:/Windows/Fonts')

PRETO = (0, 0, 0, 255)
CREME = (243, 238, 228)
TEXTO_ESCURO = (26, 26, 26, 255)
BRANCO = (255, 255, 255, 255)

simbolo = Image.open(Path(__file__).with_name('simbolo-original.png')).convert('RGBA')
simbolo = simbolo.crop(simbolo.getbbox())


def traco_em(img, cor):
    """Troca o traco preto do desenho por outra cor, mantendo a borda suave."""
    img = img.copy()
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a and max(r, g, b) < 90:
                t = 1 - max(r, g, b) / 90
                px[x, y] = (round(r + (cor[0] - r) * t), round(g + (cor[1] - g) * t), round(b + (cor[2] - b) * t), a)
    return img


def quadrado(img):
    lado = max(img.size)
    q = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    q.alpha_composite(img, ((lado - img.width) // 2, (lado - img.height) // 2))
    return q


# ---------------------------------------------------------------- logo

def logo(simb, cor_texto, saida, altura=280, altura_final=200):
    margem = 8
    alt_simb = altura - 2 * margem
    simb = simb.resize((round(simb.width * alt_simb / simb.height), alt_simb), Image.LANCZOS)
    rascunho = ImageDraw.Draw(Image.new('RGBA', (10, 10)))

    # Proporcoes do logo original: maiuscula do nome ~27% da altura,
    # subtitulo com 34% do corpo do nome, espacado ate ~97% da largura dele.
    ref = ImageFont.truetype(str(FONTES / 'GOTHIC.TTF'), 100)
    cap = rascunho.textbbox((0, 0), 'D', font=ref)
    tam = round(100 * (altura * 0.27) / (cap[3] - cap[1]))
    regular = ImageFont.truetype(str(FONTES / 'GOTHIC.TTF'), tam)
    negrito = ImageFont.truetype(str(FONTES / 'GOTHICB.TTF'), tam)
    parte1, parte2 = 'DR. FÁBIO ', 'DÁRIO'
    larg_nome = rascunho.textlength(parte1, font=regular) + rascunho.textlength(parte2, font=negrito)

    sub = 'OTORRINOLARINGOLOGISTA | RINOPLASTIA'
    fonte_sub = ImageFont.truetype(str(FONTES / 'GOTHICB.TTF'), round(tam * 0.34))
    larg_sub = sum(rascunho.textlength(c, font=fonte_sub) for c in sub)
    espaco = max(0.0, (larg_nome * 0.97 - larg_sub) / (len(sub) - 1))

    vao = round(altura * 0.16)
    largura = margem + simb.width + vao + round(max(larg_nome, larg_sub + espaco * (len(sub) - 1))) + margem
    tela = Image.new('RGBA', (largura, altura), (0, 0, 0, 0))
    tela.alpha_composite(simb, (margem, margem))
    d = ImageDraw.Draw(tela)

    x0 = margem + simb.width + vao
    bb_cap = d.textbbox((0, 0), 'D', font=negrito)
    bb_sub = d.textbbox((0, 0), 'O', font=fonte_sub)
    alt_cap, alt_sub = bb_cap[3] - bb_cap[1], bb_sub[3] - bb_sub[1]
    entre = round(altura * 0.085)
    topo = round((altura - (alt_cap + entre + alt_sub)) / 2) + round(altura * 0.02)
    y = topo - bb_cap[1]
    d.text((x0, y), parte1, font=regular, fill=cor_texto)
    d.text((x0 + d.textlength(parte1, font=regular), y), parte2, font=negrito, fill=cor_texto)
    x, y = x0 + 2, topo + alt_cap + entre - bb_sub[1]
    for c in sub:
        d.text((x, y), c, font=fonte_sub, fill=cor_texto)
        x += d.textlength(c, font=fonte_sub) + espaco

    tela = tela.crop(tela.getbbox())
    final = Image.new('RGBA', (tela.width + 2 * margem, tela.height + 2 * margem), (0, 0, 0, 0))
    final.alpha_composite(tela, (margem, margem))
    # 200 px de altura: 3,5x o maior tamanho na tela (56 px). Paleta de 128
    # cores: o sistema e um arquivo unico, e cada imagem vai dentro dele.
    final = final.resize((round(final.width * altura_final / final.height), altura_final), Image.LANCZOS)
    final.quantize(colors=128, method=Image.FASTOCTREE, dither=Image.NONE).save(saida, optimize=True)


logo(simbolo, TEXTO_ESCURO, ASSETS / 'fabio-logo-fundo-claro.png')
logo(traco_em(simbolo, CREME), BRANCO, ASSETS / 'fabio-logo-fundo-escuro.png')
# Cabecalho azul-escuro dos e-mails do login (supabase/templates/email): 400 px
# de largura, mostrado a 200 px, nitido em tela retina. Fica em public/ para
# ter endereco proprio no site (os e-mails buscam a imagem pela internet).
logo(traco_em(simbolo, CREME), BRANCO, PUBLIC / 'logo-email.png', altura_final=95)

# ---------------------------------------------------------------- icones

sim_q = quadrado(simbolo)
sim_q_escuro = quadrado(traco_em(simbolo, CREME))


def em_fundo(lado, proporcao, arredondado):
    """Simbolo centralizado no preto do site dele. proporcao = parte do lado."""
    tela = Image.new('RGBA', (lado, lado), PRETO)
    s = round(lado * proporcao)
    tela.alpha_composite(sim_q_escuro.resize((s, s), Image.LANCZOS), ((lado - s) // 2, (lado - s) // 2))
    if arredondado:
        mascara = Image.new('L', (lado * 4, lado * 4), 0)
        ImageDraw.Draw(mascara).rounded_rectangle((0, 0, lado * 4 - 1, lado * 4 - 1), radius=round(lado * 4 * 0.22), fill=255)
        tela.putalpha(ImageChops.multiply(tela.getchannel('A'), mascara.resize((lado, lado), Image.LANCZOS)))
    return tela


# Aba do navegador: os circulos sobre transparente. O traco some nesse
# tamanho; o que se reconhece sao as tres cores.
for lado in (16, 32):
    sim_q.resize((lado, lado), Image.LANCZOS).save(PUBLIC / f'icone-{lado}.png', optimize=True)
sim_q.resize((256, 256), Image.LANCZOS).save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

# Atalho no celular. O maskable e recortado em circulo pelo Android: o simbolo
# fica dentro dos 80% centrais. O do iPhone e opaco, o iOS arredonda.
em_fundo(192, 0.80, True).save(PUBLIC / 'icone-192.png', optimize=True)
em_fundo(512, 0.80, True).save(PUBLIC / 'icone-512.png', optimize=True)
em_fundo(512, 0.62, False).save(PUBLIC / 'icone-maskable-512.png', optimize=True)
em_fundo(180, 0.78, False).convert('RGB').save(PUBLIC / 'apple-touch-icon.png', optimize=True)

# Selo da notificacao: o Android so usa a transparencia. Os circulos em
# branco com o desenho vazado, para nao virar uma mancha.
traco = Image.new('L', sim_q.size, 0)
px, pt = sim_q.load(), traco.load()
for y in range(sim_q.height):
    for x in range(sim_q.width):
        r, g, b, a = px[x, y]
        if a and max(r, g, b) < 90:
            pt[x, y] = round(a * (1 - max(r, g, b) / 90))
selo = Image.new('RGBA', sim_q.size, (255, 255, 255, 0))
selo.putalpha(ImageChops.subtract(sim_q.getchannel('A'), traco))
selo.resize((96, 96), Image.LANCZOS).save(PUBLIC / 'icone-badge.png', optimize=True)

# Foto do robo no simulador e icone da pagina dele.
em_fundo(256, 0.82, False).convert('RGB').save(ASSETS / 'fabio-icone.png', optimize=True)
print('logo e icones gerados')
