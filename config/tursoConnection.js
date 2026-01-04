// api/config/tursoConnection.js
require('dotenv').config();
const { createClient } = require('@libsql/client');

// These are the internal names for your shards
const shardKeys = [
  "shard_women_fashion",
  "shard_men_fashion",
  "shard_electronics",
  "shard_beauty",
  "shard_home",
  "shard_kids",
  "shard_footwear",
  "shard_bags_acc",
  "shard_jewelry_watch",
  "shard_kitchen",
  "shard_auto_sports",
  "shard_general"
];

// THIS IS THE FIX: The "Address Book" that connects the code to your .env file
const envMapping = {
  "shard_women_fashion": "WOMEN",
  "shard_men_fashion": "MEN",
  "shard_electronics": "ELEC", // Maps to TURSO_ELEC_URL
  "shard_beauty": "BEAUTY",
  "shard_home": "HOME",
  "shard_kids": "KIDS",
  "shard_footwear": "FOOTWEAR",
  "shard_bags_acc": "BAGS",
  "shard_jewelry_watch": "JW", // Maps to TURSO_JW_URL
  "shard_kitchen": "KITCHEN",
  "shard_auto_sports": "AUTO", // Maps to TURSO_AUTO_URL
  "shard_general": "GEN"     // Maps to TURSO_GEN_URL
};

const clients = {};

shardKeys.forEach((key) => {
  // 1. Look up the short name in our "address book"
  const shortName = envMapping[key];
  
  // 2. Build the exact .env variable names
  const urlEnv = `TURSO_${shortName}_URL`;
  const tokenEnv = `TURSO_${shortName}_TOKEN`;

  const url = process.env[urlEnv];
  const token = process.env[tokenEnv];

  // 3. Connect!
  if (!url || !token) {
    console.warn(`❌ Shard FAILED: ${key} - Could not find ${urlEnv} or ${tokenEnv} in .env`);
    clients[key] = null; 
  } else {
    clients[key] = createClient({ 
        url: url.trim(), 
        authToken: token.trim() 
    });
    console.log(`✅ Shard OK: ${key}`);
  }
});

const getDbForCategory = (shardKey) => {
  if (clients[shardKey]) return clients[shardKey];
  console.warn(`⚠️ Using general shard for ${shardKey}`);
  return clients.shard_general;
};

module.exports = { clients, getDbForCategory };