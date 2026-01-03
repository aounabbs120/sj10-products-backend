const { createClient } = require("@libsql/client");
require('dotenv').config();

// ⚡ All shards with migrations disabled
const clients = {
  shard_women_fashion: createClient({ url: process.env.TURSO_WOMEN_URL, authToken: process.env.TURSO_WOMEN_TOKEN, migrations: false }),
  shard_men_fashion:    createClient({ url: process.env.TURSO_MEN_URL,   authToken: process.env.TURSO_MEN_TOKEN,   migrations: false }),
  shard_electronics:    createClient({ url: process.env.TURSO_ELEC_URL,  authToken: process.env.TURSO_ELEC_TOKEN,  migrations: false }),
  shard_beauty:         createClient({ url: process.env.TURSO_BEAUTY_URL, authToken: process.env.TURSO_BEAUTY_TOKEN, migrations: false }),
  shard_home:           createClient({ url: process.env.TURSO_HOME_URL,  authToken: process.env.TURSO_HOME_TOKEN,  migrations: false }),
  shard_kids:           createClient({ url: process.env.TURSO_KIDS_URL,  authToken: process.env.TURSO_KIDS_TOKEN,  migrations: false }),
  shard_footwear:       createClient({ url: process.env.TURSO_FOOTWEAR_URL, authToken: process.env.TURSO_FOOTWEAR_TOKEN, migrations: false }),
  shard_bags_acc:       createClient({ url: process.env.TURSO_BAGS_URL,  authToken: process.env.TURSO_BAGS_TOKEN,  migrations: false }),
  shard_jewelry_watch:  createClient({ url: process.env.TURSO_JW_URL,    authToken: process.env.TURSO_JW_TOKEN,    migrations: false }),
  shard_kitchen:        createClient({ url: process.env.TURSO_KITCHEN_URL, authToken: process.env.TURSO_KITCHEN_TOKEN, migrations: false }),
  shard_auto_sports:    createClient({ url: process.env.TURSO_AUTO_URL,  authToken: process.env.TURSO_AUTO_TOKEN,  migrations: false }),
  shard_general:        createClient({ url: process.env.TURSO_GEN_URL,   authToken: process.env.TURSO_GEN_TOKEN,   migrations: false }),
};

// Helper to get client by shard
const getDbForCategory = (shardKey) => {
  return clients[shardKey] || clients.shard_general;
};

module.exports = { clients, getDbForCategory };
