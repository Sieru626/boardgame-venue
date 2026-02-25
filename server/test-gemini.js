require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
    console.log("Testing SDK with gemini-flash-latest...");
    if (!process.env.GEMINI_API_KEY) {
        console.error("No API Key found");
        return;
    }

    const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const modelId = "gemini-flash-latest";

    try {
        const result = await genAI.models.generateContent({
            model: modelId,
            contents: [{ role: 'user', parts: [{ text: "Hello, just say 'ok'" }] }]
        });

        if (typeof result.text === 'function') {
            console.log("Success! Output:", result.text());
        } else {
            console.log("Success! result.text() missing.");
            console.log("Candidates:", JSON.stringify(result.candidates, null, 2));
        }
    } catch (e) {
        console.log(`Failed '${modelId}':`, e.message);
    }
}

test();
