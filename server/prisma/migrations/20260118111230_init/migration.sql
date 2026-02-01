-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxPlayers" INTEGER NOT NULL DEFAULT 4,
    "isSetupMode" BOOLEAN NOT NULL DEFAULT true,
    "rules" TEXT NOT NULL DEFAULT '',
    "gameState" TEXT NOT NULL DEFAULT '{}',
    "chatHistory" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nickname" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "hand" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Player_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
