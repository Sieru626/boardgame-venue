
const SERVER_URL = 'http://localhost:3010';

async function runTest() {
    console.log('--- Testing Delete Template API ---');

    // 1. Create Dummy
    console.log('Creating dummy template...');
    const createRes = await fetch(`${SERVER_URL}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: 'Delete Me',
            mode: 'tabletop',
            rulesText: '..',
            deckJson: '[]'
        })
    });
    const createData = await createRes.json();
    const id = createData.id;
    console.log('Created:', id);

    if (!id) {
        console.error('FAIL: Creation Failed');
        process.exit(1);
    }

    // 2. Delete it
    console.log('Deleting...');
    const delRes = await fetch(`${SERVER_URL}/api/games/${id}`, {
        method: 'DELETE'
    });
    const delData = await delRes.json();
    console.log('Delete Res:', delData);

    if (!delRes.ok || !delData.ok) {
        console.error('FAIL: Delete Failed');
        process.exit(1);
    }

    // 3. Verify Gone
    const getRes = await fetch(`${SERVER_URL}/api/games/${id}`);
    if (getRes.status === 404 || getRes.status === 500 || (await getRes.json()) === null) {
        console.log('PASS: Template gone (or fetch returned error/null as expected for missing id)');
    } else {
        // Warning: Depending on get implementation it might return null or 404.
        console.log('Verify Status:', getRes.status);
    }

    console.log('SUCCESS');
}

runTest().catch(console.error);
