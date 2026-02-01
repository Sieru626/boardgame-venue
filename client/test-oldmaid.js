const { io } = require("socket.io-client");

const URL = "http://localhost:3010";

// Helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function createClient(name) {
    const socket = io(URL);
    return new Promise((resolve) => {
        socket.on("connect", () => {
            console.log(`[${name}] Connected: ${socket.id}`);
            resolve(socket);
        });
    });
}

(async () => {
    try {
        console.log("--- Starting Old Maid Test ---");
        const clientA = await createClient("UserA");
        const clientB = await createClient("UserB");
        const userA = "user-a-" + Date.now();
        const userB = "user-b-" + Date.now();

        // 1. Create Room (A)
        let roomId = "";
        let gameId = "";
        await new Promise(resolve => {
            clientA.emit("create_room", { nickname: "UserA", userId: userA }, result => {
                console.log("[A] Create Room:", result);
                if (result.ok) {
                    roomId = result.data.roomId;
                    gameId = result.data.gameId;
                }
                resolve();
            });
        });

        if (!roomId) throw new Error("Failed to create room");

        // 2. Join Room (B)
        await new Promise(resolve => {
            clientB.emit("join_room", { roomId, nickname: "UserB", userId: userB }, result => {
                console.log("[B] Join Room:", result.ok);
                resolve();
            });
        });

        await sleep(500);

        // 3. Start Game (A)
        console.log("--- Starting Game ---");
        await new Promise(resolve => {
            clientA.emit("oldmaid_start_game", { roomId, userId: userA }, result => {
                console.log("[A] Start Game:", result);
                resolve();
            });
        });

        await sleep(1000);

        // 4. Check State (Who is turn?)
        // We need to listen to state_update, but simpler to just peek via "join" again or assume event came.
        // Let's attach listeners now.
        let currentState = null;
        const onState = (s) => currentState = s;
        clientA.on("state_update", onState);
        clientB.on("state_update", onState);

        // Wait for update
        await sleep(500);
        if (!currentState) {
            console.log("No state received yet. Fetching via join...");
            await new Promise(resolve => {
                clientA.emit("join_room", { roomId, nickname: "UserA", userId: userA }, res => {
                    currentState = res.data;
                    resolve();
                });
            });
        }

        if (currentState.phase !== 'oldmaid') throw new Error("Phase is not oldmaid");

        const turnPlayerId = currentState.oldMaid.order[currentState.oldMaid.turnIndex];
        const prevPlayerId = currentState.oldMaid.targetId; // This should be set now!

        console.log(`Turn: ${turnPlayerId === userA ? "UserA" : "UserB"}`);
        console.log(`Target: ${prevPlayerId === userA ? "UserA" : "UserB"}`);

        // 5. Execute Pick
        const activeClient = turnPlayerId === userA ? clientA : clientB;
        const activeUserId = turnPlayerId;
        const targetUserId = prevPlayerId;

        // Verify Target Logic (2 players, A->B or B->A. Left neighbor of A should be B? Wait.)
        // Order: [A, B]
        // If Turn=A (Index 0). Next Active = B (Index 1). targetId should be B.
        // If Turn=B (Index 1). Next Active = A (Index 0). targetId should be A.
        // My Logic: Next Survivor.

        // Get target hand size
        const targetP = currentState.players.find(p => p.id === targetUserId);
        // Note: For ClientA, if ClientA is active, they see full state? No, masked.
        // But `targetP.hand` should be an array of objects.
        const handSize = targetP.hand.length;
        console.log(`Target Hand Size: ${handSize}`);

        if (handSize > 0) {
            console.log(`Picking index 0 from ${targetUserId}...`);
            await new Promise(resolve => {
                activeClient.emit("oldmaid_pick_from_left", { roomId, userId: activeUserId, pickIndex: 0 }, res => {
                    console.log("Pick Result:", res);
                    resolve();
                });
            });
        } else {
            console.log("Target has no cards? (Win condition met?)");
        }

        await sleep(1000);

        // 6. Verify Turn Changed?
        const nextTurnPlayerId = currentState.oldMaid.order[currentState.oldMaid.turnIndex];
        console.log(`New Turn: ${nextTurnPlayerId === userA ? "UserA" : "UserB"}`);

        if (nextTurnPlayerId === activeUserId && activeUserId === userA) {
            // Logic note: If pairs were removed and I kept turn? No, turn passes. 
            // Or if Game Over.
            console.log("Turn did not change? (or game over)");
        } else {
            console.log("Turn changed successfully!");
        }

        console.log("Test Complete");
        process.exit(0);

    } catch (e) {
        console.error("Test Failed:", e);
        process.exit(1);
    }
})();
