require('dotenv').config();
const { createClient } = require('@libsql/client');

// 1. Shard configuration
const shardKeys =[
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

// 2. Initialize Clients
const mapClient = createClient({
    url: process.env.TURSO_MAP_URL,
    authToken: process.env.TURSO_MAP_TOKEN
});

const clients = {};
shardKeys.forEach((key) => {
    const shortName = envMapping[key];
    const url = process.env[`TURSO_${shortName}_URL`];
    const token = process.env[`TURSO_${shortName}_TOKEN`];
    if (url && token) {
        clients[key] = createClient({ url: url.trim(), authToken: token.trim() });
    }
});

async function migrate() {
    console.log("🚀 Starting Map Database Migration...");

    // STEP 1: Create Table and Indexes in the Map Database
    console.log("🛠️ Creating table `product_map`...");
    await mapClient.execute(`
        CREATE TABLE IF NOT EXISTS product_map (
            id TEXT PRIMARY KEY,
            slug TEXT,
            sku TEXT,
            shard_name TEXT
        )
    `);

    console.log("🛠️ Creating Indexes for fast searching...");
    await mapClient.execute(`CREATE INDEX IF NOT EXISTS idx_slug ON product_map(slug)`);
    await mapClient.execute(`CREATE INDEX IF NOT EXISTS idx_sku ON product_map(sku)`);
    
    // Clear existing data in case you run this script twice
    await mapClient.execute(`DELETE FROM product_map`);
    console.log("✅ Table is ready.\n");

    let totalImported = 0;

    // STEP 2: Loop through all shards and fetch products
    for (const shardName of shardKeys) {
        if (!clients[shardName]) continue;

        console.log(`📥 Fetching products from ${shardName}...`);
        try {
            const res = await clients[shardName].execute(`SELECT id, slug, sku FROM products`);
            const products = res.rows;
            
            if (products.length === 0) {
                console.log(`   No products found in ${shardName}. Skipping.`);
                continue;
            }

            console.log(`   Found ${products.length} products. Inserting into Map DB...`);

            // STEP 3: Insert in chunks of 500 to avoid memory/network limits
            const chunkSize = 500;
            for (let i = 0; i < products.length; i += chunkSize) {
                const chunk = products.slice(i, i + chunkSize);
                
                // Prepare bulk transaction for Turso
                const statements = chunk.map(p => ({
                    sql: "INSERT INTO product_map (id, slug, sku, shard_name) VALUES (?, ?, ?, ?)",
                    args:[String(p.id), p.slug, p.sku || null, shardName]
                }));

                await mapClient.batch(statements, "write");
            }

            totalImported += products.length;
            console.log(`✅ Successfully imported ${products.length} from ${shardName}`);

        } catch (error) {
            console.error(`❌ Error migrating ${shardName}:`, error.message);
        }
    }

    console.log(`\n🎉 MIGRATION COMPLETE! Total Products Mapped: ${totalImported}`);
}

migrate();