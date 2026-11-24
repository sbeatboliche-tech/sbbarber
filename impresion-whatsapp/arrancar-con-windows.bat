@echo off
rem Crea un acceso directo en la carpeta Inicio de Windows: el programa arranca solo (minimizado) al prender la compu.
rem Para sacarlo: borrar "Impresiones WhatsApp.lnk" de  shell:startup
cd /d "%~dp0"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Impresiones WhatsApp.lnk'); $s.TargetPath='%~dp0iniciar.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
echo Listo: el programa de impresiones va a arrancar solo cuando prendas la compu.
pause
