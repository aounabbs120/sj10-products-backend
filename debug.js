require('dotenv').config();

const testKey = "TURSO_WOMEN_URL";
const url = process.env[testKey];

console.log("---------------------------------------------------");
console.log(`Testing Key: ${testKey}`);
console.log(`Value Read:  ${url}`);
console.log("---------------------------------------------------");

if (!url) {
    console.error("❌ ERROR: The variable is empty! Check your .env file.");
} else if (url.startsWith("libsql://")) {
    console.warn("⚠️ WARNING: You are using 'libsql://'. This causes 400 Errors on some networks.");
} else if (url.startsWith("https://")) {
    console.log("✅ SUCCESS: You are using 'https://'. This is correct for your network.");
} else {
    console.error("❌ ERROR: URL format is unrecognized.");
}