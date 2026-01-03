// tursoConnection.js
const { createClient } = require("@libsql/client");
require("dotenv").config();

// --- Define all your shard clients ---
const clients = {
  shard_women_fashion: createClient({ url: process.env.TURSO_WOMEN_URL, authToken: process.env.TURSO_WOMEN_TOKEN }),
  shard_men_fashion:   createClient({ url: process.env.TURSO_MEN_URL,   authToken: process.env.TURSO_MEN_TOKEN }),
  shard_electronics:   createClient({ url: process.env.TURSO_ELEC_URL,  authToken: process.env.TURSO_ELEC_TOKEN }),
  shard_beauty:        createClient({ url: process.env.TURSO_BEAUTY_URL, authToken: process.env.TURSO_BEAUTY_TOKEN }),
  shard_home:          createClient({ url: process.env.TURSO_HOME_URL,  authToken: process.env.TURSO_HOME_TOKEN }),
  shard_kids:          createClient({ url: process.env.TURSO_KIDS_URL,  authToken: process.env.TURSO_KIDS_TOKEN }),
  shard_footwear:      createClient({ url: process.env.TURSO_FOOTWEAR_URL, authToken: process.env.TURSO_FOOTWEAR_TOKEN }),
  shard_bags_acc:      createClient({ url: process.env.TURSO_BAGS_URL,  authToken: process.env.TURSO_BAGS_TOKEN }),
  shard_jewelry_watch: createClient({ url: process.env.TURSO_JW_URL,    authToken: process.env.TURSO_JW_TOKEN }),
  shard_kitchen:       createClient({ url: process.env.TURSO_KITCHEN_URL, authToken: process.env.TURSO_KITCHEN_TOKEN }),
  shard_auto_sports:   createClient({ url: process.env.TURSO_AUTO_URL,  authToken: process.env.TURSO_AUTO_TOKEN }),
  shard_general:       createClient({ url: process.env.TURSO_GEN_URL,   authToken: process.env.TURSO_GEN_TOKEN }),
};

// --- Helper to get DB by shard key, defaults to general ---
const getDbForCategory = (shardKey) => {
  return clients[shardKey] || clients.shard_general;
};

// --- Optional: Validate each shard at startup ---
const validateShards = async () => {
  for (const [key, client] of Object.entries(clients)) {
    try {
      await client.execute({ sql: "SELECT 1" });
      console.log(`✅ Shard OK: ${key}`);
    } catch (err) {
      console.error(`❌ Shard FAILED: ${key} - ${err.message}`);
    }
  }
};

// Immediately run validation when this file is imported
validateShards().catch(console.error);

// --- Export the clients and helper ---
module.exports = { clients, getDbForCategory };
