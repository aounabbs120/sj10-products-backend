require('dotenv').config();
const { clients, viewsClient } = require('../config/tursoConnection');
const db = require('../config/database');

// --- HELPER: Parse Product ---
const parseProduct = (p) => {
    if (!p) return null;
    try {
        p.image_urls = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : (p.image_urls || []);
    } catch (e) {
        p.image_urls = p.image_url ? [p.image_url] : [];
    }
    p.price = parseFloat(p.price);
    p.discounted_price = parseFloat(p.discounted_price || p.price);
    p.views = p.views || 0;
    return p;
};

// --- HELPER: Get Products from Turso by IDs ---
const getProductsFromTursoByIds = async (ids) => {
    if (!ids || ids.length === 0) return [];
    const shardKeys = Object.keys(clients);
    const promises = shardKeys.map(key =>
        clients[key].execute({ sql: `SELECT * FROM products WHERE id IN (${ids.map(()=>'?').join(',')})`, args: ids })
            .then(res => res.rows)
            .catch(() => [])
    );
    const results = await Promise.all(promises);
    return results.flat();
};

/* ======================================================
   🔥 NEW HELPER: GLOBALLY ATTACH VERIFIED STATUS 🔥
   This ensures Homepage, Categories, etc. all get the badge data
   ====================================================== */
const enrichWithSupplierDetails = async (products) => {
    if (!products || products.length === 0) return [];
    
    // 1. Extract Unique Supplier IDs
    const supplierIds = [...new Set(products.map(p => p.supplier_id).filter(Boolean))];
    if (supplierIds.length === 0) return products.map(parseProduct); // Return parsed if no suppliers

    try {
        // 2. Fetch Verified Status from MySQL
        const [suppliers] = await db.suppliers.query(
            "SELECT id, verified_status, city FROM suppliers WHERE id IN (?)",
            [supplierIds]
        );
        
        // 3. Create Map for Speed
        const supplierMap = new Map(suppliers.map(s => [s.id, s]));

        // 4. Attach Status to Products
        return products.map(p => {
            const parsed = parseProduct(p);
            const s = supplierMap.get(p.supplier_id);
            
            // ROBUST CHECK: 'verified', 'Verified', 'VERIFIED' all work now
            const isVerified = s && String(s.verified_status).toLowerCase() === 'verified';

            return {
                ...parsed,
                supplier_verified: isVerified, // <--- THIS FORCES THE BADGE
                supplier_city: s ? s.city : null,
                // Check for Video
                has_video: (p.video_url && p.video_url.length > 5) || parsed.image_urls.some(url => url && url.includes('.mp4'))
            };
        });
    } catch (e) {
        console.error("Enrichment Error:", e);
        return products.map(parseProduct); // Fallback
    }
};
/* ==========================================================================
   🔥 GLOBAL CARD CONSTRUCTOR (Dedicated Function for All Pages) 🔥
   
   This function runs for Home, Explore, Category, and Search.
   It attaches:
   1. Supplier Info (Verified Badge)
   2. Ratings
   3. Views
   4. ⭐ NEW: Discount Label (Flash Sale Badge)
   ========================================================================== */
