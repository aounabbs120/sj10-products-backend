// syncMeili.js
require('dotenv').config();
const db = require('./config/database');

// 🚨 UNIVERSAL IMPORT JUGGAR: Handles both 'Meilisearch' and 'MeiliSearch' across all versions
const meiliPkg = require('meilisearch');
const MeilisearchConstructor = meiliPkg.Meilisearch || meiliPkg.MeiliSearch || meiliPkg.default || meiliPkg;

// Initialize Meilisearch Client pointing to Server p3 (Milli Search VM)
const meiliClient = new MeilisearchConstructor({
    host: 'http://129.159.225.126:7700',
    apiKey: 'Sj10MeiliSuperKey2026' // Aapka Master Key
});

async function startSync() {
    console.log("🚀 [MEILI SYNC] Starting full database synchronization...");

    try {
        // 1. Fetch all active products from Postgres (Oracle Server 1)
        const result = await db.oracle.query(
            "SELECT id, title, slug, sku, description, price, discounted_price, status, created_at FROM products WHERE status = 'in_stock'"
        );
        const products = result.rows;

        if (products.length === 0) {
            console.log("⚠️ No products found in Oracle to sync.");
            return;
        }

        console.log(`📦 Found ${products.length} products. Formatting for Meilisearch...`);

        // 2. Format data for Meilisearch (Ensure 'id' is mapped correctly)
        const documents = products.map(p => ({
            id: p.id,
            title: p.title,
            slug: p.slug,
            sku: p.sku || '',
            description: p.description || '',
            price: parseFloat(p.price || 0),
            discounted_price: parseFloat(p.discounted_price || p.price || 0),
            created_at: p.created_at
        }));

        // 3. Upload to Meilisearch Index 'products'
        const index = meiliClient.index('products');
        
        console.log("⏳ Uploading to Meilisearch (Takes 2-3 seconds)...");
        const task = await index.addDocuments(documents);
        
        console.log(`✅ [SUCCESS] Sync request submitted. Task ID: ${task.taskUid}`);
        console.log(`🏁 Meilisearch is indexing ${products.length} products in background.`);

    } catch (error) {
        console.error("🔴 Sync Failed:", error.message);
    } finally {
        process.exit();
    }
}

startSync();