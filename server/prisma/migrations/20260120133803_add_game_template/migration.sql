/*
  Warnings:

  - You are about to drop the `Player` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Preset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `adminId` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `chatHistory` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `gameState` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `isSetupMode` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `maxPlayers` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `rules` on the `Room` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Room` table. All the data in the column will be lost.
  - Added the required column `code` to the `Room` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hostUserId` to the `Room` table without a default value. This is not possible if the table is not empty.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Player";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Preset";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Game_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "seq" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rulesText" TEXT,
    "deckJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Room" ("createdAt", "id") SELECT "createdAt", "id" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
