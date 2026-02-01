const { GoogleGenAI } = require('@google/genai');

async function test() {
    console.log("Testing SDK...");
    try {
        const genAI = new GoogleGenAI({ apiKey: "TEST" });
        console.log("Instance keys:", Object.keys(genAI));

        if (genAI.models) console.log("Has 'models'");
        if (genAI.getGenerativeModel) console.log("Has 'getGenerativeModel'");

    } catch (e) {
        console.error("Error:", e);
    }
}

test();
