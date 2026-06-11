# Wigglitz 3D launcher.
# Compiles Game.cs in memory and runs the game inside PowerShell, so no
# standalone .exe is written to disk. Needs WorldGen.dll next to this file
# (run build.bat once, or let Play.bat assemble it automatically).
$ErrorActionPreference = 'Stop'
try {
    $dir = Split-Path -Parent $MyInvocation.MyCommand.Path
    if (-not $dir) { $dir = (Get-Location).Path }
    $dll = Join-Path $dir 'WorldGen.dll'
    $src = Join-Path $dir 'Game.cs'
    if (-not (Test-Path $dll)) { throw "WorldGen.dll not found. Run build.bat first (it assembles the hand-written IL)." }
    if (-not (Test-Path $src)) { throw "Game.cs not found next to Play.ps1." }
    $code = Get-Content $src -Raw
    Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies @(
        $dll, 'System', 'System.Drawing', 'System.Windows.Forms', 'System.Core'
    )
    [Wigglitz3D.Program]::Main()
}
catch {
    Write-Host ""
    Write-Host "Wigglitz 3D could not start:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Read-Host "Press Enter to close"
}
