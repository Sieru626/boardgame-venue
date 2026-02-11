const io = require('socket.io-client');

const SERVER_URL = 'http://localhost:3011';

// Options for stability
const opts = {
    reconnection: false,
    transports: ['websocket'],
    forceNew: true,
    autoConnect: false // CRITICAL: Do not connect until told
};

const client1 = io(SERVER_URL, opts);
const client2 = io(SERVER_URL, opts);

let roomId = null;
let userId1 = 'user-simulation-1';
let userId2 = 'user-simulation-2';

const cleanup = () => {
    client1.disconnect();
    client2.disconnect();
    process.exit(0);
};

const fail = (msg) => {
    console.error('FAIL:', msg);
    process.exit(1);
};

// Flow
console.log('Connecting Client 1...');
client1.connect();

client1.on('connect', () => {
    console.log('Client 1 Connected');
    client1.emit('create_room', { nickname: 'Sim1', userId: userId1 }, (res) => {
        if (!res.ok) fail('Create Room Failed: ' + (res.error || 'Unknown'));
        roomId = res.data.roomId;
        console.log('Room Created:', roomId);

        // Delay to ensure DB propagation
        setTimeout(() => {
            console.log('Connecting Client 2...');
            client2.connect();
        }, 1000);
    });
});

client2.on('connect', () => {
    console.log('Client 2 Connected');
    if (!roomId) fail('Race Condition: RoomId is null');

    client2.emit('join_room', { roomId, nickname: 'Sim2', userId: userId2 }, (res) => {
        if (!res.ok) fail('Join Room Failed: ' + (res.error || 'Unknown'));
        console.log('Client 2 Joined');

        // Set Mode & Start
        const draft = {
            title: 'Sim Mix Juice',
            mode: 'mixjuice',
            piles: [{ pileId: 'draw', title: 'Draw', cards: Array(10).fill({ name: 'C', type: 'number' }) }]
        };

        client1.emit('draft_template_set', { roomId, userId: userId1, draftTemplate: draft }, (res) => {
            if (!res.ok) fail('Draft Set Failed');
            client1.emit('template_apply_to_active', { roomId, userId: userId1 }, (res) => {
                if (!res.ok) fail('Apply Template Failed');
                console.log('Mode set to Mix Juice');

                // Emit host_action for start_game
                client1.emit('host_action', { roomId, type: 'start_game', userId: userId1 }, (res) => {
                    if (!res.ok) fail('Start Game Failed: ' + res.error);
                    console.log('Game Started');
                });
            });
        });
    });
});

// Monitor State
let turnCount = -1;

client1.on('state_update', (state) => {
    if (state.phase !== 'mixjuice') return;

    const currentTurnCount = state.mixjuice.turnCount;
    const turnPlayerId = state.mixjuice.turnSeat[state.mixjuice.turnIndex];

    if (currentTurnCount <= turnCount) return;
    turnCount = currentTurnCount;

    console.log(`[Turn ${currentTurnCount}] Player: ${turnPlayerId === userId1 ? 'Sim1' : 'Sim2'}`);

    // Sequence
    if (currentTurnCount === 0) {
        setTimeout(() => {
            const socket = turnPlayerId === userId1 ? client1 : client2;
            const uid = turnPlayerId === userId1 ? userId1 : userId2;
            console.log(`Action: PASS by ${uid}`);
            socket.emit('mixjuice_action', { roomId, userId: uid, type: 'pass' }, (res) => {
                if (!res.ok) fail('Pass Failed: ' + res.error);
            });
        }, 500);
    }
    else if (currentTurnCount === 1) {
        setTimeout(() => {
            const socket = turnPlayerId === userId1 ? client1 : client2;
            const uid = turnPlayerId === userId1 ? userId1 : userId2;
            // Target index 0. Start game deals 2 cards.
            console.log(`Action: CHANGE (Valid) by ${uid}`);
            socket.emit('mixjuice_action', { roomId, userId: uid, type: 'change', targetIndex: 0 }, (res) => {
                if (!res.ok) fail('Change Failed: ' + res.error);
            });
        }, 500);
    }
    else if (currentTurnCount === 2) {
        setTimeout(() => {
            const socket = turnPlayerId === userId1 ? client1 : client2;
            const uid = turnPlayerId === userId1 ? userId1 : userId2;
            console.log(`Action: CHANGE (Invalid) by ${uid}`);
            socket.emit('mixjuice_action', { roomId, userId: uid, type: 'change', targetIndex: null }, (res) => {
                if (!res.ok) {
                    fail('Fallback Change Failed: ' + res.error);
                } else {
                    console.log('Fallback Change Success!');
                    console.log('ALL TESTS PASSED');
                    cleanup();
                }
            });
        }, 500);
    }
});

setTimeout(() => {
    console.log('Timeout - Force Fail');
    fail('Timeout');
}, 15000);
