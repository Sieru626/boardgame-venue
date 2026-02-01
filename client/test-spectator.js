
const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3010'; // API Port

async function runTest() {
    console.log('--- Starting Spectator Logic Test ---');

    // 1. Host Connects
    const hostSocket = io(SERVER_URL);

    const hostReady = new Promise(resolve => hostSocket.on('connect', resolve));
    await hostReady;
    console.log('[Host] Connected');

    // 2. Create Room
    const createRes = await new Promise(resolve => {
        hostSocket.emit('create_room', { nickname: 'Host', userId: 'host_1' }, resolve);
    });

    if (!createRes.ok) {
        console.error('Create Room Failed:', createRes);
        process.exit(1);
    }
    const { roomId, gameId } = createRes.data;
    console.log(`[Host] Room Created: ${roomId}`);

    // 3. Guest Connects
    const guestSocket = io(SERVER_URL);
    await new Promise(resolve => guestSocket.on('connect', resolve));
    console.log('[Guest] Connected');

    // 4. Guest Joins
    const joinRes = await new Promise(resolve => {
        guestSocket.emit('join_room', { roomId, nickname: 'Guest', userId: 'guest_1' }, resolve);
    });

    if (!joinRes.ok) {
        console.error('Join Room Failed:', joinRes);
        process.exit(1);
    }
    console.log('[Guest] Joined. Initial State Players:', joinRes.data.players.length);

    // Helper to allow state updates to propagate
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // 5. Host toggles Guest to Spectator
    console.log('[Test] Host toggling Guest to Spectator...');
    const toggleRes = await new Promise(resolve => {
        hostSocket.emit('host_action', {
            roomId,
            type: 'toggle_spectator',
            payload: { targetUserId: 'guest_1' },
            userId: 'host_1'
        }, resolve);
    });
    console.log('[Host] Toggle Result:', toggleRes);

    await wait(500); // Wait for state_update

    // Verify Guest State (Guest should receive update)
    // We can't easy check state from here unless we listen to state_update, let's do that.

    // 6. Guest Self-Toggle back to Player
    console.log('[Test] Guest toggling self back to Player...');
    const selfToggleRes = await new Promise(resolve => {
        guestSocket.emit('self_set_spectator', {
            roomId,
            userId: 'guest_1',
            isSpectator: false
        }, resolve);
    });
    console.log('[Guest] Self Toggle Result:', selfToggleRes);

    await wait(500);

    // 7. Verify Final State via Host
    // We can join another socket or just trust the ack/logs, or better, listen to update.

    console.log('--- Test Finished ---');
    // Clean exit
    hostSocket.disconnect();
    guestSocket.disconnect();
    process.exit(0);
}

// Add state listener wrapper if needed, but for now just running the flow to ensure no errors
runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
