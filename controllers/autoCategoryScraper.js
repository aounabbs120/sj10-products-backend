const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const https = require('https');

const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const userAgents = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'];

// Text Normalize Helper (Taa ke spelling mistakes ignore ho jayein)
const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

const fetchMarkazCategoryPage = async (markazUrl, pageNumber = 1) => {
    try {
        const urlWithPage = `${markazUrl}?page=${pageNumber}`;
        const { data: html } = await axios.get(urlWithPage, {
            headers: { 'User-Agent': userAgents[0], 'Accept': 'text/html' },
            httpsAgent, timeout: 10000
        });

        const $ = cheerio.load(html);
        let totalPages = 1;
        let totalProducts = 0;
        let productLinks = [];

        const nextDataRaw = $('#__NEXT_DATA__').html();
        if (nextDataRaw) {
            const nextData = JSON.parse(nextDataRaw);
            const pageProps = nextData?.props?.pageProps;
            const productsList = pageProps?.initialData?.products || pageProps?.products || [];
            
            const pagination = pageProps?.initialData?.pagination || pageProps?.pagination;
            if (pagination) {
                totalPages = pagination.totalPages || 1;
                totalProducts = pagination.totalItems || productsList.length;
            }

            productsList.forEach(p => {
                if (p.slug && p.id) productLinks.push(`https://www.markaz.app/shop/product/${p.slug}/${p.id}`);
            });
        }
        return { totalPages, totalProducts, productLinks };
    } catch (error) {
        return null;
    }
};

exports.runAutoScraper = async (req, res) => {
    if (res) res.json({ message: "Auto Scraper Started!" });

    try {
        console.log("🚀 [AUTO SCRAPER] Reading links from links.txt...");

        // 1. READ FILE (links.txt)
        const filePath = path.join(__dirname, '../links.txt');
        if (!fs.existsSync(filePath)) {
            console.log("❌ Error: links.txt file not found in root folder!");
            return;
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        // Extract links and remove empty lines
        const rawLinks = fileContent.split('\n').map(l => l.trim()).filter(l => l.includes('markaz.app'));

        console.log(`✅ Found ${rawLinks.length} links in your file.`);

        // 2. GET ALL DB CATEGORIES
        const [dbCategories] = await db.inventory.query(`
            SELECT id, name as sub_name FROM categories WHERE parent_id IS NOT NULL
        `);

        // 3. PROCESS EACH LINK
        for (const markazUrl of rawLinks) {
            console.log(`\n========================================`);
            
            // Link se aakhri hissa nikalo (e.g., "Skin%20Care" -> "Skin Care")
            const urlParts = markazUrl.split('/');
            const subCategoryNameFromUrl = decodeURIComponent(urlParts[urlParts.length - 1]);
            
            console.log(`🔍 Processing URL Category: "${subCategoryNameFromUrl}"`);

            // 4. AUTO-MATCH: DB ID dhundo
            // Pehle exact match try karo, nahi tou spaces/special characters hata kar match karo
            const normalizedUrlName = normalize(subCategoryNameFromUrl);
            let matchedDbCat = dbCategories.find(c => 
                c.sub_name.trim().toLowerCase() === subCategoryNameFromUrl.toLowerCase() || 
                normalize(c.sub_name) === normalizedUrlName ||
                // Custom Fixes for major differences
                (normalizedUrlName === 'rugscarpets' && normalize(c.sub_name).includes('rugs')) ||
                (normalizedUrlName === 'booksstationery' && normalize(c.sub_name).includes('stationary')) ||
                (normalizedUrlName === 'womenssandals' && normalize(c.sub_name).includes('sandles'))
            );

            if (!matchedDbCat) {
                console.log(`⚠️ Warning: Could not find Category ID for "${subCategoryNameFromUrl}" in Database. Skipping.`);
                continue;
            }

            const categoryId = matchedDbCat.id;
            console.log(`✔️ Matched with DB ID: ${categoryId} (${matchedDbCat.sub_name})`);

            // 5. LOCAL DB CHECK (Count < 10)
            const localCountRes = await db.oracle.query(
                "SELECT COUNT(*) as total FROM products WHERE category_id = $1", 
                [categoryId]
            );
            const localCount = parseInt(localCountRes.rows[0].total);

            if (localCount >= 10) {
                console.log(`⏭️ [SKIPPING] Local DB already has ${localCount} products.`);
                continue; 
            }

            // 6. HIT MARKAZ EXACT URL
            console.log(`🌐 Hitting Markaz: ${markazUrl}`);
            const page1Data = await fetchMarkazCategoryPage(markazUrl, 1);

            if (!page1Data) {
                console.log(`⚠️ Could not fetch data from Markaz. Skipping.`);
                continue;
            }

            console.log(`📊 Markaz Stats: ${page1Data.totalProducts} Products across ${page1Data.totalPages} Pages.`);

            if (page1Data.totalProducts < 10) {
                console.log(`⏭️ [SKIPPING] Markaz has less than 10 products (${page1Data.totalProducts}). Skipping.`);
                continue;
            }

            // 7. EXACT PAGES LOOP
            let allProductLinksForCategory = [...page1Data.productLinks]; 

            for (let i = 2; i <= page1Data.totalPages; i++) {
                console.log(`   📄 Fetching Page ${i} of ${page1Data.totalPages}...`);
                const pageData = await fetchMarkazCategoryPage(markazUrl, i);
                if (pageData && pageData.productLinks) {
                    allProductLinksForCategory = allProductLinksForCategory.concat(pageData.productLinks);
                }
                await new Promise(r => setTimeout(r, 2000));
            }

            allProductLinksForCategory = [...new Set(allProductLinksForCategory)];
            console.log(`✅ Extraction Complete! Found ${allProductLinksForCategory.length} unique product links.`);
            
            console.log(`💾 Data ready to be saved for Category ID: ${categoryId}`);
           
            await new Promise(r => setTimeout(r, 4000));
        }

        console.log(`\n🎉 [AUTO SCRAPER] Finished checking all links in links.txt!`);

    } catch (error) {
        console.error("💥 Fatal Auto Scraper Error:", error);
    }
};