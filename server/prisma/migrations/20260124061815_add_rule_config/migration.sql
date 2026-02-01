-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameTemplate" (
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
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_GameTemplate" ("createdAt", "deckJson", "id", "mode", "revision", "rulesText", "title", "updatedAt") SELECT "createdAt", "deckJson", "id", "mode", "revision", "rulesText", "title", "updatedAt" FROM "GameTemplate";
DROP TABLE "GameTemplate";
ALTER TABLE "new_GameTemplate" RENAME TO "GameTemplate";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
