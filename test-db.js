// CORRECT PATH based on your folder structure:
const { clients } = require('./config/tursoConnection');

console.log("Checking Turso Connection...");

if (!clients) {
    console.error("❌ Error: 'clients' is undefined. Check tursoConnection.js export.");
} else {
    const shardKeys = Object.keys(clients);
    console.log(`✅ Success: Found ${shardKeys.length} database shards.`);
    console.log("Shards detected:", shardKeys);
}