const constructProductCards = async (rawProducts) => {
    if (!rawProducts || rawProducts.length === 0) return [];

    // 1. Prepare IDs for Batch Fetching
    const productIds = rawProducts.map(p => p.id);
    const supplierIds = [...new Set(rawProducts.map(p => p.supplier_id).filter(Boolean))];
    
    // Safety check to prevent SQL errors
    const sIdsSafe = supplierIds.length ? supplierIds : [0];
    const pIdsSafe = productIds.length ? productIds : [0];

    try {
        // 2. Fetch All "Side Data" in Parallel (Fast)
        const [suppliersRes, ratingsRes, viewsRes, discountRes] = await Promise.all([
            // A. Fetch Supplier Details (Verified Status)
            db.suppliers.query(`SELECT id, verified_status, city, brand_name FROM suppliers WHERE id IN (?)`, [sIdsSafe]).catch(()=>[[]]),
            
            // B. Fetch Ratings
            db.reviews.query(`SELECT product_id, avg_rating, review_count FROM product_ratings WHERE product_id IN (?)`, [pIdsSafe]).catch(()=>[[]]),
            
            // C. Fetch Views (Turso)
            viewsClient ? viewsClient.execute({ 
                sql: `SELECT product_id, views FROM product_views WHERE product_id IN (${pIdsSafe.map(()=>'?').join(',')})`,
                args: pIdsSafe 
            }).catch(() => ({ rows: [] })) : { rows: [] },

            // D. 🔥 FETCH ACTIVE DISCOUNT BADGES (The New Logic) 🔥
            // This gets the label (e.g., "Flash Sale") for the specific products loaded
            db.inventory.query(`
                SELECT dp.product_id, d.name 
                FROM discount_products dp 
                JOIN discounts d ON dp.discount_id = d.id 
                WHERE d.is_active = 1 
                AND dp.product_id IN (?)
            `, [pIdsSafe]).catch(() => [[]])
        ]);

        // 3. Create Lookup Maps (Using String Keys for Safety)
        // We use String() to ensure ID 12 matches "12"
        const supplierMap = new Map(suppliersRes[0].map(s => [String(s.id), s]));
        const ratingMap = new Map(ratingsRes[0].map(r => [r.product_id, r]));
        const viewsMap = new Map(viewsRes.rows.map(v => [v.product_id, v.views]));
        
        // 🔥 Discount Map: ProductID -> Badge Name
        const discountNameMap = new Map(discountRes[0].map(d => [String(d.product_id), d.name]));

        // 4. Construct the Final Object for <ProductCard />
        return rawProducts.map(p => {
            // -- Image Parsing --
            let image_urls = [];
            try { image_urls = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : (p.image_urls || []); } 
            catch (e) { image_urls = p.image_url ? [p.image_url] : []; }

            // -- Supplier Lookup --
            const sData = supplierMap.get(String(p.supplier_id));
            const rData = ratingMap.get(p.id) || { avg_rating: 0, review_count: 0 };

            // -- Verified Badge Logic --
            let isVerified = false;
            let dbStatus = 'unverified'; 
            if (sData && sData.verified_status) {
                dbStatus = String(sData.verified_status).trim().toLowerCase();
                if (['verified', 'true', '1'].includes(dbStatus)) isVerified = true;
            }

            // -- Video Check --
            const hasVideo = (p.video_url && p.video_url.length > 5) || image_urls.some(url => url && url.includes('.mp4'));

            // -- The Final Data Object --
            return {
                id: p.id,
                title: p.title,
                slug: p.slug,
                sku: p.sku || null, // 👈 ADD THIS LINE HERE
                price: parseFloat(p.price),
                discounted_price: parseFloat(p.discounted_price || p.price),
                
                // 🔥 HERE IS THE MAGIC: Sends data to <ProductCard /> on ALL pages 🔥
                discount_label: discountNameMap.get(String(p.id)) || null, 

                image_urls: image_urls,
                video_url: p.video_url,
                has_video: hasVideo,
                created_at: p.created_at,
                
                // Supplier Data
                supplier_id: p.supplier_id,
                supplier_verified: isVerified,
                supplier: { 
                    verified_status: dbStatus, 
                    city: sData ? sData.city : '',
                    brand_name: sData ? sData.brand_name : ''
                },
                supplier_city: sData ? sData.city : '',

                // Stats
                avg_rating: parseFloat(rData.avg_rating || 0),
                review_count: rData.review_count || 0,
                views: viewsMap.get(p.id) || 0,
                product_ratings: [{ avg_rating: parseFloat(rData.avg_rating || 0), review_count: rData.review_count || 0 }]
            };
        });

    } catch (e) {
        console.error("ConstructCard Error:", e);
        // Fallback if DB fails
        return rawProducts.map(p => parseProduct(p));
    }
};

// ... existing getExploreFeed code ...

/* ======================================================
   NEW: DEDICATED SEARCH RESULTS (Promoted First)
   ====================================================== */
