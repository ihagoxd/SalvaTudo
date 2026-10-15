@echo off
chcp 65001 >nul
title SalvaTudo
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERRO] O Node.js nao esta instalado neste computador.
  echo   Baixe a versao LTS em https://nodejs.org, instale e abra o SalvaTudo de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo.
  echo   ============================================
  echo     SalvaTudo - primeira vez neste computador
  echo   ============================================
  echo.
  echo   Instalando os componentes. Leva um ou dois minutos e so acontece agora.
  echo.
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   [ERRO] A instalacao falhou. Confira a internet e tente de novo.
    pause
    exit /b 1
  )
  echo.
  echo   Criando o atalho do SalvaTudo na area de trabalho...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\criar-atalho.ps1"
  echo.
)

rem Abre o app numa janela propria, sem esta janela preta.
start "" wscript.exe "%~dp0scripts\iniciar-oculto.vbs"
exit /b 0
