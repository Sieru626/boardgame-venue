require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function test() {
    console.log("Checking API Key exists:", !!process.env.GEMINI_API_KEY);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    try {
        console.log("Testing gemini-pro...");
        const modelPro = genAI.getGenerativeModel({ model: "gemini-pro" });
        const resultPro = await modelPro.generateContent("Hello");
        console.log("gemini-pro success:", await resultPro.response.text());
    } catch (e) {
        console.error("gemini-pro failed:", e.message);
    }

    try {
        console.log("Testing gemini-1.5-flash...");
        const modelFlash = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const resultFlash = await modelFlash.generateContent("Hello");
        console.log("gemini-1.5-flash success:", await resultFlash.response.text());
    } catch (e) {
        console.error("gemini-1.5-flash failed:", e.message);
    }
}

test();
