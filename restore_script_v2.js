const fs = require('fs');

function restoreClient() {
    const clientPath = 'client/app/components/UnifiedTable.tsx';
    const restorePath = 'restore_full_logic.txt';

    let content = fs.readFileSync(clientPath, 'utf8');
    const restoreBlock = fs.readFileSync(restorePath, 'utf8');

    // 1. Find the interval set line
    const startMarker = "const interval = setInterval(() => setTick(t => t + 1), 200); // 5fps update";
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) {
        console.error("Start marker not found!");
        return;
    }

    // 2. Find the return statement (JSX start)
    const returnMarker = "    return ("; // 4 spaces
    const returnIdx = content.indexOf(returnMarker, startIdx);
    if (returnIdx === -1) {
        console.error("Return marker not found!");
        return;
    }

    // 3. Inject between startMarker (end of it) and returnMarker
    const insertPoint = startIdx + startMarker.length;
    // Note: We don't overwrite anything between them (presumably whitespace or orphaned characters), 
    // unless correct logic dictates otherwise. 
    // Actually, in the broken file, line 133 is `    return (`. So there is just a newline.
    // We will just insert the block.

    const newContent = content.substring(0, insertPoint) + restoreBlock + content.substring(returnIdx);

    // Note: My restore block starts with a newline? `\n        return () => ...`.
    // And assumes `returnIdx` points to `    return (`.
    // So `content.substring(returnIdx)` includes `    return (`.
    // This looks correct.

    fs.writeFileSync(clientPath, newContent);
    console.log("Client logic restored successfully.");
}

restoreClient();
