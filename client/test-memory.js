
const io = require('socket.io-client');
const SERVER_URL = 'http://localhost:3010';

async function runTest() {
    console.log('--- Starting Memory Game Logic Test (Final) ---');
    const socket = io(SERVER_URL, { reconnection: false, timeout: 5000 });

    socket.on('connect_error', (err) => {
        console.error('Connection Error:', err.message);
        process.exit(1);
    });

    await new Promise(r => socket.on('connect', r));
    console.log('Connected to', SERVER_URL);

    // 1. Create Room
    const { data: { roomId } } = await new Promise(r => socket.emit('create_room', { nickname: 'Host', userId: 'h1' }, r));
    console.log('Room:', roomId);

    // 2. Create Memory Template
    console.log('Creating Template...');
    const apiRes = await fetch(`${SERVER_URL}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: '神経衰弱', // Renamed by user request
            mode: 'memory',
            rulesText: '..',
            deckJson: '[]' // Explicit empty deck
        })
    });
    const apiText = await apiRes.text();
    // console.log('API Response:', apiText);

    let templateId;
    try {
        const d = JSON.parse(apiText);
        templateId = d.id;
    } catch (e) {
        console.error('JSON Parse Error');
    }

    if (!templateId) {
        console.error('FAIL: Template ID missing');
        process.exit(1);
    }
    console.log('Created Template:', templateId);

    // 3. Apply Template
    const applyRes = await new Promise(r => socket.emit('apply_game_template', { roomId, templateId }, r));
    if (!applyRes.ok) { console.error('Apply Failed:', applyRes); process.exit(1); }

    // 4. Join P2
    const p2Socket = io(SERVER_URL);
    await new Promise(r => p2Socket.on('connect', r));
    await new Promise(r => p2Socket.emit('join_room', { roomId, nickname: 'P2', userId: 'p2' }, r));

    // 5. Start Game
    const startRes = await new Promise(r => socket.emit('host_action', { roomId, type: 'start_game', userId: 'h1' }, r));
    if (!startRes.ok) { console.error('Start Failed:', startRes); process.exit(1); }

    await new Promise(r => setTimeout(r, 1000));

    // 6. Check State
    const { data: state } = await new Promise(r => socket.emit('join_room', { roomId, nickname: 'Host', userId: 'h1' }, r));

    console.log('Mode:', state.selectedMode);
    console.log('Memory Status:', state.memory?.status);
    console.log('Board Size:', state.memory?.board?.length);

    if (state.selectedMode !== 'memory' || state.memory?.board?.length !== 16) {
        console.error('FAIL: Memory initialization failed');
        process.exit(1);
    }

    // 7. Test Flip
    const turnPlayerId = state.memory.turnSeat[state.memory.turnIndex];
    console.log('Turn Player:', turnPlayerId);

    const actorSocket = turnPlayerId === 'h1' ? socket : p2Socket;
    const targetCard = state.memory.board[0];
    const flipRes = await new Promise(r => actorSocket.emit('memory_flip', { roomId, userId: turnPlayerId, cardId: targetCard.id }, r));
    console.log('Flip Result:', flipRes);

    if (!flipRes.ok) {
        console.error('FAIL: Flip failed', flipRes.error);
        process.exit(1);
    } else {
        console.log('PASS: Flip accepted');
    }

    socket.disconnect();
    p2Socket.disconnect();
    process.exit(0);
}

runTest().catch(console.error);
