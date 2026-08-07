// checkProductBySku.js
require('dotenv').config();
const readline = require('readline');
const pools = require('./config/database'); // Config file path

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('🔍 Enter Product SKU (e.g., SJ10-164285): ', async (inputSku) => {
    const sku = inputSku.trim();
    if (!sku) {
        console.log('🔴 Please enter a valid SKU.');
        rl.close();
        process.exit(1);
    }

    console.log(`\n🔄 Searching Oracle Postgres DB for SKU: "${sku}"...\n`);

    try {
        if (!pools || !pools.oracle) {
            throw new Error("pools.oracle connection not found in config/database.js");
        }

        // 1. Search products table by SKU or SKU inside Slug
        const query = `
            SELECT * FROM products 
            WHERE LOWER(sku) = LOWER($1) 
               OR LOWER(slug) ILIKE $2 
               OR id = $1
            LIMIT 1
        `;
        const res = await pools.oracle.query(query, [sku, `%${sku}%`]);

        if (res.rows.length === 0) {
            console.log(`❌ No product found in Database with SKU/ID/Slug matching: "${sku}"`);
        } else {
            const product = res.rows[0];

            // 2. Fetch variants for this product
            const varRes = await pools.oracle.query(`SELECT * FROM variants WHERE product_id = $1`, [product.id]);
            product.variants = varRes.rows;

            console.log(`==================================================`);
            console.log(`✅ PRODUCT FOUND IN DATABASE: ${product.title}`);
            console.log(`==================================================\n`);

            // 3. Highlight Warranty & Stock Columns
            console.log(`🎯 SPECIFIC WARRANTY & STOCK FIELDS IN DB:`);
            console.log(`--------------------------------------------------`);
            console.log(`  🔹 ID               :`, product.id);
            console.log(`  🔹 SKU              :`, product.sku);
            console.log(`  🔹 Status           :`, product.status);
            console.log(`  🔹 Quantity (Stock) :`, product.quantity);
            console.log(`  🔹 Warranty Type    :`, product.warranty_type !== null && product.warranty_type !== undefined ? `"${product.warranty_type}"` : '🔴 NULL / NOT SAVED IN DB');
            console.log(`  🔹 Warranty Details :`, product.warranty_details !== null && product.warranty_details !== undefined ? `"${product.warranty_details}"` : '🔴 NULL / NOT SAVED IN DB');
            console.log(`--------------------------------------------------\n`);

            console.log(`📦 FULL RAW PRODUCT OBJECT FROM DB:`);
            console.log(JSON.stringify(product, null, 2));
        }

    } catch (error) {
        console.error('🔴 Database Query Error:', error.message);
    } finally {
        if (pools.oracle && typeof pools.oracle.end === 'function') {
            await pools.oracle.end();
        }
        rl.close();
        process.exit(0);
    }
});