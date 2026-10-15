@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Publicar Central de Cuidado - Dr. Fabio Dario
echo ============================================
echo.

rem Repositorio do GitHub do Dr. Fabio Dario (15/10/2026).
rem
rem Este projeto nasceu como espelho do sistema do Dr. Marcello Ruiz, e esta
rem linha apontava para o repositorio DELE, que publica o sistema em producao
rem com pacientes reais. Rodar o PUBLICAR daqui sem trocar mandaria o sistema
rem do Dr. Fabio por cima do de outra clinica. Por isso fica vazio, e vazio
rem nao publica nada: preencha so quando o repositorio do Dr. Fabio existir.
rem   CONTA_GITHUB = usuario do GitHub (ex.: consultoriofabiodario)
rem   REPOSITORIO  = usuario/nome (ex.: consultoriofabiodario/central-de-cuidado)
set "CONTA_GITHUB=fabiodario"
set "REPOSITORIO=fabiodario/central-de-cuidado"
if "%REPOSITORIO%"=="" goto sem_repositorio
echo %REPOSITORIO% | findstr /i "clinicamarcelloruiz" >nul && goto repositorio_errado

rem Remove a trava que sobra quando algum processo de git foi interrompido.
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1

rem Confere o projeto ANTES de enviar, com os mesmos comandos que o GitHub usa.
rem Em 30/08/2026 um erro de tipagem passou daqui e a publicacao falhou la, sem
rem ninguem perceber: o site continuou com a versao antiga por horas.
echo --- Conferindo o projeto (leva cerca de dois minutos) ---
call npm run lint
if errorlevel 1 goto erro_conferencia
call npm run build
if errorlevel 1 goto erro_conferencia
call npm run test:bot
if errorlevel 1 goto erro_conferencia
echo.
echo Conferencia OK.
echo.

rem Fixa a conta do GitHub na URL do repositorio. Sem isso, com mais de uma
rem conta salva no Windows, o git abre uma janela perguntando qual usar - e no
rem agendador de tarefas nao ha ninguem para clicar nela.
git remote set-url origin https://%CONTA_GITHUB%@github.com/%REPOSITORIO%.git
if errorlevel 1 goto erro
git config credential.username %CONTA_GITHUB%

rem A mensagem do commit leva data e hora, entao nao precisa digitar nada.
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format \"dd/MM/yyyy HH:mm\""') do set "AGORA=%%i"
set "MSG=Atualizacao do sistema %AGORA%"

rem Em 06/09/2026 a lista abaixo nao tinha o vite.config.ts. A tela usava uma
rem variavel definida la, o GitHub montou sem ela, e o sistema abriu em branco -
rem sem erro nenhum na conferencia, porque na maquina o arquivo existia.
rem
rem O "git add -u" e o conserto: ele envia TODA alteracao em arquivo que ja faz
rem parte do projeto, sem depender de alguem lembrar de citar o nome. A lista
rem depois dele so serve para arquivo novo, que ninguem conhece ainda. E o que
rem nao esta em nenhum dos dois - rascunho, teste, pasta tmp - fica de fora de
rem proposito: o repositorio e publico.
rem Em 20/09/2026 a pasta tests e o CLAUDE.md ficaram de fora desta lista e
rem viviam so na maquina do Edu: os testes do robo - a rede que impede uma
rem publicacao quebrada - nao existiam para mais ninguem, e o GitHub nao tinha
rem como roda-los. Entraram aqui por isso.
rem
rem ATENCAO: o repositorio e publico. Nada em tests/ pode ter nome, telefone,
rem CPF ou data de nascimento de paciente de verdade - use dados inventados,
rem sempre. Na mesma data foi preciso limpar dados que vieram de um print de
rem conversa real.
rem
rem Em 13/10/2026 entrou o simulador do atendimento: a pagina simuladorbot/ e o
rem build proprio dela, vite.simulador.config.ts. Os dois ficam fora de src e
rem por isso estao na lista. Sem eles o GitHub nao acha a pagina nem a
rem configuracao, o "npm run build" falha la e NADA vai ao ar - nem as
rem correcoes do sistema que iam junto.
echo --- Preparando arquivos ---
git add -u
if errorlevel 1 goto erro
git add src supabase .github public index.html package.json vite.config.ts tests CLAUDE.md simuladorbot vite.simulador.config.ts
if errorlevel 1 goto erro

echo.
echo --- Registrando a alteracao ---
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo Nada novo para publicar. Tudo ja estava enviado.
  echo.
  echo Esta janela fecha em 10 segundos.
  timeout /t 10 >nul
  exit /b 0
)

echo.
echo --- Enviando para o GitHub ---
git push origin HEAD:main
if errorlevel 1 goto erro

rem Guarda o codigo desta publicacao para conferir depois.
rem "Publiquei" e "esta no ar" sao duas coisas diferentes: o GitHub leva alguns
rem minutos para servir o build novo e o navegador ainda guarda o antigo. Sem um
rem codigo para comparar, so restava adivinhar olhando a tela.
rem O "=" dentro do for /f precisa do ^ antes: sem ele o cmd trata o "=" como
rem espaco, o git recebe "--short 7 HEAD" e responde "Needed a single
rem revision". Foi assim ate 23/09/2026: a versao saia em branco.
for /f %%i in ('git rev-parse --short^=7 HEAD') do set "VERSAO=%%i"

echo.
echo ============================================
echo   Pronto!
echo.
echo   VERSAO PUBLICADA:  %VERSAO%
echo.
echo   Em alguns minutos, o rodape do menu lateral
echo   do sistema tem que mostrar esse mesmo codigo.
echo   Se mostrar outro, a pagina ainda esta velha:
echo   atualize com Ctrl+F5.
echo.
echo   Acompanhe a publicacao em:
echo   github.com/%REPOSITORIO%/actions
echo ============================================
echo.
echo Esta janela fecha em 30 segundos.
timeout /t 30 >nul
exit /b 0

:sem_repositorio
echo.
echo ============================================
echo   PUBLICACAO AINDA NAO CONFIGURADA
echo.
echo   O sistema do Dr. Fabio ainda nao tem
echo   repositorio no GitHub. Nada foi enviado.
echo.
echo   Para simular o robo, use o arquivo
echo   SIMULADOR - Dr Fabio Dario.html
echo ============================================
echo.
pause
exit /b 1

:repositorio_errado
echo.
echo ============================================
echo   REPOSITORIO DE OUTRA CLINICA
echo.
echo   O endereco configurado e o do Dr. Marcello.
echo   Nada foi enviado. Troque o REPOSITORIO no
echo   comeco deste arquivo pelo do Dr. Fabio.
echo ============================================
echo.
pause
exit /b 1

:erro_conferencia
echo.
echo ============================================
echo   NAO PUBLIQUEI - O PROJETO TEM UM ERRO
echo.
echo   Nada foi enviado, entao o sistema no ar
echo   continua funcionando como esta.
echo.
echo   Copie a mensagem de erro acima e mostre
echo   para o Claude.
echo ============================================
echo.
pause
exit /b 1

:erro
echo.
echo ============================================
echo   ALGO DEU ERRADO
echo.
echo   Copie a mensagem acima e mostre para o Claude.
echo   Esta janela NAO fecha sozinha, para voce
echo   conseguir ler o erro.
echo ============================================
echo.
pause
exit /b 1
