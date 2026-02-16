const fs = require('fs');

async function restoreClient() {
    const clientPath = 'client/app/components/UnifiedTable.tsx';
    const restorePath = 'restore_block.txt';

    let content = fs.readFileSync(clientPath, 'utf8');
    const restoreBlock = fs.readFileSync(restorePath, 'utf8');

    const targetMarker = "if (!target) return alert('プレイヤーが見つかりません');";

    const idx = content.indexOf(targetMarker);
    if (idx === -1) {
        console.error("Target marker not found!");
        return;
    }

    // Insert AFTER the marker
    const insertPoint = idx + targetMarker.length;

    const newContent = content.substring(0, insertPoint) + restoreBlock + content.substring(insertPoint);
    fs.writeFileSync(clientPath, newContent);
    console.log("Client restored successfully.");
}

restoreClient();
