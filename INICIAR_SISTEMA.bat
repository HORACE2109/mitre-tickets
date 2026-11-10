@echo off
title Sistema Mitre - Entradas y Control de Acceso
echo ===================================================
echo     INICIANDO SISTEMA MITRE (SERVIDOR + TUNEL)
echo ===================================================
echo.
cd /d "%~dp0"

echo [1/2] Iniciando Servidor Node.js...
start /b node server.js

timeout /t 2 >nul

echo [2/2] Iniciando Tunel HTTPS Cloudflare para celular...
start .\cloudflared.exe tunnel --url http://localhost:3000

echo.
echo ===================================================
echo Sistema Listo!
echo Acceso en esta PC: http://localhost:3000
echo Acceso en Celular: mira la direccion HTTPS en la ventana de Cloudflare
echo ===================================================
pause
