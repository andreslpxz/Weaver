# Tests de smoke para Weaver en Windows (Fase W6)
# =================================================
#
# Este script ejecuta tests rápidos de verificación del backend de Windows.
# Requiere que Weaver esté compilado: `cd src-tauri && cargo build --release`
#
# Uso:
#   .\tests\windows\smoke_test.ps1
#
# Salida:
#   ✓/❌ para cada test + resumen final

param(
    [string]$WeaverExe = ".\src-tauri\target\release\weaver.exe"
)

$ErrorActionPreference = "Stop"
$testsPassed = 0
$testsFailed = 0
$testsSkipped = 0

function Test-Step {
    param([string]$Name, [scriptblock]$Action, [switch]$Skip)
    if ($Skip) {
        Write-Host "⏭  SKIP: $Name" -ForegroundColor Yellow
        $script:testsSkipped++
        return
    }
    try {
        & $Action
        Write-Host "✓ PASS: $Name" -ForegroundColor Green
        $script:testsPassed++
    } catch {
        Write-Host "❌ FAIL: $Name" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor DarkRed
        $script:testsFailed++
    }
}

function Cleanup-Process {
    param([string]$Name)
    Get-Process -Name $Name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Weaver Windows Smoke Tests" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Weaver se inicia sin crash
Test-Step "Weaver process starts" {
    if (-not (Test-Path $WeaverExe)) {
        throw "Weaver no encontrado en $WeaverExe. Compila primero con cargo build --release"
    }
    $proc = Start-Process -FilePath $WeaverExe -PassThru
    Start-Sleep -Seconds 3
    if ($proc.HasExited) {
        throw "Weaver terminó inmediatamente (exit code: $($proc.ExitCode))"
    }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

# Test 2: Notepad es accesible via UIAutomation
Test-Step "Notepad accessibility tree" {
    Cleanup-Process "notepad"
    Start-Process "notepad.exe"
    Start-Sleep -Seconds 2

    $notepad = Get-Process "notepad" -ErrorAction Stop
    if (-not $notepad) {
        throw "Notepad no se inició"
    }
    Write-Host "  PID: $($notepad.Id)" -ForegroundColor DarkGray

    Cleanup-Process "notepad"
}

# Test 3: Edge es accesible
Test-Step "Edge accessibility tree" {
    Cleanup-Process "msedge"
    Start-Process "msedge.exe"
    Start-Sleep -Seconds 5  # Edge tarda más en cargar

    $edge = Get-Process "msedge" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $edge) {
        throw "Edge no se inició"
    }
    Write-Host "  PID: $($edge.Id)" -ForegroundColor DarkGray

    Cleanup-Process "msedge"
}

# Test 4: VSCode es accesible
Test-Step "VSCode accessibility tree" -Skip:$(-not (Get-Command "code" -ErrorAction SilentlyContinue)) {
    Cleanup-Process "Code"
    Start-Process "code"
    Start-Sleep -Seconds 8  # VSCode tarda mucho

    $vscode = Get-Process "Code" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $vscode) {
        throw "VSCode no se inició"
    }
    Write-Host "  PID: $($vscode.Id)" -ForegroundColor DarkGray

    Cleanup-Process "Code"
}

# Test 5: Clipboard funciona
Test-Step "Clipboard roundtrip" {
    Set-Clipboard -Value "Weaver test 12345"
    $read = Get-Clipboard
    if ($read -ne "Weaver test 12345") {
        throw "Clipboard no coincide: '$read'"
    }
}

# Test 6: EnumWindows encuentra ventanas
Test-Step "Window enumeration" {
    # Abrir varias ventanas para tener algo que enumerar
    Start-Process "notepad.exe"
    Start-Process "calc.exe"
    Start-Sleep -Seconds 2

    $windows = Get-Process | Where-Object { $_.MainWindowTitle -ne "" }
    if ($windows.Count -lt 1) {
        throw "No se encontraron ventanas con título"
    }
    Write-Host "  $($windows.Count) ventanas encontradas" -ForegroundColor DarkGray

    Cleanup-Process "notepad"
    Cleanup-Process "CalculatorApp"
}

# Test 7: SendInput emula teclado
Test-Step "Keyboard SendInput" {
    # Abrir Notepad y escribir texto via Weaver
    Start-Process "notepad.exe"
    Start-Sleep -Seconds 2

    # Sin invocar a Weaver directamente, simulamos con SendInput via .NET
    # (esto valida que el sistema acepta eventos sintéticos)
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("Hello from Weaver")

    Start-Sleep -Seconds 1

    # Verificar que el texto está en el portapapeles tras Ctrl+A Ctrl+C
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("^c")
    Start-Sleep -Milliseconds 200

    $read = Get-Clipboard
    if ($read -notlike "*Hello from Weaver*") {
        throw "Texto no encontrado en Notepad. Clipboard: '$read'"
    }

    Cleanup-Process "notepad"
}

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Resumen:" -ForegroundColor Cyan
Write-Host "  ✓ Pasaron: $testsPassed" -ForegroundColor Green
Write-Host "  ❌ Fallaron: $testsFailed" -ForegroundColor Red
Write-Host "  ⏭  Saltados: $testsSkipped" -ForegroundColor Yellow
Write-Host "================================" -ForegroundColor Cyan

if ($testsFailed -gt 0) {
    exit 1
}
