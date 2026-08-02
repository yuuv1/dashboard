@echo off
chcp 65001 >nul 2>&1
setlocal EnableExtensions EnableDelayedExpansion
title EdgeControl - Servidor Local
cd /d "%~dp0"

set "SRVTITLE=EdgeControl-Server"
set "PSFILE=%TEMP%\ec_server.ps1"
set "RUNFILE=%TEMP%\ec_run.cmd"
set "MODE="
set "PYEXE="
set "PYARG="

cls
echo.
echo   ==========================================================
echo      E D G E C O N T R O L   -   Gestao de Capital
echo      Servidor local para instalar o aplicativo ^(PWA^)
echo   ==========================================================
echo.

rem ============================================================
rem  1. Localizar o arquivo do app
rem ============================================================
set "APP="
if exist "index.html" set "APP=index.html"
if not defined APP if exist "edgecontrol-glass.html" set "APP=edgecontrol-glass.html"
if not defined APP for %%F in (*.html) do if not defined APP set "APP=%%F"

if not defined APP goto :no_app
echo   [OK] Aplicativo encontrado: %APP%

if exist "sw.js" echo   [OK] sw.js presente - modo offline completo
if not exist "sw.js" echo   [!]  sw.js ausente - offline sera parcial
echo.

rem ============================================================
rem  2. Verificar Python
rem ============================================================
echo   Verificando dependencias...
echo.

py -3 -c "print(1)" >nul 2>&1
if not errorlevel 1 set "PYEXE=py" & set "PYARG=-3" & goto :py_found

python -c "print(1)" >nul 2>&1
if not errorlevel 1 set "PYEXE=python" & goto :py_found

python3 -c "print(1)" >nul 2>&1
if not errorlevel 1 set "PYEXE=python3" & goto :py_found

goto :no_python

:py_found
for /f "delims=" %%V in ('%PYEXE% %PYARG% --version 2^>^&1') do set "PYVER=%%V"
echo   [OK] Python detectado: !PYVER!
set "MODE=PY"
goto :ask_port

rem ------------------------------------------------------------
:no_python
echo   [!]  Python nao encontrado.
echo.
echo   Como voce quer seguir?
echo.
echo      [1] Usar o servidor embutido   ^(recomendado - nao instala nada^)
echo      [2] Instalar o Python agora    ^(via winget^)
echo      [3] Sair
echo.
set "OPT="
set /p "OPT=   Escolha [1]: "
if not defined OPT set "OPT=1"
if "%OPT%"=="3" exit /b 0
if "%OPT%"=="2" goto :try_winget

set "MODE=PS"
echo   [OK] Servidor embutido selecionado ^(PowerShell^)
goto :ask_port

rem ------------------------------------------------------------
:try_winget
where winget >nul 2>&1
if errorlevel 1 goto :no_winget
echo.
echo   Instalando Python... pode levar alguns minutos.
echo.
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
echo.
echo   Reabra este arquivo quando terminar ^(o Windows precisa
echo   recarregar o PATH para enxergar o Python^).
echo.
pause
exit /b 0

:no_winget
echo.
echo   [X] winget nao disponivel neste Windows.
echo       Baixe em https://python.org/downloads
echo       ^(marque "Add Python to PATH" na instalacao^)
echo.
echo       Seguindo com o servidor embutido...
set "MODE=PS"
timeout /t 3 >nul
goto :ask_port

rem ============================================================
rem  3. Escolher a porta
rem ============================================================
:ask_port
echo.
echo   ----------------------------------------------------------
set "PORT="
set /p "PORT=   Qual porta usar? [8080]: "
if not defined PORT set "PORT=8080"

echo %PORT%| findstr /r /c:"^[1-9][0-9]*$" >nul
if errorlevel 1 goto :bad_port
if %PORT% LSS 1024 goto :low_port
if %PORT% GTR 65535 goto :high_port

netstat -an | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 goto :port_busy
goto :start_server

:bad_port
echo   [X] Porta invalida. Use apenas numeros.
goto :ask_port

:low_port
echo   [X] Use 1024 ou maior ^(portas baixas exigem admin^).
goto :ask_port

:high_port
echo   [X] A porta maxima e 65535.
goto :ask_port

:port_busy
echo.
echo   [!]  A porta %PORT% ja esta em uso.
set /a NEXTP=%PORT%+1
set "USENEXT="
set /p "USENEXT=   Usar a porta !NEXTP! no lugar? [S/n]: "
if /i "!USENEXT!"=="n" goto :ask_port
set "PORT=!NEXTP!"
goto :start_server

rem ============================================================
rem  4. Iniciar o servidor
rem ============================================================
:start_server
echo.
echo   Iniciando o servidor na porta %PORT%...

taskkill /f /fi "WINDOWTITLE eq %SRVTITLE%*" >nul 2>&1

if "%MODE%"=="PY" goto :write_runner

rem extrai o servidor PowerShell embutido neste proprio arquivo
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%~f0'); $m='#PS_SERVER' + '_START'; $i=$t.LastIndexOf($m); if($i -lt 0){ exit 1 }; $s=$t.Substring($i + $m.Length); [IO.File]::WriteAllText($env:TEMP+'\ec_server.ps1', $s, (New-Object Text.UTF8Encoding $false))"
if errorlevel 1 goto :ps_extract_fail

