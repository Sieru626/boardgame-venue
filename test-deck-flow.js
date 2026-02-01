const { io } = require("socket.io-client");

const SOCKET_URL = "http://localhost:3010";

// Simulation
async function test() {
    console.log("--- Starting Deck Editor Data Flow Test ---");

    const socket = io(SOCKET_URL);

    await new Promise(resolve => socket.on('connect', resolve));
    console.log("Connected to server");

    // 1. Create Room (MixJuice)
    let state = await new Promise(resolve => {
        socket.emit('create_room', { nickname: 'Tester', userId: 'user1' }, (res) => {
            if (res.ok) resolve(res.data);
            else console.error("Create failed", res);
        });
    });
    console.log("Room Created:", state.roomId);
    const roomId = state.roomId;

    // Join
    await new Promise(resolve => {
        socket.emit('join_room', { roomId: roomId, nickname: 'Tester', userId: 'user1' }, resolve);
    });

    // Set Mode to MixJuice (via game_action or apply? Initially it is setup/tabletop)
    // Actually, create_room makes it tabletop.
    // Let's Request Deck Data immediately. Should return Default Tabletop.
    let deckRes = await new Promise(resolve => {
        socket.emit('request_deck_data', { roomId: roomId, userId: 'user1' }, (res) => resolve(res));
    });
    console.log("Initial Request (Tabletop):", deckRes.ok, deckRes.data?.source, deckRes.data?.template?.mode);

    // 2. Set Draft (Simulate Editor Save) - EMPTY
    let saveRes = await new Promise(resolve => {
        socket.emit('draft_template_set', { roomId, userId: 'user1', draftTemplate: { piles: [] } }, (res) => resolve(res));
    });
    console.log("Save Empty Piles:", saveRes.ok ? "FAILED (Should be false)" : "PASSED (Rejected)");

    // 3. Set Draft - VALID MixJuice
    const mjDeck = [{ pileId: 'draw', title: 'Draw', cards: [{ id: 'c1', name: 'Apple', count: 1, meta: {} }] }];
    saveRes = await new Promise(resolve => {
        socket.emit('draft_template_set', {
            roomId, userId: 'user1', draftTemplate: {
                mode: 'mixjuice',
                piles: mjDeck
            }
        }, (res) => resolve(res));
    });
    console.log("Save Valid Draft:", saveRes.ok ? "PASSED" : "FAILED", saveRes.error);

    // 4. Request Deck Data (Should be DRAFT)
    deckRes = await new Promise(resolve => {
        socket.emit('request_deck_data', { roomId: roomId, userId: 'user1' }, (res) => resolve(res));
    });
    console.log("Request After Save (Should be DRAFT):", deckRes.ok, deckRes.data?.source);

    // 5. Apply to Active
    let applyRes = await new Promise(resolve => {
        socket.emit('template_apply_to_active', { roomId, userId: 'user1', draftTemplate: { mode: 'mixjuice', piles: mjDeck } }, (res) => resolve(res));
    });
    console.log("Apply to Active:", applyRes.ok ? "PASSED" : "FAILED");

    // 6. Request Deck Data (Should be ACTIVE or DRAFT? Spec says DRAFT if valid, but usually we just saved it so it matches)
    // Let's clear Draft to test Active fallback? We can't clear draft easily via API.
    // But if we open Editor, it should prioritize Draft.

    socket.disconnect();
    console.log("--- Test Complete ---");
}

test();
