const { io } = require('socket.io-client');

const socketUrl = 'http://127.0.0.1:3000';
const options = { transports: ['websocket'], reconnection: false, timeout: 10000 };
const roomId = 'test_mj_' + Date.now();
const user1 = 'u1';
const user2 = 'u2';

const socket1 = io(socketUrl, options);
const socket2 = io(socketUrl, options);

async function run() {
    console.log('--- Starting Mix Juice P0 Test ---');
    try {
        await connect(socket1, user1);
        await connect(socket2, user2);

        // 1. Setup Room & Mode
        console.log('[1] Setting up Room & Mode...');
        await emit(socket1, 'host_action', { roomId, userId: user1, type: 'set_mode', payload: { mode: 'mixjuice' } }); // Assuming set_mode exists or we use start_game directly if set_mode is UI only.
        // Actually set_mode might not be a server event, client usually just sets local state or sends it with start_game?
        // Let's check server helpers. Usually start_game takes current state mode.
        // We set mode by updating state directly via draft or generic update?
        // Wait, host_action 'set_mode' is likely not implemented.
        // We can force it via draft or rely on 'start_game' fallback?
        // Let's try sending a draft with mode='mixjuice' first.
        const draft = { name: 'MJ Setup', mode: 'mixjuice', piles: [], updatedAt: Date.now() };
        await emit(socket1, 'draft_template_set', { roomId, userId: user1, draftTemplate: draft });
        await emit(socket1, 'template_apply_to_active', { roomId, userId: user1, version: 0 }); // version might be needed, ignore for now/0

        // 2. Start Game
        console.log('[2] Starting Game...');
        await emit(socket1, 'host_action', { roomId, userId: user1, type: 'start_game' });

        let state = await getState(socket1);
        if (state.phase !== 'mixjuice' || !state.mixjuice) throw new Error('Game failed to start in Mix Juice mode');
        console.log(`[OK] Game Started. Round: ${state.mixjuice.round}, Deck: ${state.mixjuice.deck.length}`);

        // 3. Round Loop (Automated Play)
        // We need to play until Round 5 ends.
        // Each round: players take actions until turnCount resets or round increases.
        // The simple strategy: PASS every turn.

        let initialRound = state.mixjuice.round;
        while (state.mixjuice.round <= 5 && state.phase !== 'finished') {
            const mj = state.mixjuice;
            const turnUser = mj.turnSeat[mj.turnIndex];
            const sock = turnUser === user1 ? socket1 : socket2;

            // Action: Pass
            await emit(sock, 'mixjuice_action', { roomId, userId: turnUser, type: 'pass' });

            // Wait for update
            await sleep(50);
            state = await getState(socket1);

            if (state.mixjuice.round > initialRound) {
                console.log(`[OK] Round ${initialRound} Finished. Scores:`, state.mixjuice.scores);
                initialRound = state.mixjuice.round;
            }
            if (state.phase === 'finished') break;
        }

        console.log('[3] Game Finished. Final Scores:', state.mixjuice.scores);
        if (state.phase !== 'finished') throw new Error('Game did not finish properly');

        // 4. Edit & Rematch Verification
        console.log('[4] Verifying Edit & Rematch...');
        // Edit: Rename a fruit card in the Active Template (which we can fetch or just push a new draft).
        // Let's Edit "Active -> Draft -> Edit -> Apply".
        // State has activeTemplate.
        const active = state.activeTemplate;
        if (!active || !active.piles) throw new Error('No active template found');

        // Find a card
        const drawPile = active.piles.find(p => p.pileId === 'draw' || p.title === '山札');
        if (!drawPile || drawPile.cards.length === 0) {
            // Wait, start_game consumed deck? No, activeTemplate should be static structure.
            // But checking PostGameDeckEditor logic: if activeTemplate has cards, it uses them.
            // If we generated 36 cards on SERVER start_game fallback, we NEVER SAVED them to activeTemplate?
            // Ah! Good catch. The server fallback generation happened in `start_game` but didn't update `state.activeTemplate`?
            // Let's check server code.
            // Server code: `let deck = []; if (activeTemplate...) ... if (deck.length==0) { fallback gen }`.
            // It modifies `state.mixjuice.deck`. It does NOT save back to `state.activeTemplate`.
            // So if we open Deck Editor, it might start empty again and regenerate?
            // That's fine, as long as Deck Editor regenerates SAME structure, we can edit it.
            // PostGameDeckEditor client side also has fallback logic.
            // So simulation:
            // 1. Client opens editor (Client side logic runs, generates 36 cards).
            // 2. Client saves this draft.
            // 3. Client applies.
            // 4. Next game uses this draft.

            // So we simulate "Client Save Draft" with generated cards.
            console.log('   Simulating Client Editor Save...');
            const newCards = generateFruits();
            newCards[0].name = 'TEST_APPLE';

            const newDraft = {
                name: 'Edited MJ',
                mode: 'mixjuice',
                piles: [{ pileId: 'draw', title: '山札', cards: newCards }],
                updatedAt: Date.now()
            };

            await emit(socket1, 'draft_template_set', { roomId, userId: user1, draftTemplate: newDraft });
            await emit(socket1, 'template_apply_to_active', { roomId, userId: user1, version: state.version });

            // 5. Restart & Verify
            console.log('   Rematching...');
            await emit(socket1, 'host_action', { roomId, userId: user1, type: 'start_game' });
            state = await getState(socket1);

            const deck = state.mixjuice.deck;
            const hasTestCard = deck.some(c => c.name === 'TEST_APPLE');
            if (hasTestCard) console.log('[OK] TEST_APPLE found in new game deck');
            else throw new Error('TEST_APPLE not found in deck');

            console.log('[SUCCESS] All Mix Juice P0 Tests Passed');
            process.exit(0);

        }
    } catch (e) {
        console.error('[FAIL]', e);
        process.exit(1);
    } finally {
        socket1.close();
        socket2.close();
    }
}

function connect(sock, uid) {
    return new Promise((resolve, reject) => {
        sock.on('connect', () => {
            sock.emit('join_room', { roomId, userId: uid, nickname: uid }, (res) => {
                if (res && (res.ok || res.data)) resolve();
                else reject(res);
            });
        });
        sock.on('connect_error', reject);
    });
}

function emit(sock, event, data) {
    return new Promise((resolve, reject) => {
        sock.emit(event, data, (res) => {
            if (res && res.ok) resolve(res);
            else if (res && res.error) reject(new Error(res.error));
            else resolve(res); // nullable
        });
    });
}

function getState(sock) {
    return new Promise(resolve => {
        // Just cheat and use join_room to get full state, or listen to update?
        // Listener is async. Join is req/res.
        sock.emit('join_room', { roomId, userId: 'viewer', nickname: 'v' }, (res) => {
            resolve(res.data || res.state || res);
        });
    });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function generateFruits() {
    const arr = [];
    ['Red', 'Yellow', 'Green', 'Ord', 'Ppl', 'Wht'].forEach(c => {
        for (let v = 0; v <= 5; v++) arr.push({ id: `c_${c}_${v}`, name: `${c}-${v}`, meta: { value: v } });
    });
    return arr;
}

run();
