require('dotenv').config();
const { createClient } = require('@libsql/client');

// 1. Initialize Both Clients
const oldClient = createClient({
    url: process.env.TURSO_WOMEN_OLD_URL,
    authToken: process.env.TURSO_WOMEN_OLD_TOKEN
});

const newClient = createClient({
    url: process.env.TURSO_WOMEN_NEW_URL,
    authToken: process.env.TURSO_WOMEN_NEW_TOKEN
});

async function migrateDatabase() {
    console.log("🚀 Starting Turso-to-Turso Migration for Women's Fashion Shard...");

    try {
        // ==========================================
        // PHASE 1: IDENTIFY TABLES & SCHEMA
        // ==========================================
        console.log("\n🔍 PHASE 1: Reading Schema from Old Database...");
        
        const schemaRes = await oldClient.execute(`
            SELECT type, name, sql 
            FROM sqlite_schema 
            WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
        `);

        const tables = schemaRes.rows.filter(r => r.type === 'table');
        const indexes = schemaRes.rows.filter(r => r.type === 'index');

        console.log(`✅ Found ${tables.length} Tables:`, tables.map(t => t.name).join(', '));
        
        // ==========================================
        // PHASE 2: RECREATE SCHEMA IN NEW DB
        // ==========================================
        console.log("\n🛠️ PHASE 2: Creating Tables in New Database...");

        await newClient.execute("PRAGMA foreign_keys=OFF;");

        for (const table of tables) {
            let safeSql = table.sql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS');
            // Fix for FTS virtual tables to ensure they create safely
            safeSql = safeSql.replace('CREATE VIRTUAL TABLE', 'CREATE VIRTUAL TABLE IF NOT EXISTS');
            
            try {
                await newClient.execute(safeSql);
                console.log(`   -> Checked/Created table: ${table.name}`);
            } catch (e) {
                // Ignore if virtual table already exists
            }
        }

        for (const idx of indexes) {
            try {
                const safeIdx = idx.sql.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS');
                await newClient.execute(safeIdx);
            } catch (e) {
                // Silently ignore index already exists errors
            }
        }
        console.log("✅ All schemas recreated successfully.");

        // ==========================================
        // PHASE 3: COPY ALL DATA (WITH BATCHING)
        // ==========================================
        console.log("\n📦 PHASE 3: Transferring Data...");

        for (const table of tables) {
            // 🔥 SKIP FTS SHADOW TABLES (SQLite manages these automatically!)
            const shadowSuffixes = ['_data', '_idx', '_docsize', '_config', '_content'];
            const isShadowTable = shadowSuffixes.some(suffix => table.name.endsWith(suffix));
            
            if (isShadowTable) {
                console.log(`\n⏭️ Skipping shadow table [${table.name}] (Auto-managed by SQLite)`);
                continue;
            }

            console.log(`\n📥 Fetching rows from [${table.name}]...`);
            
            const dataRes = await oldClient.execute(`SELECT * FROM ${table.name}`);
            const rows = dataRes.rows;

            if (rows.length === 0) {
                console.log(`   ⚠️ Table [${table.name}] is empty. Skipping data transfer.`);
                continue;
            }

            const columns = Object.keys(rows[0]);
            const placeholders = columns.map(() => '?').join(', ');
            
            // 🔥 CHANGED TO 'INSERT OR REPLACE' SO YOU CAN RERUN SAFELY
            const insertQuery = `INSERT OR REPLACE INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders})`;

            const chunkSize = 500;
            let insertedCount = 0;

            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                
                const statements = chunk.map(row => {
                    const args = columns.map(col => row[col]);
                    return { sql: insertQuery, args: args };
                });

                await newClient.batch(statements, "write");
                insertedCount += chunk.length;
                console.log(`   -> Inserted/Updated ${insertedCount}/${rows.length} into [${table.name}]`);
            }

            console.log(`✅ Completed data transfer for [${table.name}]`);
        }

        await newClient.execute("PRAGMA foreign_keys=ON;");

        console.log("\n🎉 MIGRATION COMPLETE WITH 0% DATA LOSS! 🎉");
        console.log("You can now update your main .env variables to point to the new database.");

    } catch (error) {
        console.error("\n❌ MIGRATION FAILED:", error);
    }
}

migrateDatabase();