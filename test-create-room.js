const { io } = require('socket.io-client');

// Force websocket transport and ensure origin logic
const socket = io('http://localhost:3000', {
    transports: ['websocket'],
    withCredentials: true
});

socket.on('connect', () => {
    console.log('Connected to server');

    const payload = { nickname: 'Tester', userId: 'user-' + Date.now() };

    socket.emit('create_room', payload, (response) => {
        console.log('Ack received:', response);
        if (response.ok && response.data && response.data.roomId) {
            console.log('SUCCESS: Room created with ID ' + response.data.roomId);
            process.exit(0);
        } else {
            console.error('FAILURE: Invalid response', response);
            process.exit(1);
        }
    });

    // Timeout
    setTimeout(() => {
        console.error('Timeout waiting for Ack');
        process.exit(1);
    }, 5000);
});

socket.on('connect_error', (err) => {
    console.error('Connection Error:', err.message);
    process.exit(1);
});
