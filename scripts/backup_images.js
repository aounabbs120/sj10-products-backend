// scripts/backup_images.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ✅ CORRECTED PATH: Pointing to root/config
const { clients } = require('../config/tursoConnection');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const backup = async () => {
    console.log("⚠️  STARTING FULL BACKUP OF IMAGE URLS...");
    
    const allData = {};
    const shardKeys = Object.keys(clients);

    for (const key of shardKeys) {
        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
            try {
                if (attempts > 0) console.log(`🔄 Retrying ${key} (Attempt ${attempts + 1})...`);
                else console.log(`Processing Shard: ${key}...`);

                // Fetch data
                const res = await clients[key].execute("SELECT id, image_url, image_urls, video_url FROM products");
                allData[key] = res.rows;
                
                console.log(`✅ Shard ${key}: Backed up ${res.rows.length} products.`);
                success = true;

            } catch (error) {
                attempts++;
                console.error(`❌ Error backing up ${key}: ${error.message}`);
                if (attempts < 3) await wait(2000); // Wait 2 seconds before retry
            }
        }

        if (!success) {
            console.error(`\n🚨 CRITICAL FAILURE: Could not backup ${key} after 3 attempts.`);
            console.error("STOP. Check your internet or Turso status before proceeding.\n");
            process.exit(1); // Stop the script entirely so you don't think it succeeded
        }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(__dirname, `backup_products_${timestamp}.json`);

    fs.writeFileSync(filename, JSON.stringify(allData, null, 2));
    console.log(`\n🎉 BACKUP COMPLETE! File saved to: ${filename}`);
};

backup();