:write_runner
> "%RUNFILE%" echo @echo off
>>"%RUNFILE%" echo title %SRVTITLE%
>>"%RUNFILE%" echo cd /d "%CD%"
if "%MODE%"=="PY" >>"%RUNFILE%" echo echo Servidor EdgeControl - http://localhost:%PORT%/
if "%MODE%"=="PY" >>"%RUNFILE%" echo echo Feche esta janela para parar.
if "%MODE%"=="PY" >>"%RUNFILE%" echo echo.
if "%MODE%"=="PY" >>"%RUNFILE%" echo "%PYEXE%" %PYARG% -m http.server %PORT% --bind 127.0.0.1
if "%MODE%"=="PS" >>"%RUNFILE%" echo set "EC_PORT=%PORT%"
if "%MODE%"=="PS" >>"%RUNFILE%" echo set "EC_ROOT=%CD%"
if "%MODE%"=="PS" >>"%RUNFILE%" echo set "EC_APP=%APP%"
if "%MODE%"=="PS" >>"%RUNFILE%" echo powershell -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%"
>>"%RUNFILE%" echo echo.
>>"%RUNFILE%" echo echo Servidor encerrado.
>>"%RUNFILE%" echo pause

start "%SRVTITLE%" /min "%RUNFILE%"

set "READY="
for /l %%i in (1,1,40) do call :probe
if not defined READY goto :server_fail

set "URL=http://localhost:%PORT%/%APP%"
echo   [OK] Servidor no ar!
echo.
goto :open_browser

:probe
if defined READY exit /b 0
ping -n 1 -w 250 127.0.0.1 >nul
netstat -an | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 set "READY=1"
exit /b 0

rem ============================================================
rem  5. Abrir no navegador
rem ============================================================
:open_browser
set "BROWSER="
set "BNAME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe" & set "BNAME=Chrome"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" & set "BNAME=Chrome"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe" & set "BNAME=Chrome"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" & set "BNAME=Edge"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" & set "BNAME=Edge"

if defined BROWSER echo   Abrindo no !BNAME!...
if defined BROWSER start "" "!BROWSER!" "%URL%"
if not defined BROWSER echo   Abrindo no navegador padrao...
if not defined BROWSER start "" "%URL%"

rem ============================================================
rem  6. Instrucoes
rem ============================================================
echo.
echo   ==========================================================
echo      COMO INSTALAR O APLICATIVO
echo   ==========================================================
echo.
echo      Endereco:  %URL%
echo.
echo      1. Veja o icone de instalar na barra de endereco
echo         ^(monitor com uma seta, do lado direito^)
echo      2. Clique nele e confirme "Instalar"
echo.
echo      Nao apareceu? Menu do navegador ^(tres pontinhos^)
echo      e procure "Instalar EdgeControl".
echo.
echo      NO CELULAR ^(mesma rede Wi-Fi^):
for /f "delims=" %%A in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Select-Object -ExpandProperty IPAddress) -join ' '" 2^>nul') do call :show_ips "%%A"
echo.
echo         Obs: o Windows pode pedir liberacao no firewall.
echo         No iPhone, use o Safari.
echo.
echo   ==========================================================
echo.
echo      [A] Abrir de novo no navegador
echo      [P] Parar o servidor e sair
echo      [Enter] Deixar rodando e fechar esta janela
echo.

:menu
set "ACT="
set /p "ACT=   Escolha: "
if /i "%ACT%"=="A" goto :reopen
if /i "%ACT%"=="P" goto :stop
exit /b 0

:reopen
if defined BROWSER start "" "!BROWSER!" "%URL%"
if not defined BROWSER start "" "%URL%"
goto :menu

:stop
taskkill /f /fi "WINDOWTITLE eq %SRVTITLE%*" >nul 2>&1
echo.
echo   Servidor encerrado.
timeout /t 2 >nul
exit /b 0

rem ------------------------------------------------------------
:show_ips
if "%~1"=="" exit /b 0
for %%I in (%~1) do echo         http://%%I:%PORT%/%APP%
exit /b 0

rem ============================================================
rem  Erros
rem ============================================================
:no_app
echo   [X] Nenhum arquivo .html encontrado nesta pasta.
echo.
echo       Coloque o EdgeControl.bat na MESMA PASTA do
echo       arquivo edgecontrol-glass.html.
echo.
pause
exit /b 1

:ps_extract_fail
echo   [X] Falha ao preparar o servidor embutido.
echo       Tente instalar o Python ^(opcao 2^).
echo.
pause
exit /b 1

:server_fail
echo.
echo   [X] O servidor nao respondeu a tempo.
echo       Veja a janela "%SRVTITLE%" para o erro.
echo.
pause
exit /b 1


rem ============================================================
rem  Servidor HTTP embutido (PowerShell).
rem  O batch nunca executa daqui para baixo: o bloco e apenas
rem  lido e extraido para um .ps1 temporario.
rem ============================================================
#PS_SERVER_START
# EdgeControl - servidor HTTP minimo, sem dependencias externas
$ErrorActionPreference = 'Stop'