exports.getSearchResults = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const offset = (page - 1) * limit;
        const { q } = req.query; // Search term

        if (!q) return res.json({ products: [], totalCount: 0 });

        // 1. Fetch Promoted IDs
        let promotedIds = [];
        try {
            const [pRows] = await db.inventory.query(
                "SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW()"
            );
            promotedIds = pRows.map(r => r.product_id);
        } catch (e) {}

        // 2. Search Query
        const term = `%${q.trim().toLowerCase()}%`;
        const sql = `SELECT * FROM products WHERE status = 'in_stock' AND LOWER(title) LIKE ?`;
        const args = [term];

        // 3. Execute across shards
        const clientValues = Object.values(clients).filter(Boolean);
        const promises = clientValues.map(async (client) => {
            try {
                const res = await client.execute({ sql, args });
                return res.rows;
            } catch (e) { return []; }
        });

        const results = await Promise.all(promises);
        let allProducts = results.flat();

        // 4. 🔥 SORTING MAGIC: Promoted First 🔥
        const promotedSet = new Set(promotedIds.map(String)); // String for safe comparison

        allProducts.sort((a, b) => {
            const isAPromoted = promotedSet.has(String(a.id));
            const isBPromoted = promotedSet.has(String(b.id));

            // Logic: Promoted comes before Non-Promoted
            if (isAPromoted && !isBPromoted) return -1;
            if (!isAPromoted && isBPromoted) return 1;
            
            // Tie-breaker: Newest First
            return new Date(b.created_at) - new Date(a.created_at);
        });

        // 5. Pagination (In-Memory)
        const totalCount = allProducts.length;
        const paginatedProducts = allProducts.slice(offset, offset + limit);

        // 6. Enrich Data (Images/Badges)
        const finalProducts = await constructProductCards(paginatedProducts);

        // 7. Add 'is_promoted' flag for UI
        const finalWithFlag = finalProducts.map(p => ({
            ...p,
            is_promoted: promotedSet.has(String(p.id))
        }));

        res.json({ products: finalWithFlag, totalCount });

    } catch (e) {
        console.error("Search Error:", e);
        res.status(500).json({ products: [], totalCount: 0 });
    }
};
/* ======================================================
   NEW: TEXT-ONLY SUGGESTIONS (Super Fast)
   ====================================================== */
