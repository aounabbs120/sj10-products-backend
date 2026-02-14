// scripts/replace_urls.js
require('dotenv').config();

// ✅ CORRECTED PATH: Pointing to root/config
const { clients } = require('../config/tursoConnection');

// ================= CONFIGURATION =================
// 🔴 SAFETY SWITCH: 
// Set true  = Checks what will happen (Recommended first run)
// Set false = Actually changes the database
const DRY_RUN = false;

// The exact string to find (from your request)
const OLD_DOMAIN = "pub-1390981b409c46698da5dc6c45e08eaa.r2.dev";

// The exact string to replace it with
const NEW_DOMAIN = "media.sj10.pk";
// =================================================

const startMigration = async () => {
    console.log(`\n🚀 STARTING URL MIGRATION`);
    console.log(`🔹 MODE: ${DRY_RUN ? "DRY RUN (No changes will be saved)" : "LIVE (Database will be updated)"}`);
    console.log(`🔹 REPLACING: ${OLD_DOMAIN}`);
    console.log(`🔹 WITH:      ${NEW_DOMAIN}\n`);

    const shardKeys = Object.keys(clients);

    for (const key of shardKeys) {
        console.log(`\nScanning Shard: ${key}...`);
        const client = clients[key];

        try {
            // 1. Get all products
            const res = await client.execute("SELECT id, title, image_url, image_urls, video_url FROM products");
            const products = res.rows;
            let updateCount = 0;

            // 2. Loop through every product
            for (const p of products) {
                let needsUpdate = false;
                
                // --- Prepare Clean Variables ---
                let finalImageUrl = p.image_url;
                let finalVideoUrl = p.video_url;
                let finalImageUrlsStr;

                // Handle image_urls: Ensure it is always a string for processing
                if (typeof p.image_urls === 'object' && p.image_urls !== null) {
                    finalImageUrlsStr = JSON.stringify(p.image_urls);
                } else {
                    finalImageUrlsStr = String(p.image_urls || '');
                }

                // --- Check & Replace ---

                // 1. Check image_url
                if (finalImageUrl && finalImageUrl.includes(OLD_DOMAIN)) {
                    finalImageUrl = finalImageUrl.split(OLD_DOMAIN).join(NEW_DOMAIN);
                    needsUpdate = true;
                }

                // 2. Check video_url
                if (finalVideoUrl && finalVideoUrl.includes(OLD_DOMAIN)) {
                    finalVideoUrl = finalVideoUrl.split(OLD_DOMAIN).join(NEW_DOMAIN);
                    needsUpdate = true;
                }

                // 3. Check image_urls (JSON String)
                if (finalImageUrlsStr && finalImageUrlsStr.includes(OLD_DOMAIN)) {
                    finalImageUrlsStr = finalImageUrlsStr.split(OLD_DOMAIN).join(NEW_DOMAIN);
                    needsUpdate = true;
                }

                // --- Execute Update ---
                if (needsUpdate) {
                    updateCount++;
                    
                    if (DRY_RUN) {
                        // Print first 3 matches only to keep log clean
                        if (updateCount <= 3) {
                            console.log(`   [DRY RUN] Match found in Product ID ${p.id}`);
                            console.log(`      Example OLD: ...${OLD_DOMAIN}...`);
                            console.log(`      Example NEW: ...${NEW_DOMAIN}...`);
                        }
                    } else {
                        // EXECUTE UPDATE
                        // We send finalImageUrlsStr back as a string to ensure safety
                        await client.execute({
                            sql: `UPDATE products SET image_url = ?, image_urls = ?, video_url = ? WHERE id = ?`,
                            args: [finalImageUrl, finalImageUrlsStr, finalVideoUrl, p.id]
                        });
                        if (updateCount % 50 === 0) process.stdout.write("."); // Progress dots
                    }
                }
            }

            console.log(`\n✅ Shard ${key} complete. Total updates found: ${updateCount}`);

        } catch (error) {
            console.error(`❌ Error processing shard ${key}:`, error);
        }
    }

    console.log("\n🏁 PROCESS FINISHED.");
};

startMigration();