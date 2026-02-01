
const io = require('socket.io-client');
const SERVER_URL = 'http://localhost:3010';

async function runTest() {
    console.log('--- Starting Game Mode Logic Test ---');
    const socket = io(SERVER_URL);
    await new Promise(r => socket.on('connect', r));
    console.log('Connected');

    // 1. Create Room (Default Tabletop)
    const { data: { roomId, gameId } } = await new Promise(r => socket.emit('create_room', { nickname: 'Host', userId: 'h1' }, r));
    console.log('Room:', roomId);

    // 2. Use Existing Template (Old Maid)
    const templateId = 'cmkmo32fb000079rsk01aqon5';
    console.log('Using Template:', templateId);

    // 3. Apply Template
    const applyRes = await new Promise(r => socket.emit('apply_game_template', { roomId, templateId }, r));
    console.log('Applied Template:', applyRes);

    if (!applyRes.ok) {
        console.error('Apply Failed');
        process.exit(1);
    }

    // 4. Check State (should have selectedMode = 'oldmaid' and phase = 'setup')
    // We need to join to get state or listen to update.
    const joinRes = await new Promise(r => socket.emit('join_room', { roomId, nickname: 'Host', userId: 'h1' }, r));
    console.log('State Mode:', joinRes.data.selectedMode);
    console.log('State Phase:', joinRes.data.phase);

    if (joinRes.data.selectedMode !== 'oldmaid' || joinRes.data.phase !== 'setup') {
        console.error('FAIL: State not updated correctly');
    } else {
        console.log('PASS: Mode set correctly');
    }

    // 5. Start Game (Need 2 players for old maid)
    // Add dummy player
    const p2Socket = io(SERVER_URL);
    await new Promise(r => p2Socket.on('connect', r));
    await new Promise(r => p2Socket.emit('join_room', { roomId, nickname: 'P2', userId: 'p2' }, r));

    const startRes = await new Promise(r => socket.emit('host_action', { roomId, type: 'start_game', userId: 'h1' }, r));
    console.log('Start Res:', startRes);

    await new Promise(r => setTimeout(r, 1000)); // wait for broadcast

    socket.disconnect();
    p2Socket.disconnect();
    process.exit(0);
}

runTest().catch(console.error);
