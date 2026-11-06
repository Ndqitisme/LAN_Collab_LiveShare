@echo off
setlocal
rem ====== Configuration: adjust these three values ======
set "PROJECT=MyProject"
set "ROOT=D:\lan-collab\workspaces\MyProject"
set "PORT=8200"
rem ======================================================

title LAN Collab hub - %PROJECT% :%PORT%
set "HERE=%~dp0"
set "TOKEN_FILE=%HERE%token-%PROJECT%.txt"
set "ALLOW_FILE=%HERE%allowed-accounts-%PROJECT%.txt"

where node >nul 2>nul || (
    echo [ERROR] Node.js not found. Install Node.js 18 or later and run this script again.
    pause & exit /b 1
)

rem The token is generated once and kept, so invite codes stay valid across restarts.
if not exist "%TOKEN_FILE%" (
    powershell -NoProfile -Command "$b = New-Object byte[] 12; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [IO.File]::WriteAllText('%TOKEN_FILE%', (-join ($b | ForEach-Object { $_.ToString('x2') })))"
)
set /p LAN_COLLAB_TOKEN=<"%TOKEN_FILE%"

rem Accounts allowed to join. Edits take effect on the next join, no restart needed.
if not exist "%ALLOW_FILE%" (
    > "%ALLOW_FILE%" echo # One account per line: github:username or microsoft:email
    >> "%ALLOW_FILE%" echo # Example: github:octocat
    >> "%ALLOW_FILE%" echo # A file with only comment lines lets anyone with the token join.
)

echo Project       : %PROJECT%
echo Folder        : %ROOT%
echo Token         : %LAN_COLLAB_TOKEN%
echo Allowed list  : %ALLOW_FILE%
echo Close this window to stop the hub. Pending edits are written to disk before exit.
echo.
node "%HERE%hub.js" --root "%ROOT%" --port %PORT% --project "%PROJECT%" --allow-file "%ALLOW_FILE%"

echo.
echo Hub stopped (exit code %ERRORLEVEL%).
pause
