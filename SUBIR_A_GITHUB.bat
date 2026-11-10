@echo off
title Subir a GitHub - Mitre Tickets
cd /d "%~dp0"
echo ========================================================
echo       SUBIENDO CODIGO A GITHUB (HORACE2109/mitre-tickets)
echo ========================================================
echo.
echo Conectando con GitHub...
git push -u origin main
echo.
echo ========================================================
if %ERRORLEVEL% EQU 0 (
    echo [OK] Codigo subido con exito a GitHub!
) else (
    echo [!] Hubo un error al subir.
)
echo ========================================================
pause
