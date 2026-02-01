// Native fetch assumed (Node 18+)

async function test() {
    try {
        const body = {
            title: "Test Game API",
            type: "turn_based",
            ruleConfig: JSON.stringify({ drawCount: 2, playCount: 1 }),
            mode: "table",
            deckJson: "[]"
        };

        console.log("Sending:", body);

        const res = await fetch('http://localhost:3010/api/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();
        console.log("Response:", data);

        if (data.ok) {
            // Verify GET
            const getRes = await fetch(`http://localhost:3010/api/games/${data.id}`);
            const game = await getRes.json();
            console.log("Created Game RuleCards:", game.ruleCardsJson);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

test();
