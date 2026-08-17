// checkMissingCategories.js
require('dotenv').config();
const db = require('./config/database'); // Apna DB path check kar lein

async function getMissingCategoriesReport() {
    console.log("\n========================================================================");
    console.log("🔍 SCANNING DATABASE FOR SUBCATEGORIES WITH LESS THAN 10 PRODUCTS...");
    console.log("========================================================================\n");

    try {
        // 1. Fetch Subcategories & Parent Categories from db.inventory (MySQL)
        const [subCategories] = await db.inventory.query(`
            SELECT 
                c1.id AS sub_id, 
                c1.name AS sub_name, 
                c2.name AS parent_name 
            FROM categories c1 
            JOIN categories c2 ON c1.parent_id = c2.id 
            WHERE c1.parent_id IS NOT NULL 
            ORDER BY c2.name ASC, c1.name ASC
        `);

        if (!subCategories || subCategories.length === 0) {
            console.log("❌ No subcategories found in db.inventory categories table!");
            process.exit(0);
        }

        // 2. Fetch Product Counts per Category ID from db.oracle (Postgres)
        const pgResult = await db.oracle.query(`
            SELECT category_id, COUNT(*) as total_products 
            FROM products 
            WHERE category_id IS NOT NULL 
            GROUP BY category_id
        `);

        // Create a Map for fast lookup (Converting IDs to String for safety)
        const productCountMap = new Map();
        pgResult.rows.forEach(row => {
            if (row.category_id) {
                productCountMap.set(String(row.category_id).trim(), parseInt(row.total_products));
            }
        });

        // 3. Filter Subcategories where count < 10
        const missingCategories = [];

        subCategories.forEach(cat => {
            const count = productCountMap.get(String(cat.sub_id).trim()) || 0;
            
            if (count < 10) {
                missingCategories.push({
                    'Sub ID': cat.sub_id,
                    'Main Category': cat.parent_name,
                    'Subcategory Name': cat.sub_name,
                    'Products in DB': count
                });
            }
        });

        // 4. Output Results in Terminal
        console.log(`📊 Total Subcategories in DB: ${subCategories.length}`);
        console.log(`⚠️  Subcategories needing products (< 10 products): ${missingCategories.length}\n`);

        if (missingCategories.length === 0) {
            console.log("🎉 ALL SUBCATEGORIES HAVE 10 OR MORE PRODUCTS! No category is empty.\n");
        } else {
            // Displays beautiful native CLI table
            console.table(missingCategories);
        }

    } catch (error) {
        console.error("💥 Error generating report:", error.message);
    } finally {
        process.exit(0);
    }
}

getMissingCategoriesReport();