// ✅ THIS FUNCTION MUST EXIST AND BE EXPORTED
exports.getSearchSuggestionsText = async (req, res) => {
    try {
        const { q } = req.query;
        if(!q || q.length < 2) return res.json([]);

        // Only select ID, title, and slug to make it lightweight
        const sql = `SELECT id, title, slug FROM products WHERE status='in_stock' AND LOWER(title) LIKE ? LIMIT 3`;
        const args = [`%${q.trim().toLowerCase()}%`];

        const promises = Object.values(clients).map(c => 
            c.execute({ sql, args }).then(r => r.rows).catch(()=>[])
        );

        const results = await Promise.all(promises);
        // Flatten results from all shards and limit to 6 total suggestions
        const suggestions = results.flat().slice(0, 6);

        res.json(suggestions);
    } catch(e) { 
        console.error("Suggestions-Text Error:", e);
        res.json([]); 
    }
};
exports.getExploreFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const offset = (page - 1) * limit;
        const { sort = 'default', hasVideo, showVerified, search, category_id, rating, minPrice, maxPrice, city } = req.query;

        let sql = `SELECT * FROM products WHERE status = 'in_stock'`;
        let countSql = `SELECT COUNT(*) as total FROM products WHERE status = 'in_stock'`;
        let args = [];

        if (search) { const term = `%${search.trim().toLowerCase()}%`; sql += ` AND LOWER(title) LIKE ?`; countSql += ` AND LOWER(title) LIKE ?`; args.push(term); }
        if (category_id && category_id.trim() !== '') {
            const selectedIds = category_id.split(',').map(id => id.trim()).filter(Boolean);
            const idsPlaceholder = selectedIds.map(() => '?').join(',');
            sql += ` AND category_id IN (${idsPlaceholder})`; countSql += ` AND category_id IN (${idsPlaceholder})`; args.push(...selectedIds);
        }
        if (minPrice) { sql += ` AND (discounted_price >= ? OR price >= ?)`; countSql += ` AND (discounted_price >= ? OR price >= ?)`; args.push(minPrice, minPrice); }
        if (maxPrice) { sql += ` AND (discounted_price <= ? OR price <= ?)`; countSql += ` AND (discounted_price <= ? OR price <= ?)`; args.push(maxPrice, maxPrice); }

        const shouldCount = page === 1;
        const clientValues = Object.values(clients).filter(Boolean);
        const promises = clientValues.map(async (client) => {
            try {
                const pRes = await client.execute({ sql: sql + ` LIMIT 150`, args });
                let count = 0;
                if (shouldCount) {
                    const cRes = await client.execute({ sql: countSql, args });
                    count = cRes.rows[0]?.total || 0;
                }
                return { products: pRes.rows || [], count };
            } catch (e) { return { products: [], count: 0 }; }
        });

        const results = await Promise.all(promises);
        let allProducts = [];
        let realTotalCount = 0;
        results.forEach(r => { allProducts.push(...r.products); realTotalCount += r.count; });

        // 🔥 USE THE CONSTRUCTOR 🔥
        let finalProducts = await constructProductCards(allProducts);

        // Sorting & Filtering (In-Memory)
        if (hasVideo === 'true') finalProducts = finalProducts.filter(p => p.has_video);
        if (showVerified === 'true') finalProducts = finalProducts.filter(p => p.supplier_verified);
        if (rating) finalProducts = finalProducts.filter(p => Math.round(p.avg_rating) >= parseInt(rating));
        if (city && city !== 'All') finalProducts = finalProducts.filter(p => p.supplier_city?.toLowerCase() === city.toLowerCase());

        if (sort === 'newest') finalProducts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        else if (sort === 'price_low_high') finalProducts.sort((a, b) => (a.discounted_price || a.price) - (b.discounted_price || b.price));
        else if (sort === 'price_high_low') finalProducts.sort((a, b) => (b.discounted_price || b.price) - (a.discounted_price || a.price));
        else { // Default
            finalProducts.sort((a, b) => {
                if (b.review_count !== a.review_count) return b.review_count - a.review_count;
                return b.views - a.views;
            });
        }

        const paginatedProducts = finalProducts.slice(offset, offset + limit);

        res.status(200).json({
            products: paginatedProducts,
            totalCount: shouldCount ? realTotalCount : undefined
        });

    } catch (e) {
        console.error("Explore Error:", e);
        res.status(200).json({ products: [], totalCount: 0 });
    }
};

/* ======================================================
   2. HOMEPAGE DATA (Controller Update)
   ====================================================== */
exports.getHomepageData = async (req, res) => {
    try {
        const [bannersRes, promotedRes, catsRes, ...shardResults] = await Promise.all([
            db.inventory.query("SELECT id, image_url, link_url FROM banners WHERE is_active = 1"),
            // Fetch promoted products (ensure we have enough candidates)
            db.inventory.query("SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW() ORDER BY start_date DESC"),
            db.inventory.query("SELECT id, name, image_url, slug, parent_id FROM categories ORDER BY name ASC"),
            // Increased limit here to ensure we have enough for Popular section
            ...Object.values(clients).map(c => c.execute("SELECT * FROM products WHERE status = 'in_stock' ORDER BY created_at DESC LIMIT 40"))
        ]);

        const [banners] = bannersRes;
        const [promotedRows] = promotedRes;
        const [allCats] = catsRes;

        // 1. Promoted: Limit to top 50
        const promotedIds = new Set(promotedRows.map(r => r.product_id));
        // Slice the IDs first to avoid fetching too much data if not needed
        const top50PromotedIds = [...promotedIds].slice(0, 50); 
        let promotedProductsFull = await getProductsFromTursoByIds(top50PromotedIds);
        const promotedTop50 = await constructProductCards(promotedProductsFull); 

        // 2. Popular (Sharded): Limit to 100
        let generalProducts = shardResults.map(res => res.rows).flat().filter(p => !promotedIds.has(p.id));
        // CHANGED: Slice to 100 products as requested
        const popularMixed = await constructProductCards(generalProducts.slice(0, 100)); 

        // 3. Cats Logic (unchanged)
        const subCategoriesAll = allCats.filter(cat => cat.parent_id);
        const subCatRow1 = subCategoriesAll.slice(0, 16);
        const subCatRow2 = subCategoriesAll.slice(16, 32);
        const subCatRow3 = subCategoriesAll.slice(32, 48);
        
        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
        res.json({ banners: banners || [], subCatRow1, subCatRow2, subCatRow3, promotedTop50, popularMixed });

    } catch (error) {
        console.error("Homepage Error:", error);
        res.status(500).json({ banners: [], subCatRow1: [], subCatRow2: [], subCatRow3: [], promotedTop50: [], popularMixed: [] });
    }
};




