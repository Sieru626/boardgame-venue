/**
 * Prisma db push が EPERM で失敗する場合の代替スクリプト
 * sql.js で SQLite DB を直接作成する
 */
const fs = require('fs');
const path = require('path');

const prismaDir = path.join(__dirname, 'prisma');
const dbPath = path.join(prismaDir, 'dev.db');

if (fs.existsSync(dbPath)) {
  console.log('dev.db already exists. Skip.');
  process.exit(0);
}

// sql.js はオプション（インストールされていなければ prisma にフォールバック案内）
let initSqlJs;
try {
  const sqljs = require('sql.js');
  initSqlJs = sqljs.default || sqljs;
} catch (e) {
  console.error('sql.js がインストールされていません。以下を実行してください:');
  console.error('  npm install sql.js');
  console.error('または setup.bat をエクスプローラーから実行してください。');
  process.exit(1);
}

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // 現在の schema.prisma に合わせたテーブル作成
  db.run(`
    CREATE TABLE "Room" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "hostUserId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE "Game" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "roomId" TEXT NOT NULL,
      "stateJson" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE "Event" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "gameId" TEXT NOT NULL,
      "seq" REAL NOT NULL,
      "type" TEXT NOT NULL,
      "payloadJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE
    )
  `);
  db.run(`
    CREATE TABLE "GameTemplate" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "mode" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'turn_based',
      "ruleConfig" TEXT NOT NULL DEFAULT '{}',
      "ruleCardsJson" TEXT NOT NULL DEFAULT '[]',
      "rulesText" TEXT,
      "deckJson" TEXT NOT NULL,
      "revision" INTEGER NOT NULL DEFAULT 1,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const data = db.export();
  const buffer = Buffer.from(data);
  if (!fs.existsSync(prismaDir)) fs.mkdirSync(prismaDir, { recursive: true });
  fs.writeFileSync(dbPath, buffer);
  db.close();
  console.log('dev.db created successfully.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
