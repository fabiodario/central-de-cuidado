@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Gerar o simulador do Dr. Fabio Dario
echo ============================================
echo.
echo Confere o robo e gera o arquivo
echo "SIMULADOR - Dr Fabio Dario.html", que abre
echo com duplo clique, sem internet e sem login.
echo Nada e enviado a ninguem.
echo.

rem As dependencias ficam FORA do OneDrive (15/10/2026): a pasta node_modules
rem do projeto e um atalho (juncao) para %LOCALAPPDATA%\fabio-dario-sistema.
rem Sao 27 mil arquivos que o OneDrive nao precisa sincronizar, e o npm falha
rem quando o OneDrive trava um deles no meio da instalacao. Em outro
rem computador o atalho nao existe: cria de novo e instala.
if not exist "node_modules\.bin\esbuild.cmd" (
  echo --- Preparando pela primeira vez, pode demorar alguns minutos ---
  if not exist "node_modules" (
    mkdir "%LOCALAPPDATA%\fabio-dario-sistema\node_modules" >nul 2>&1
    mklink /J "node_modules" "%LOCALAPPDATA%\fabio-dario-sistema\node_modules" >nul
  )
  call npm install
  if errorlevel 1 goto erro
  echo.
)

rem Primeiro os testes: um roteiro quebrado tem de aparecer aqui, e nao na
rem frente do Dr. Fabio.
echo --- Conferindo o robo (leva cerca de um minuto) ---
call npm run test:bot
if errorlevel 1 goto erro

echo.
echo --- Gerando o arquivo ---
call npm run simulador:arquivo
if errorlevel 1 goto erro

echo.
echo ============================================
echo   Pronto! Abra o arquivo
echo   SIMULADOR - Dr Fabio Dario.html
echo   (esta na pasta FABIO DARIO e aqui dentro)
echo ============================================
echo.
pause
exit /b 0

:erro
echo.
echo ============================================
echo   ALGO DEU ERRADO
echo   Copie a mensagem acima e mostre para o Claude.
echo ============================================
echo.
pause
exit /b 1
