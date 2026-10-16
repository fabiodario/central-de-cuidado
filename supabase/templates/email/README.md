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

## O logo

Os cinco modelos mostram o logo do Dr. Fabio a partir de
`https://fabiodario.github.io/central-de-cuidado/logo-email.png` (16/10/2026):
o arquivo e `public/logo-email.png`, publicado junto com o sistema, e sai de
`scripts/marca/gerar_marca.py` (versao de letra branca para o cabecalho
azul-escuro, 400 px de largura, mostrada a 200 px). Se o sistema mudar de
endereco, troque nos cinco arquivos e cole de novo no Supabase.

## Remetente

Desde 16/10/2026 os e-mails saem pelo Gmail `fabiopavanisistema@gmail.com`
(Authentication → Emails → SMTP Settings: smtp.gmail.com, porta 465, com uma
senha de app da conta), com o nome "Central de Cuidado | Dr. Fábio Dario".
O servico de e-mail padrao do Supabase so entrega para quem e da equipe da
organizacao no Supabase, 2 por hora: o cadastro do Dr. Fabio e da Dayane e o
"Esqueci minha senha" nao funcionavam sem SMTP proprio.

O endereco `fabiopavani@proton.me` nao serve de remetente: a Proton so libera
SMTP para dominio proprio, e e-mail em nome de um @proton.me mandado por outro
servico cai no spam (a Proton publica DMARC com p=quarantine). Para sair de
`nao-responda@drfabiopavanidario.com.br`, o caminho e o Resend com o dominio,
que precisa de acesso ao DNS na GoDaddy.

Esses e-mails so vao para a equipe (confirmar cadastro, trocar senha):
paciente nunca recebe nenhum deles.