$port = 8080
if ($env:EC_PORT) { $port = [int]$env:EC_PORT }
$root = (Get-Location).Path
if ($env:EC_ROOT) { $root = $env:EC_ROOT }
$app = 'index.html'
if ($env:EC_APP) { $app = $env:EC_APP }

$mime = @{}
$mime['.html']        = 'text/html; charset=utf-8'
$mime['.htm']         = 'text/html; charset=utf-8'
$mime['.js']          = 'text/javascript; charset=utf-8'
$mime['.mjs']         = 'text/javascript; charset=utf-8'
$mime['.css']         = 'text/css; charset=utf-8'
$mime['.json']        = 'application/json; charset=utf-8'
$mime['.webmanifest'] = 'application/manifest+json'
$mime['.png']         = 'image/png'
$mime['.jpg']         = 'image/jpeg'
$mime['.jpeg']        = 'image/jpeg'
$mime['.webp']        = 'image/webp'
$mime['.gif']         = 'image/gif'
$mime['.svg']         = 'image/svg+xml'
$mime['.ico']         = 'image/x-icon'
$mime['.txt']         = 'text/plain; charset=utf-8'
$mime['.woff2']       = 'font/woff2'

$listener = $null
try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
    $listener.Start()
}
catch {
    Write-Host ''
    Write-Host "  [X] Nao foi possivel abrir a porta $port" -ForegroundColor Red
    Write-Host ("      " + $_.Exception.Message)
    Write-Host ''
    Read-Host '  Pressione Enter para fechar'
    exit 1
}

Write-Host ''
Write-Host '  EdgeControl - servidor embutido' -ForegroundColor Cyan
Write-Host "  Rodando em http://localhost:$port/" -ForegroundColor Green
Write-Host "  Pasta: $root"
Write-Host ''
Write-Host '  Feche esta janela para parar o servidor.'
Write-Host ''

$rootFull = [System.IO.Path]::GetFullPath($root)

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $client.ReceiveTimeout = 5000
        $client.SendTimeout = 15000
        $stream = $client.GetStream()

        $buf = New-Object byte[] 8192
        $read = $stream.Read($buf, 0, $buf.Length)
        if ($read -le 0) { $client.Close(); continue }

        $req = [System.Text.Encoding]::ASCII.GetString($buf, 0, $read)
        $lines = $req -split "`r`n"
        $parts = $lines[0] -split ' '
        if ($parts.Count -lt 2) { $client.Close(); continue }

        $method = $parts[0].ToUpper()
        $path = $parts[1].Split('?')[0]
        try { $path = [System.Uri]::UnescapeDataString($path) } catch { }
        if ($path -eq '/' -or $path -eq '') { $path = '/' + $app }

        $headOnly = $false
        if ($method -eq 'HEAD') { $headOnly = $true }

        $code = 200
        $statusText = 'OK'
        $ctype = 'application/octet-stream'
        $bytes = $null

        if ($method -ne 'GET' -and $method -ne 'HEAD') {
            $code = 405
            $statusText = 'Method Not Allowed'
            $ctype = 'text/plain; charset=utf-8'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes('405')
        }
        else {
            $rel = $path.TrimStart('/').Replace('/', '\')
            $full = Join-Path $root $rel
            $fileFull = ''
            try { $fileFull = [System.IO.Path]::GetFullPath($full) } catch { $fileFull = '' }

            $inside = $false
            if ($fileFull -ne '') {
                $inside = $fileFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)
            }

            if (-not $inside) {
                $code = 403
                $statusText = 'Forbidden'
                $ctype = 'text/plain; charset=utf-8'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('403')
            }
            elseif (Test-Path -LiteralPath $fileFull -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($fileFull).ToLower()
                if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
                $bytes = [System.IO.File]::ReadAllBytes($fileFull)
            }
            else {
                $code = 404
                $statusText = 'Not Found'
                $ctype = 'text/plain; charset=utf-8'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 - nao encontrado')
            }
        }

        $len = 0
        if ($bytes) { $len = $bytes.Length }

        $sb = New-Object System.Text.StringBuilder
        [void]$sb.Append("HTTP/1.1 $code $statusText`r`n")
        [void]$sb.Append("Content-Type: $ctype`r`n")
        [void]$sb.Append("Content-Length: $len`r`n")
        [void]$sb.Append("Cache-Control: no-cache`r`n")
        [void]$sb.Append("Connection: close`r`n`r`n")

        $head = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
        $stream.Write($head, 0, $head.Length)
        if (-not $headOnly -and $len -gt 0) { $stream.Write($bytes, 0, $len) }
        $stream.Flush()

        if ($code -eq 200) {
            Write-Host ("  " + $method.PadRight(4) + "  " + $path) -ForegroundColor DarkGray
        }
        else {
            Write-Host ("  " + $code + "   " + $path) -ForegroundColor DarkYellow
        }
    }
    catch {
        # conexao interrompida pelo navegador: ignora e continua
    }
    finally {
        if ($client) {
            try { $client.Close() } catch { }
        }
    }
}
