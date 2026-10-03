@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22以降をインストールしてください。
  pause
  exit /b 1
)
if not exist node_modules\tsx (
  echo 初回セットアップが必要です。npm install を実行してください。
  pause
  exit /b 1
)
node node_modules\tsx\dist\cli.mjs src\index.ts
set "RUN_RESULT=%ERRORLEVEL%"
pause
exit /b %RUN_RESULT%