exports.getHomepageCategories = async (req, res) => {
    try {
        // Only fetch what we need: Categories
        const [allCats] = await db.inventory.query(
            "SELECT id, name, image_url, slug, parent_id FROM categories ORDER BY name ASC"
        );

        // Logic to split them into rows (Moved from getHomepageData)
        const subCategoriesAll = allCats.filter(cat => cat.parent_id);
        const subCatRow1 = subCategoriesAll.slice(0, 16);
        const subCatRow2 = subCategoriesAll.slice(16, 32);
        const subCatRow3 = subCategoriesAll.slice(32, 48);

        // Aggressive Caching for Categories (They rarely change)
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
        
        res.json({ subCatRow1, subCatRow2, subCatRow3 });
    } catch (error) {
        console.error("Homepage Cats Error:", error);
        res.status(500).json({ subCatRow1: [], subCatRow2: [], subCatRow3: [] });
    }
};




exports.getMainCategories = async (req, res) => {
    try {
        const [mainCategories] = await db.inventory.query("SELECT id, name, slug FROM categories WHERE parent_id IS NULL ORDER BY name ASC");
        res.json({ categories: mainCategories });
    } catch (error) { res.status(500).json({ categories: [] }); }
};

exports.getCategoriesWithSubcategories = async (req, res) => {
    try {
        const [parentsPromise, childrenPromise] = [
            db.inventory.query("SELECT id, name, image_url, slug FROM categories WHERE parent_id IS NULL ORDER BY name ASC"),
            db.inventory.query("SELECT id, name, image_url, slug, parent_id FROM categories WHERE parent_id IS NOT NULL")
        ];
        const [[parents], [children]] = await Promise.all([parentsPromise, childrenPromise]);
        const parentMap = new Map();
        parents.forEach(p => { p.subcategories = []; parentMap.set(p.id, p); });
        children.forEach(child => { if (parentMap.has(child.parent_id)) { parentMap.get(child.parent_id).subcategories.push(child); } });
        res.status(200).json({ mainCats: parents });
    } catch (error) { res.status(500).json({ mainCats: [] }); }
};

// ... Keep getSearchSuggestions, getProductBySlug, etc. unchanged below ...
exports.getSearchSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if(!q || q.length < 2) return res.json([]);
        const sql = `SELECT title FROM products WHERE LOWER(title) LIKE LOWER(?) LIMIT 5`;
        const args = [`%${q.trim()}%`];
        const promises = Object.values(clients).map(c => c.execute({ sql, args }).then(r => r.rows).catch(()=>[]));
        const results = await Promise.all(promises);
        const suggestions = [...new Set(results.flat().map(p => p.title))].slice(0, 6);
        res.json(suggestions);
    } catch(e) { res.json([]); }
};

