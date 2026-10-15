@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Testar o robo do WhatsApp
echo ============================================
echo.
echo Isto conversa com o robo sozinho, sem WhatsApp
echo e sem mexer no banco de dados de verdade.
echo Nenhum paciente recebe mensagem.
echo.

rem As dependencias podem nao estar instaladas nesta maquina.
rem Elas ficam FORA do OneDrive (15/10/2026): node_modules e um atalho
rem (juncao) para a pasta fabio-dario-sistema dentro de LOCALAPPDATA. Em
rem outro computador o atalho nao existe: cria de novo e instala.
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

call npm run test:bot
if errorlevel 1 goto erro

echo.
echo ============================================
echo   Leia a linha VERIFICACOES / FALHAS acima.
echo.
echo   FALHAS: 0  = esta tudo funcionando.
echo   Qualquer numero maior mostra logo abaixo
echo   o que deixou de funcionar.
echo ============================================
echo.
pause
exit /b 0

:erro
echo.
echo ============================================
echo   ALGO DEU ERRADO
echo.
echo   Copie a mensagem acima e mostre para o Claude.
echo ============================================
echo.
pause
exit /b 1
