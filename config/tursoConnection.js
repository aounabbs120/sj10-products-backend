const { createClient } = require("@libsql/client");
require("dotenv").config();

const safeCreateClient = (url, token) => {
  if (!url || !token) return null;

  return createClient({
    url,
    authToken: token,

    // 🔴 THIS IS THE FIX 🔴
    syncUrl: null,
    syncInterval: 0
  });
};

const clients = {
  shard_women_fashion: safeCreateClient(process.env.TURSO_WOMEN_URL, process.env.TURSO_WOMEN_TOKEN),
  shard_men_fashion:   safeCreateClient(process.env.TURSO_MEN_URL,   process.env.TURSO_MEN_TOKEN),
  shard_electronics:   safeCreateClient(process.env.TURSO_ELEC_URL,  process.env.TURSO_ELEC_TOKEN),
  shard_beauty:        safeCreateClient(process.env.TURSO_BEAUTY_URL, process.env.TURSO_BEAUTY_TOKEN),
  shard_home:          safeCreateClient(process.env.TURSO_HOME_URL,  process.env.TURSO_HOME_TOKEN),
  shard_kids:          safeCreateClient(process.env.TURSO_KIDS_URL,  process.env.TURSO_KIDS_TOKEN),
  shard_footwear:      safeCreateClient(process.env.TURSO_FOOTWEAR_URL, process.env.TURSO_FOOTWEAR_TOKEN),
  shard_bags_acc:      safeCreateClient(process.env.TURSO_BAGS_URL,  process.env.TURSO_BAGS_TOKEN),
  shard_jewelry_watch: safeCreateClient(process.env.TURSO_JW_URL,    process.env.TURSO_JW_TOKEN),
  shard_kitchen:       safeCreateClient(process.env.TURSO_KITCHEN_URL, process.env.TURSO_KITCHEN_TOKEN),
  shard_auto_sports:   safeCreateClient(process.env.TURSO_AUTO_URL,  process.env.TURSO_AUTO_TOKEN),
  shard_general:       safeCreateClient(process.env.TURSO_GEN_URL,   process.env.TURSO_GEN_TOKEN),
};

// Remove broken shards
Object.keys(clients).forEach(k => {
  if (!clients[k]) delete clients[k];
});

const getDbForCategory = (shardKey) =>
  clients[shardKey] || clients.shard_general;

module.exports = { clients, getDbForCategory };
