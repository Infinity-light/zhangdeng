#!/usr/bin/env bash
# 掌灯人 · 一键启动（需要 Node 20 以上）
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then echo "没有找到 node。请先安装 Node.js 20 以上，或改用 docker compose up -d"; exit 1; fi
exec node server.mjs
