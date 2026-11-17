@echo off
chcp 65001 >nul
rem 掌灯人 · 一键启动（需要 Node 20 以上）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 node。请先安装 Node.js 20 以上，或改用 docker compose up -d
  pause
  exit /b 1
)
start "" http://localhost:8787
node server.mjs
pause
