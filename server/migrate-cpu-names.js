/**
 * CPU名を一括で CPU1, CPU2 形式にマイグレーションするスクリプト
 * 実行: cd server && node migrate-cpu-names.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function migrateState(state) {
    if (!state?.players) return false;
    let changed = false;
    const bots = state.players.filter(p => p.isBot);
    const usedMax = Math.max(0, ...bots.map(b => {
        const m = (b.name || '').match(/CPU(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }));
    let nextNum = usedMax + 1;
    bots.forEach(p => {
        const n = (p.name || '').trim();
        if (/CPU\d+/.test(n)) return;
        const level = p.cpuLevel === 'strong' ? '3' : p.cpuLevel === 'normal' ? '2' : '1';
        p.name = `CPU${nextNum} (Lv.${level})`;
        nextNum++;
        changed = true;
    });
    if (changed) state.debugVersion = 'v8.0';
    return changed;
}

async function main() {
    const games = await prisma.game.findMany({ orderBy: { createdAt: 'desc' } });
    let count = 0;
    for (const game of games) {
        try {
            const state = JSON.parse(game.stateJson || '{}');
            if (migrateState(state)) {
                await prisma.game.update({
                    where: { id: game.id },
                    data: { stateJson: JSON.stringify(state) }
                });
                count++;
                console.log('Migrated game:', game.id, 'room:', game.roomId);
            }
        } catch (e) {
            console.error('Error migrating game', game.id, e.message);
        }
    }
    console.log('Done. Migrated', count, 'game(s).');
}

main()
    .then(() => prisma.$disconnect())
    .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