// --- UPDATED: GET PRODUCT BY SLUG (Supports Slug-SKU logic) ---
exports.getProductBySlug = async (req, res) => {
    try {
        let rawParam = req.params.slug || req.params.id;
        if (!rawParam || rawParam === 'undefined') return res.status(400).json({ message: "Invalid ID" });

        const decodedParam = decodeURIComponent(rawParam).trim();
        const shardKeys = Object.keys(clients);
        
        // 1. Try ID match (Legacy format: slug--12)
        const idMatch = decodedParam.match(/--(\d+)$/);
        const extractedId = idMatch ? idMatch[1] : (req.params.id && !isNaN(req.params.id) ? req.params.id : null);

        // 2. Try SKU match (New format: slug-SKU123)
        // We assume SKU is the last part of the URL after the last hyphen
        const parts = decodedParam.split('-');
        const potentialSku = parts.length > 1 ? parts[parts.length - 1] : null;

        const promises = shardKeys.map(async (key) => {
            const client = clients[key];
            try {
                // Priority 1: Search by ID (Fastest/Safest)
                if (extractedId) {
                    const res = await client.execute({ sql: "SELECT * FROM products WHERE id = ?", args: [extractedId] });
                    if (res.rows.length > 0) return res;
                }

                // Priority 2: Search by Exact Slug (Legacy)
                const resSlug = await client.execute({ sql: "SELECT * FROM products WHERE slug = ?", args: [decodedParam] });
                if (resSlug.rows.length > 0) return resSlug;

                // Priority 3: Search by SKU (Logic for your new URL structure)
                if (potentialSku) {
                    const resSku = await client.execute({ sql: "SELECT * FROM products WHERE sku = ?", args: [potentialSku] });
                    if (resSku.rows.length > 0) return resSku;
                }
                
                return { rows: [] };
            } catch (e) { return { rows: [] }; }
        });

        const results = await Promise.all(promises);
        const foundRow = results.flatMap(r => r.rows)[0];

        if (!foundRow) return res.status(404).json({ message: "Product not found" });

        const product = foundRow;

        // Fetch Parallel Details
        const [sup, rev, variants, promo, discount, views, favs] = await Promise.all([
            db.suppliers.query("SELECT id, brand_name as name, profile_pic, average_rating, followers_count, verified_status, total_products, city FROM suppliers WHERE id = ?", [product.supplier_id]),
            db.reviews.query("SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC", [product.id]),
            clients[results.findIndex(r => r.rows.length) >= 0 ? shardKeys[results.findIndex(r => r.rows.length)] : 'shard_general']
                .execute({ sql: "SELECT * FROM variants WHERE product_id = ?", args: [product.id] }),
            db.inventory.query("SELECT id FROM promoted_products WHERE product_id = ? AND status='active' AND end_date > NOW()", [product.id]),
            db.inventory.query("SELECT d.name FROM discount_products dp JOIN discounts d ON dp.discount_id = d.id WHERE dp.product_id = ? AND d.is_active = 1", [product.id]),
            viewsClient.execute({ sql: "SELECT views FROM product_views WHERE product_id = ?", args: [product.id] }),
            db.db_social ? db.db_social.query("SELECT COUNT(*) as count FROM product_favorites WHERE product_id = ?", [product.id]) : [[{count:0}]]
        ]);

        const sData = sup[0][0] || {};
        const isVerified = ['verified', 'true', '1'].includes(String(sData.verified_status).toLowerCase());
        
        // Construct Final Object
        const finalProduct = {
            ...parseProduct(product),
            supplier: { ...sData, verified_status: isVerified ? 'verified' : 'unverified' },
            supplier_verified: isVerified,
            reviews: rev[0].map(r => ({...r, image_urls: r.image_urls ? JSON.parse(r.image_urls) : []})),
            variants: variants.rows || [],
            is_promoted: promo[0].length > 0,
            discount_label: discount[0].length > 0 ? discount[0][0].name : null,
            views: views.rows[0]?.views || 0,
            favorites_count: favs[0][0]?.count || 0
        };

        res.json(finalProduct);

    } catch (e) {
        console.error("GetProduct Error:", e);
        res.status(500).json({ message: "Server Error" });
    }
};

/* ======================================================
   3. CATEGORY ROWS (OPTIMIZED & FIXED)
   ====================================================== */
