@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Simular conversas com o robo
echo ============================================
echo.
echo Mostra as conversas do Dr. Fabio inteiras, como
echo chegam no celular, para LER e julgar o texto. Nao
echo usa WhatsApp nem banco de verdade: ninguem recebe
echo mensagem. Dias e horarios das unidades ainda sao
echo de exemplo.
echo.

rem As dependencias ficam FORA do OneDrive (15/10/2026): node_modules e um
rem atalho (juncao) para a pasta fabio-dario-sistema dentro de LOCALAPPDATA.
rem Em outro computador o atalho nao existe: cria de novo e instala.
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

call npm run simular > simulacao-do-robo.txt 2>&1
if errorlevel 1 goto erro

start "" notepad simulacao-do-robo.txt
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
