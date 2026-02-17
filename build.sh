#!/usr/bin/env bash
# Render 用ビルドスクリプト（next.config で distDir: .next-venue のため .next ではなく .next-venue をコピー）
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Client: npm install"
cd client && npm install

echo "==> Client: next build"
npx next build

echo "==> Copy .next-venue to server/.next"
cp -r .next-venue ../server/.next

echo "==> Copy public if exists"
[ -d public ] && cp -r public ../server/ || true

echo "==> Server: npm install & prisma generate"
cd ../server && npm install && npx prisma generate

echo "==> Build complete"