exports.getCategoryRows = async (req, res) => {
    try {
        // 1. Fetch ALL categories (Parents & Children) in ONE single query
        const [allCats] = await db.inventory.query(
            "SELECT id, name, slug, db_shard, parent_id FROM categories ORDER BY name ASC"
        );

        // 2. Separate Parents and Children in Memory
        // FIXED TYPO HERE: changed 'cB' to 'c'
        const parents = allCats.filter(c => !c.parent_id);
        const children = allCats.filter(c => c.parent_id); 

        // 3. Create a Map for fast lookup of subcategories
        const childMap = new Map();
        children.forEach(c => {
            if (!childMap.has(c.parent_id)) childMap.set(c.parent_id, []);
            childMap.get(c.parent_id).push(c.id);
        });

        // 4. Parallel execution for products
        const promises = parents.map(async p => {
            const client = clients[p.db_shard] || clients.shard_general;
            
            // Get subcategory IDs from our memory map
            const subIds = childMap.get(p.id) || [];
            const ids = [p.id, ...subIds].join(',');

            try {
                // Select only specific columns to reduce data transfer size
                const sql = `
                    SELECT id, title, slug, sku, price, discounted_price,  
                           image_urls, video_url, supplier_id, created_at, 
                           category_id, views 
                    FROM products

                    WHERE category_id IN (${ids}) 
                    AND status='in_stock' 
                    ORDER BY created_at DESC 
                    LIMIT 10
                `;
                
                const res = await client.execute(sql);
                
                if(res.rows.length > 0) {
                    // Enrich with Supplier Badges & Ratings
                    const enriched = await constructProductCards(res.rows);
                    return { category_id: p.id, category_name: p.name, category_slug: p.slug, products: enriched };
                }
            } catch(e) {
                console.error(`Error fetching rows for cat ${p.id}`, e.message);
            }
            return null;
        });

        const rows = (await Promise.all(promises)).filter(r => r);

        // Set Aggressive Caching
        res.set('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=60');
        res.json(rows);

    } catch (e) { 
        console.error("CategoryRows Error:", e);
        res.json([]); 
    }
};
/* ======================================================
   FIXED: Get Products By Category (Removed invalid sort)
   ====================================================== */
exports.getProductsByCategorySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const offset = (page - 1) * limit;
        
        // Filters
        const sort = req.query.sort || 'default';
        const search = req.query.search ? req.query.search.trim() : null;
        const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;

        // 1. Get Category Info
        const [catRows] = await db.inventory.query("SELECT id, name, slug, db_shard FROM categories WHERE slug = ?", [slug]);
        if (catRows.length === 0) return res.status(404).json({ message: "Not found" });
        const category = catRows[0];
        const client = clients[category.db_shard || 'shard_general'] || clients.shard_general;

        // 2. Get Subcategory IDs
        const [children] = await db.inventory.query("SELECT id FROM categories WHERE parent_id = ?", [category.id]);
        const ids = [category.id, ...children.map(c => c.id)].join(',');

        // 3. FETCH PROMOTED IDs (From MySQL)
        let promotedIds = [];
        try {
            const [pRows] = await db.inventory.query(
                "SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW()"
            );
            promotedIds = pRows.map(r => String(r.product_id)); 
        } catch (e) { console.error(e); }

        // 4. Build SQL for Turso
        let sql = `SELECT * FROM products WHERE category_id IN (${ids}) AND status = 'in_stock'`;
        let countSql = `SELECT COUNT(*) as total FROM products WHERE category_id IN (${ids}) AND status = 'in_stock'`;
        let args = [];

        // Search Logic
        if (search) {
            sql += ` AND LOWER(title) LIKE ?`;
            countSql += ` AND LOWER(title) LIKE ?`;
            args.push(`%${search.toLowerCase()}%`);
        }
        // Price Logic
        if (maxPrice) {
            sql += ` AND price <= ?`;
            countSql += ` AND price <= ?`;
            args.push(maxPrice);
        }

        // 5. 🔥 SORTING LOGIC (FIXED) 🔥
        // We calculate Promoted status here: 0 = Promoted, 1 = Not Promoted
        let promotedFragment = "1"; 
        if (promotedIds.length > 0) {
            const idList = promotedIds.map(id => `'${id}'`).join(',');
            promotedFragment = `CASE WHEN id IN (${idList}) THEN 0 ELSE 1 END`;
        }

        // Apply Sort
        if (sort === 'price_high') {
            sql += ` ORDER BY price DESC`;
        } else if (sort === 'price_low') {
            sql += ` ORDER BY price ASC`;
        } else {
            // ❌ REMOVED: review_count DESC (Because it doesn't exist in Turso)
            // ✅ ADDED: id DESC (as a fallback tie-breaker)
            // Logic: Promoted First -> Then Newest -> Then by ID
            sql += ` ORDER BY ${promotedFragment} ASC, created_at DESC`;
        }

        sql += ` LIMIT ? OFFSET ?`;
        args.push(limit, offset);

        // 6. Execute Queries
        const [pRes, cRes] = await Promise.all([
            client.execute({ sql, args }),
            client.execute({ sql: countSql, args: args.slice(0, args.length - 2) })
        ]);

        // 7. Enrich Data (This puts the reviews back into the JSON response)
        let enrichedProducts = await constructProductCards(pRes.rows);
        
        // Flag Promoted for Frontend UI
        const promotedSet = new Set(promotedIds);
        enrichedProducts = enrichedProducts.map(p => ({
            ...p,
            is_promoted: promotedSet.has(String(p.id))
        }));

        // 🔥 OPTIONAL: CLIENT-SIDE SORT FOR "MOST REVIEWED" 🔥
        // If sorting by reviews is critical, we do it here on the current page of results
        if (sort === 'popular' || sort === 'default') {
            enrichedProducts.sort((a, b) => {
                // 1. Promoted First
                if (a.is_promoted !== b.is_promoted) return a.is_promoted ? -1 : 1;
                // 2. Then Review Count (We have this data now from constructProductCards)
                return (b.review_count || 0) - (a.review_count || 0);
            });
        }

        res.json({ 
            category, 
            products: enrichedProducts, 
            total: cRes.rows[0].total, 
            totalPages: Math.ceil(cRes.rows[0].total / limit), 
            currentPage: page 
        });

    } catch (e) { 
        console.error("Error in Category Controller:", e);
        res.status(500).json({message: "Server Error"}); 
    }
};
exports.incrementProductView = async (req, res) => {
    try {
        const { id } = req.params; 
        await viewsClient.execute({ sql: `INSERT INTO product_views (product_id, views) VALUES (?, 1) ON CONFLICT(product_id) DO UPDATE SET views = views + 1`, args: [id] });
        res.json({ status: "ok" });
    } catch(e) { res.json({ status: "error" }); }
};

