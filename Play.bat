@echo off
REM ===========================================================================
REM  Run Wigglitz 3D via PowerShell -- compiles Game.cs in memory, so no
REM  standalone .exe is created. Assembles WorldGen.dll first if it's missing.
REM ===========================================================================
setlocal
set NET=C:\Windows\Microsoft.NET\Framework64\v4.0.30319
cd /d "%~dp0"

if not exist WorldGen.dll (
  echo Assembling WorldGen.dll from hand-written IL...
  "%NET%\ilasm.exe" /nologo /dll /quiet /output:WorldGen.dll WorldGen.il
  if errorlevel 1 ( echo Could not assemble WorldGen.dll. & pause & exit /b 1 )
)

powershell -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Play.ps1"
endlocal
