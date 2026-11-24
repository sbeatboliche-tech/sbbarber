@echo off
title Impresiones WhatsApp - SB Barber
cd /d "%~dp0"
if not exist node_modules (
    echo Instalando por primera vez, puede tardar un par de minutos...
    call npm install
)
echo.
echo  Impresiones WhatsApp: el panel se abre en Chrome (http://localhost:3939)
echo  No cierres esta ventana: si la cerras, dejan de entrar las fotos.
echo.
:loop
node index.js
echo El programa se cerro. Se vuelve a abrir en 10 segundos (cerra esta ventana para frenarlo)...
timeout /t 10 /nobreak >nul
goto loop