exports.getActivePromotionalTimer = async (req, res) => {
    try {
        const [t] = await db.inventory.query("SELECT name, end_time, logo_url FROM promotional_timers WHERE is_active=1 AND end_time > NOW() LIMIT 1");
        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=10');
        res.json(t[0] || null);
    } catch(e) { res.json(null); }
};

exports.getCategoriesWithSubcategories = async (req, res) => {
    try {
        const [parentsPromise, childrenPromise] = [
            db.inventory.query("SELECT id, name, image_url, slug FROM categories WHERE parent_id IS NULL ORDER BY name ASC"),
            db.inventory.query("SELECT id, name, image_url, slug, parent_id FROM categories WHERE parent_id IS NOT NULL")
        ];
        const [[parents], [children]] = await Promise.all([parentsPromise, childrenPromise]);
        const parentMap = new Map();
        parents.forEach(p => { p.subcategories = []; parentMap.set(p.id, p); });
        children.forEach(child => { if (parentMap.has(child.parent_id)) { parentMap.get(child.parent_id).subcategories.push(child); } });
        const response = { mainCats: parents };
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=60'); 
        res.status(200).json(response);
    } catch (error) { res.status(500).json({ mainCats: [] }); }
};

exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        const shardKeys = Object.keys(clients);
        const searchPromises = shardKeys.map(async (key) => {
            const client = clients[key];
            try {
                const res = await client.execute({ sql: "SELECT * FROM products WHERE id = ? LIMIT 1", args: [id] });
                return res.rows.length > 0 ? { product: res.rows[0], client: client } : null;
            } catch (e) { return null; }
        });
        const results = await Promise.all(searchPromises);
        const match = results.find(r => r !== null);
        if (!match) return res.status(404).json({ message: "Product not found" });
        const { product, client } = match;
        let variants = [];
        try {
            const variantRes = await client.execute({ sql: "SELECT * FROM variants WHERE product_id = ?", args: [product.id] });
            variants = variantRes.rows;
        } catch (e) { }
        const finalProduct = parseProduct(product);
        finalProduct.variants = variants; 
        res.json(finalProduct);
    } catch (error) { res.status(500).json({ message: "Server Error" }); }
};

// --- THIS LINE ALSO NEEDS TO BE IN THE FILE to export getExploreFeed correctly if you replaced getAllProducts logic completely
