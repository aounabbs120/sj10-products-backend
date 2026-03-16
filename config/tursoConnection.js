// api/config/tursoConnection.js
require('dotenv').config();
const { createClient } = require('@libsql/client');

// 1. MAIN SHARDS
const shardKeys = [
  "shard_women_fashion", "shard_men_fashion", "shard_electronics",
  "shard_beauty", "shard_home", "shard_kids", "shard_footwear",
  "shard_bags_acc", "shard_jewelry_watch", "shard_kitchen",
  "shard_auto_sports", "shard_general"
];

const envMapping = {
  "shard_women_fashion": "WOMEN", "shard_men_fashion": "MEN",
  "shard_electronics": "ELEC", "shard_beauty": "BEAUTY",
  "shard_home": "HOME", "shard_kids": "KIDS",
  "shard_footwear": "FOOTWEAR", "shard_bags_acc": "BAGS",
  "shard_jewelry_watch": "JW", "shard_kitchen": "KITCHEN",
  "shard_auto_sports": "AUTO", "shard_general": "GEN"
};

const clients = {};
console.log("--- [Turso Connection] Initializing Database Clients ---");

shardKeys.forEach((key) => {
  const shortName = envMapping[key];
  const url = process.env[`TURSO_${shortName}_URL`];
  const token = process.env[`TURSO_${shortName}_TOKEN`];
  
  if (url && token) {
    clients[key] = createClient({ url: url.trim(), authToken: token.trim() });
    console.log(`✅ [Turso] Client created for: ${key}`);
  } else {
    // This warning will tell you if an environment variable is missing
    console.warn(`⚠️ [Turso] Missing URL or Token for: ${key}. This shard will be skipped.`);
  }
});

console.log(`--- [Turso Connection] Total clients created: ${Object.keys(clients).length} ---`);


// 2. VIEWS ENGINE CLIENT
const viewsClient = createClient({
    url: process.env.TURSO_VIEWS_URL || "libsql://placeholder",
    authToken: process.env.TURSO_VIEWS_TOKEN || "placeholder"
});
const mapClient = createClient({
    url: process.env.TURSO_MAP_URL || "libsql://placeholder-map",
    authToken: process.env.TURSO_MAP_TOKEN || "placeholder-map"
});
console.log("✅ [Turso] Client created for: Slug-to-Shard Map");
const getDbForCategory = (shardKey) => {
  return clients[shardKey] || clients.shard_general;
};
// At the end of the file, export the new mapClient
module.exports = { clients, viewsClient, mapClient, getDbForCategory }; // Add mapClient here


