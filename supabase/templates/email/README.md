# Modelos de e-mail do login (Supabase Auth)

Onde colar: Supabase → Authentication → Email Templates. Para cada modelo,
troque o **Subject** e cole o HTML do arquivo no corpo. Salve um por um.

| Modelo no Supabase   | Arquivo                 | Assunto                                           |
|----------------------|-------------------------|---------------------------------------------------|
| Confirm signup       | confirmar-cadastro.html | Confirme seu e-mail · Central de Cuidado          |
| Reset password       | redefinir-senha.html    | Redefinir sua senha · Central de Cuidado          |
| Magic Link           | link-magico.html        | Seu link de acesso · Central de Cuidado           |
| Change Email Address | alterar-email.html      | Confirme a troca de e-mail · Central de Cuidado   |
| Invite user          | convite.html            | Convite para a Central de Cuidado                 |

As variaveis entre chaves duplas ({{ .ConfirmationURL }}, {{ .NewEmail }}) sao
preenchidas pelo Supabase; nao mexa nelas.

## Antes de colar: o logo

Os cinco modelos mostram o logo do Dr. Fabio a partir de
`https://PREENCHER-DOMINIO-DO-DR-FABIO/assets/logo-email.png`. O marcador e de
proposito (15/10/2026): o endereco onde o logo vai ficar ainda nao existe, e o
que estava aqui era o logo do Dr. Marcello, de onde o sistema veio. Publique o
logo (PNG claro, largura 400 px, para o fundo azul-escuro do cabecalho) e
troque o marcador nos cinco arquivos antes de colar no Supabase. Sem isso o
e-mail mostra so o texto alternativo "Dr. Fábio Dario" no lugar da imagem.

## Remetente

O nome "Supabase Auth" e o endereco noreply@mail.app.supabase.io so mudam com
SMTP proprio (Authentication → SMTP Settings). Precisa de uma conta num
provedor de envio (Resend, Brevo, SendGrid...) e de um dominio verificado,
por exemplo um endereco no dominio do site do Dr. Fabio (drfabiopavanidario.com.br),
se o consultorio liberar. Sem isso o texto fica bonito, mas o remetente
continua sendo o do Supabase.
