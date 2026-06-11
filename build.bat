@echo off
REM ===========================================================================
REM  Build Wigglitz 3D using ONLY tools that ship with Windows (no install).
REM    1) ilasm.exe assembles the hand-written IL  -> WorldGen.dll
REM    2) csc.exe   compiles the C# raycaster shell -> Wigglitz3D.exe
REM ===========================================================================
setlocal
set NET=C:\Windows\Microsoft.NET\Framework64\v4.0.30319
set ILASM=%NET%\ilasm.exe
set CSC=%NET%\csc.exe
cd /d "%~dp0"

echo [1/2] Assembling hand-written IL -> WorldGen.dll
"%ILASM%" /nologo /dll /quiet /output:WorldGen.dll WorldGen.il
if errorlevel 1 goto fail

echo [2/2] Compiling C# game -> Wigglitz3D.exe
"%CSC%" /nologo /target:winexe /out:Wigglitz3D.exe ^
    /reference:WorldGen.dll ^
    /reference:System.dll /reference:System.Core.dll ^
    /reference:System.Drawing.dll /reference:System.Windows.Forms.dll ^
    Game.cs
if errorlevel 1 goto fail

echo.
echo Build OK.  Run Wigglitz3D.exe  (or:  start Wigglitz3D.exe)
goto end

:fail
echo.
echo BUILD FAILED. See messages above.
exit /b 1

:end
endlocal
