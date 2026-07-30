require('dotenv').config();
const db = require('../config/database');
const redis = require('../config/redis'); 

const meiliPkg = require('meilisearch');
const MeiliSearch = meiliPkg.Meilisearch || meiliPkg.MeiliSearch || meiliPkg.default || meiliPkg;



const meiliClient = new MeiliSearch({
    host: 'http://129.159.225.126:7700',
    apiKey: 'Sj10MeiliSuperKey2026'
});
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

const getProductsFromOracleByIds = async (ids) => {
    if (!ids || ids.length === 0) return [];
    try {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const res = await db.oracle.query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
        return res.rows;
    } catch (error) {
        console.error("Oracle Fetch Error:", error.message);
        return [];
    }
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
const constructProductCards = async (rawProducts) => {
    if (!rawProducts || rawProducts.length === 0) return [];

    const productIds = rawProducts.map(p => p.id);
    const supplierIds = [...new Set(rawProducts.map(p => p.supplier_id).filter(Boolean))];
    
    const sIdsSafe = supplierIds.length > 0 ? supplierIds : ['0'];
    const pIdsSafe = productIds.length > 0 ? productIds : ['0'];

    try {
        // 1. Redis se saara current view buffer aik hi dafa uthao (For Speed)
        const viewBuffer = await redis.hGetAll('product_views_buffer') || {};

        // 2. TiDB MySQL Queries
        const [suppliersRes, ratingsRes, discountRes] = await Promise.all([
            db.suppliers.query(`SELECT id, verified_status, city, brand_name FROM suppliers WHERE id IN (?)`, [sIdsSafe]).catch(() => [[ ]]),
            db.reviews.query(`SELECT product_id, avg_rating, review_count FROM product_ratings WHERE product_id IN (?)`, [pIdsSafe]).catch(() => [[ ]]),
            db.inventory.query(`SELECT dp.product_id, d.name FROM discount_products dp JOIN discounts d ON dp.discount_id = d.id WHERE d.is_active = 1 AND dp.product_id IN (?)`, [pIdsSafe]).catch(() => [[ ]])
        ]);

        const supplierMap = new Map((suppliersRes[0] || []).map(s => [String(s.id), s]));
        const ratingMap = new Map((ratingsRes[0] || []).map(r => [String(r.product_id), r]));
        const discountNameMap = new Map((discountRes[0] || []).map(d => [String(d.product_id), d.name]));

        return rawProducts.map(p => {
            let image_urls = [];
            try { image_urls = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : (p.image_urls || []); } 
            catch (e) { image_urls = p.image_url ? [p.image_url] : []; }

            const sData = supplierMap.get(String(p.supplier_id));
            const rData = ratingMap.get(String(p.id)) || { avg_rating: 0, review_count: 0 };
            
            // 🚨 Real-time Views calculation (Oracle DB + Redis Buffer)
            const dbViews = parseInt(p.views || 0);
            const bufferViews = parseInt(viewBuffer[String(p.id)] || 0);

            const isVerified = sData && String(sData.verified_status).toLowerCase() === 'verified';
            const hasVideo = (p.video_url && p.video_url.length > 5) || (typeof p.image_urls === 'string' && p.image_urls.includes('.mp4'));

            return {
                id: p.id,
                title: p.title,
                slug: p.slug,
                sku: p.sku || 'N/A',
                price: parseFloat(p.price || 0),
                discounted_price: parseFloat(p.discounted_price || p.price || 0),
                discount_label: discountNameMap.get(String(p.id)) || null,
                image_urls: image_urls,
                video_url: p.video_url || null,
                has_video: hasVideo,
                supplier_verified: isVerified,
                supplier: { 
                    verified_status: isVerified ? 'verified' : 'unverified', 
                    city: sData ? sData.city : '',
                    brand_name: sData ? sData.brand_name : 'SJ10 Official'
                },
                avg_rating: parseFloat(rData.avg_rating || 0),
                review_count: parseInt(rData.review_count) || 0,
                views: dbViews + bufferViews, // <--- Dono ko plus kar diya
            };
        });
    } catch (e) {
        console.error("🔴 ConstructCard Error:", e.message);
        return rawProducts.map(parseProduct);
    }
};
/* ======================================================
   🔥 SMART SEARCH RESULTS (MEILISEARCH + ORACLE POSTGRES FALLBACK)
   Features: Millisecond Search, Typo-Tolerance, Bulletproof DB Fallback
   ====================================================== */
exports.getSearchResults = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const offset = (page - 1) * limit;
        const { q } = req.query;

        if (!q) return res.json({ products: [], totalCount: 0 });

        console.log(`🔍 [SEARCH] Query received: "${q}"`);

        // Promoted IDs from MySQL (TiDB)
        const [pRows] = await db.inventory.query(
            "SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW()"
        );
        const promotedIds = new Set(pRows.map(r => String(r.product_id)));

        let productIds = [];
        let totalCount = 0;

        try {
            // 🚨 STRATEGY A: Query Meilisearch (Typo-Tolerant, Instant)
            console.log("🏎️ [MEILISEARCH] Querying Meilisearch Engine...");
            const index = meiliClient.index('products');
            const searchRes = await index.search(q, {
                limit: limit,
                offset: offset,
                attributesToRetrieve: ['id'] // We only need IDs, full data comes from Postgres
            });

            productIds = searchRes.hits.map(hit => hit.id);
            totalCount = searchRes.estimatedTotalHits;
            console.log(`✅ [MEILISEARCH] Found ${productIds.length} matches.`);

        } catch (meiliError) {
            // 🚨 STRATEGY B: PostgreSQL Fallback (If Meilisearch is offline)
            console.warn("⚠️ [MEILISEARCH] Offline! Falling back to Postgres ILIKE query...");
            const searchPattern = `%${q.trim().toLowerCase()}%`;
            const sql = `
                SELECT id FROM products 
                WHERE status = 'in_stock' AND (title ILIKE $1 OR sku ILIKE $1)
                ORDER BY created_at DESC LIMIT $2 OFFSET $3
            `;
            const countSql = "SELECT COUNT(*) FROM products WHERE status = 'in_stock' AND (title ILIKE $1 OR sku ILIKE $1)";
            
            const [dbRes, dbCount] = await Promise.all([
                db.oracle.query(sql, [searchPattern, limit, offset]),
                db.oracle.query(countSql, [searchPattern])
            ]);

            productIds = dbRes.rows.map(r => r.id);
            totalCount = parseInt(dbCount.rows[0].count);
        }

        if (productIds.length === 0) {
            return res.json({ products: [], totalCount: 0 });
        }

        // Fetch full product details from Oracle Postgres using IDs
        const rawProducts = await getProductsFromOracleByIds(productIds);
        const enrichedProducts = await constructProductCards(rawProducts);

        // Mark Promoted Flag
        const finalWithFlag = enrichedProducts.map(p => ({
            ...p,
            is_promoted: promotedIds.has(String(p.id))
        }));

        res.json({ products: finalWithFlag, totalCount });

    } catch (e) {
        console.error("🔴 Search API Master Error:", e.message);
        res.status(500).json({ products: [], totalCount: 0 });
    }
};
/* ======================================================
   🔥 FAST TEXT SUGGESTIONS (TiDB MySQL)
   Fetches from global search history
   ====================================================== */
exports.getSearchSuggestionsText = async (req, res) => {
    try {
        const { q } = req.query;
        if(!q || q.length < 2) return res.json([]);

        console.log(`🟡 [TiDB MySQL] Fetching Text Suggestions for: "${q}"`);

        const searchTerm = `%${q.trim().toLowerCase()}%`;

        // Search the global keywords table in TiDB
        const [rows] = await db.inventory.query(
            `SELECT id, keyword 
             FROM search_keywords 
             WHERE LOWER(keyword) LIKE ? 
             ORDER BY search_count DESC 
             LIMIT 8`, 
            [searchTerm]
        );

        const suggestions = rows.map(row => ({
            id: row.id,
            title: row.keyword,
            slug: row.keyword
        }));

        // Edge Caching for speed
        res.set('Cache-Control', 'public, s-maxage=60'); 
        res.json(suggestions);
        
    } catch(e) { 
        console.error("🔴 TiDB Suggestions Error:", e.message);
        res.json([]); 
    }
};
/* ======================================================
   🔥 EXPLORE FEED (ORACLE DB)
   ====================================================== */
exports.getExploreFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const offset = (page - 1) * limit;
        
        const { sort = 'default', search, category_id, supplierId, minPrice, maxPrice } = req.query;

        console.log(`🟢 [ORACLE DB] Fetching Explore Feed -> Page: ${page}`);

        let sql = `SELECT * FROM products WHERE status = 'in_stock'`;
        let countSql = `SELECT COUNT(*) as total FROM products WHERE status = 'in_stock'`;
        let args = [];
        let paramIndex = 1; // Postgres uses $1, $2, $3

        // --- FILTER LOGIC ---
        if (search) { 
            const term = `%${search.trim().toLowerCase()}%`; 
            sql += ` AND LOWER(title) ILIKE $${paramIndex}`; 
            countSql += ` AND LOWER(title) ILIKE $${paramIndex}`; 
            args.push(term); 
            paramIndex++;
        }

        if (supplierId) {
            sql += ` AND supplier_id = $${paramIndex}`;
            countSql += ` AND supplier_id = $${paramIndex}`;
            args.push(supplierId);
            paramIndex++;
        }

        if (category_id && category_id.trim() !== '') {
            const selectedIds = category_id.split(',').map(id => id.trim()).filter(Boolean);
            if (selectedIds.length > 0) {
                const placeholders = selectedIds.map((_, i) => `$${paramIndex + i}`).join(',');
                sql += ` AND category_id IN (${placeholders})`; 
                countSql += ` AND category_id IN (${placeholders})`; 
                args.push(...selectedIds);
                paramIndex += selectedIds.length;
            }
        }

        // --- SORTING ---
        if (sort === 'newest') sql += ` ORDER BY created_at DESC`;
        else if (sort === 'price_low_high') sql += ` ORDER BY price ASC`;
        else if (sort === 'price_high_low') sql += ` ORDER BY price DESC`;
        else sql += ` ORDER BY created_at DESC`;

        sql += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const queryArgs = [...args, limit, offset];

        // --- ORACLE EXECUTION ---
        const [pRes, cRes] = await Promise.all([
            db.oracle.query(sql, queryArgs),
            page === 1 ? db.oracle.query(countSql, args) : Promise.resolve({rows: [{total: 0}]})
        ]);

        let finalProducts = await constructProductCards(pRes.rows);

        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000');

        return res.status(200).json({
            products: finalProducts,
            totalCount: page === 1 ? parseInt(cRes.rows[0].total) : undefined
        });

    } catch (e) {
        console.error("🔴 Oracle Explore Error:", e.message);
        res.status(200).json({ products: [], totalCount: 0 });
    }
};

exports.getProductStats = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.json({ views: 0, favorites: 0 });

        // Oracle DB views + Redis Buffer
        const vRes = await db.oracle.query("SELECT views FROM products WHERE id = $1", [id]);
        const dbViews = vRes.rows.length > 0 ? parseInt(vRes.rows[0].views || 0) : 0;
        const bufferViews = parseInt(await redis.hGet('product_views_buffer', String(id)) || 0);

        let favorites = 0;
        if (db.db_social) {
            const [rows] = await db.db_social.query("SELECT COUNT(*) as total FROM product_favorites WHERE product_id = ?", [id]);
            favorites = rows[0].total;
        }

        res.json({ 
            views: dbViews + bufferViews, 
            favorites: favorites 
        });
    } catch (error) {
        res.status(500).json({ views: 0, favorites: 0 });
    }
};

/* ======================================================
   📦 HOMEPAGE MASTER BUNDLE (ORACLE + TiDB + REDIS)
   ====================================================== */
exports.getHomepageData = async (req, res) => {
    // 🔥 Cache Key 'v7' kar di hai taake purana kharab cache clear ho jaye
    const cacheKey = "homepage_master_cache_v7"; 
    
    try {
        // ==========================================
        // 🛡️ 1. REDIS CACHE CHECK (SUPER FAST & SAFE)
        // ==========================================
        if (redis && typeof redis.get === 'function') {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    console.log("⚡ [REDIS] Homepage data served instantly from Cache");
                    return res.json(JSON.parse(cached));
                }
            } catch (redisErr) {
                console.warn("⚠️ [REDIS WARNING] Could not read from Redis, moving to DB.");
            }
        }

        console.log("🟢 [DB FETCH] Cache Miss! Fetching Homepage Bundle from Databases...");

        // ==========================================
        // 🛡️ 2. FETCH FROM TiDB / MYSQL (100% CRASH PROOF)
        // Agar db connect na ho tab bhi Promise.resolve se empty array bhej dega
        // ==========================================
        const [bannersRes, catsRes, promotedRows, topReviewedRows, topFavoritedRows] = await Promise.all([
            db.inventory ? db.inventory.query("SELECT id, image_url, link_url FROM banners WHERE is_active = 1").catch(() => [[ ]]) : Promise.resolve([[ ]]),
            db.inventory ? db.inventory.query("SELECT id, name, image_url, slug, parent_id FROM categories ORDER BY name ASC").catch(() => [[ ]]) : Promise.resolve([[ ]]),
            db.inventory ? db.inventory.query("SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW() ORDER BY start_date DESC LIMIT 50").catch(() => [[ ]]) : Promise.resolve([[ ]]),
            db.reviews ? db.reviews.query("SELECT product_id FROM product_ratings ORDER BY review_count DESC LIMIT 50").catch(() => [[ ]]) : Promise.resolve([[ ]]),
            db.db_social ? db.db_social.query("SELECT product_id, COUNT(*) as f_count FROM product_favorites GROUP BY product_id ORDER BY f_count DESC LIMIT 50").catch(()=>[[ ]]) : Promise.resolve([[ ]])
        ]);

        // ==========================================
        // 🛡️ 3. ORACLE POSTGRES QUERIES
        // ==========================================
        let topViewedRes = { rows: [] };
        if (db.oracle) {
            try { 
                topViewedRes = await db.oracle.query("SELECT id FROM products WHERE status = 'in_stock' ORDER BY views DESC LIMIT 50"); 
            } catch(e) {
                console.warn("⚠️ Oracle views fetch failed:", e.message);
            }
        }

        // --- 🎯 SMART ID MERGING FOR POPULAR PRODUCTS ---
        const promotedIds = [...new Set((promotedRows[0] || []).map(r => String(r.product_id)))];
        const viralIdsPool = [
            ...(topReviewedRows[0] || []).map(r => String(r.product_id)),
            ...(topFavoritedRows[0] || []).map(r => String(r.product_id)),
            ...(topViewedRes.rows || []).map(r => String(r.id))
        ];
        // Sirf top 60 unique viral IDs utha rahay hain
        const finalViralIds = [...new Set(viralIdsPool)].slice(0, 60);

        // ==========================================
        // 🛡️ 4. FETCH FULL DETAILS FROM ORACLE
        // ==========================================
        let promotedRaw = [], viralRaw = [], latestRaw = { rows: [] };
        if (db.oracle) {
            try {
                [promotedRaw, viralRaw, latestRaw] = await Promise.all([
                    getProductsFromOracleByIds(promotedIds).catch(() => []),
                    getProductsFromOracleByIds(finalViralIds).catch(() => []),
                    db.oracle.query("SELECT * FROM products WHERE status = 'in_stock' ORDER BY created_at DESC LIMIT 50").catch(() => ({ rows: [] }))
                ]);
            } catch(e) {
                console.warn("⚠️ Oracle Product Detail Fetch failed:", e.message);
            }
        }

        // ==========================================
        // 🛡️ 5. ENRICH PRODUCTS (Attach badges, suppliers, etc)
        // ==========================================
        const [promotedTop50, viralEnriched, latestProducts] = await Promise.all([
            constructProductCards(promotedRaw || []),
            constructProductCards(viralRaw || []),
            constructProductCards(latestRaw.rows || [])
        ]);

        // --- 🔥 POPULAR SORTING LOGIC (Safely handled) ---
        const popularProducts = (viralEnriched || []).sort((a, b) => {
            if (b.review_count !== a.review_count) return (b.review_count || 0) - (a.review_count || 0);
            return (b.views || 0) - (a.views || 0); 
        }).slice(0, 50);

        const subCategoriesAll = (catsRes[0] || []).filter(cat => cat.parent_id);

        // ==========================================
        // 🛡️ 6. FINAL RESPONSE BUNDLE
        // ==========================================
        const response = {
            banners: bannersRes[0] || [],
            subCatRow1: subCategoriesAll || [],
            promotedTop50: promotedTop50 || [],
            popularProducts: popularProducts || [], 
            latestProducts: latestProducts || []
        };

        // ==========================================
        // 🛡️ 7. SAVE TO REDIS CACHE FOR 10 MINUTES
        // ==========================================
        if (redis && typeof redis.setEx === 'function') {
            try {
                await redis.setEx(cacheKey, 600, JSON.stringify(response));
                console.log(`✅ [REDIS] Homepage Bundle Cached successfully.`);
            } catch (redisSetErr) {
                console.warn("⚠️ [REDIS WARNING] Failed to save cache.");
            }
        }

        console.log(`✅ [DB SUCCESS] Homepage Bundle Sent to Frontend. Promoted: ${promotedTop50.length}, Popular: ${popularProducts.length}`);
        return res.json(response);

    } catch (error) {
        console.error("🔴 CRITICAL Oracle Homepage Master Error:", error);
        // Fallback: Agar kisi wajah se poora block gir jaye, toh API frontend ko blank data bhej degi crash ki bajaye
        return res.json({ banners: [], subCatRow1: [], promotedTop50: [], popularProducts: [], latestProducts: [] });
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
       try {
        // ... (your existing DB code) ...
        
        // 🔥 5-DAY CACHE for Category Structure
         res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400');
        
        res.status(200).json({ mainCats: parents });
    } catch (error) { 
        res.status(500).json({ mainCats: [] }); 
    }
};

/* ======================================================
   🔥 SEARCH SUGGESTIONS (ORACLE DB)
   ====================================================== */
exports.getSearchSuggestions = async (req, res) => {
    try {
        const { q } = req.query;
        if(!q || q.length < 2) return res.json([]);

        console.log(`🟢 [ORACLE DB] Fetching Search Suggestions for: ${q}`);

        const searchTerm = `%${q.trim()}%`;
        
        // Postgres ILIKE is case-insensitive by default
        // SELECT DISTINCT ensures we don't show the same title twice
        const result = await db.oracle.query(
            "SELECT DISTINCT title FROM products WHERE title ILIKE $1 LIMIT 6",
            [searchTerm]
        );

        const suggestions = result.rows.map(p => p.title);
        res.json(suggestions);

    } catch(e) {
        console.error("🔴 Oracle Suggestions Error:", e.message);
        res.json([]); 
    }
};
// ======================================================
// 🔥 SMART GET PRODUCT BY SLUG (100% NEXT.JS PAGE.TSX COMPATIBLE)
// ======================================================
exports.getProductBySlug = async (req, res) => {
    try {
        const rawParam = req.params.slug || '';
        const decodedParam = decodeURIComponent(rawParam).trim();
        if (!decodedParam || decodedParam === 'undefined') {
            return res.status(400).json({ message: "Invalid slug" });
        }

        const productCacheKey = `product_${decodedParam}`;
        const CACHE_HEADER = 'public, max-age=3600';

        // 1. ⚡ CHECK REDIS PERMANENT CACHE FIRST
        const cachedProduct = await redis.get(productCacheKey);
        if (cachedProduct) {
            console.log(`⚡ [REDIS HIT] Serving Product "${decodedParam}" from Cache`);
            
            // Background View Increment
            await redis.hIncrBy('product_views_buffer', JSON.parse(cachedProduct).id, 1);
            
            res.setHeader('Cache-Control', CACHE_HEADER);
            return res.json(JSON.parse(cachedProduct));
        }

        console.log(`🟢 [ORACLE DB] Cache Miss! Fetching Product "${decodedParam}" from Postgres...`);

        // 2. Fetch Product from Oracle Postgres (Server 1)
        let result = await db.oracle.query(
            "SELECT id, supplier_id, category_id, title, description, price, discounted_price, quantity, status, sku, slug, image_url, image_urls, video_url, package_information, colors, sizes, season FROM products WHERE id = $1 OR slug = $1 LIMIT 1", 
            [decodedParam]
        );

        // Smart SKU Peeling Fallback
        if (result.rows.length === 0 && decodedParam.includes('-')) {
            const parts = decodedParam.split('-');
            const lastPart = parts[parts.length - 1];
            const secondLastPart = parts[parts.length - 2];
            const fullSku = `${secondLastPart}-${lastPart}`;
            const peeledSlug = parts.slice(0, parts.length - 2).join('-');

            result = await db.oracle.query(
                "SELECT id, supplier_id, category_id, title, description, price, discounted_price, quantity, status, sku, slug, image_url, image_urls, video_url, package_information, colors, sizes, season FROM products WHERE sku = $1 OR sku = $2 OR slug = $3 OR id = $2 LIMIT 1", 
                [fullSku, lastPart, peeledSlug]
            );
        }

        if (result.rows.length === 0) return res.status(404).json({ message: "Not found" });

        const product = result.rows[0];

        // 3. Calculate Views atomic count
        const dbViews = parseInt(product.views || 0);
        const bufferViews = parseInt(await redis.hGet('product_views_buffer', String(product.id)) || 0);
        const totalViews = dbViews + bufferViews;

        // 4. ⚡ PARALLEL DATA FETCHING
        const [varRes, supRes, revRes, relRes, catRes, promotedRes, favCountRes] = await Promise.all([
            db.oracle.query("SELECT id, custom_color as color, custom_size as size, price, stock, image_url as image FROM variants WHERE product_id = $1", [product.id]), 
            db.suppliers.query("SELECT id, brand_name, profile_pic, verified_status, supplier_code, average_rating, followers_count, total_products, city FROM suppliers WHERE LOWER(TRIM(id)) = LOWER(TRIM(?)) LIMIT 1", [String(product.supplier_id || '').trim()]),
            db.reviews.query("SELECT id, user_name, rating, comment, created_at FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 10", [product.id]),
            db.oracle.query("SELECT id, title, slug, sku, price, discounted_price, image_url, image_urls, video_url, supplier_id FROM products WHERE category_id = $1 AND id != $2 AND status='in_stock' LIMIT 8", [product.category_id || '0', product.id]),
            db.inventory.query("SELECT c1.name as sub_name, c1.slug as sub_slug, c2.name as parent_name, c2.slug as parent_slug FROM categories c1 LEFT JOIN categories c2 ON c1.parent_id = c2.id WHERE c1.id = ?", [product.category_id || '0']),
            db.inventory.query("SELECT id FROM promoted_products WHERE product_id = ? AND payment_status='paid' AND end_date > NOW() LIMIT 1", [product.id]),
            db.social ? db.social.query("SELECT COUNT(*) as total FROM product_favorites WHERE product_id = ?", [product.id]) : Promise.resolve([[{total: 0}]])
        ]);

        let relatedRaw = relRes.rows || [];
        if (relatedRaw.length === 0) {
            const fallbackRes = await db.oracle.query(
                "SELECT id, title, slug, sku, price, discounted_price, image_url, image_urls, video_url, supplier_id FROM products WHERE id != $1 AND status='in_stock' ORDER BY created_at DESC LIMIT 8",
                [product.id]
            );
            relatedRaw = fallbackRes.rows || [];
        }

        const parsed = parseProduct(product);
        const relatedEnriched = await constructProductCards(relatedRaw);

        const supplierInfo = supRes[0][0] || null;
        const brandName = supplierInfo ? supplierInfo.brand_name : 'SJ10 Official';

        delete parsed.image_urls; 
        delete parsed.views;

        const response = {
            id: parsed.id,
            
            // 🚨 THE CRITICAL FIX FOR NEXT.JS PAGE.TSX 🚨
            supplier_id: product.supplier_id, // <--- REQUIRED for getSellerProducts!
            category_id: product.category_id, // <--- REQUIRED for getRelatedProducts!
            
            title: parsed.title,
            slug: parsed.slug,
            sku: parsed.sku,
            description: parsed.description,
            price: parseFloat(parsed.price || 0),
            discounted_price: parseFloat(parsed.discounted_price || parsed.price || 0),
            image_url: parsed.image_url,
            image_urls: parsed.image_urls_parsed || [parsed.image_url], 
            package_information: parsed.package_information || "",
            colors: parsed.colors ? String(parsed.colors).replace(/[\[\]"]/g, '').split(',') : ["Standard"],
            sizes: parsed.sizes ? String(parsed.sizes).replace(/[\[\]"]/g, '').split(',') : ["Standard"],
            season: parsed.season || "All Season",
            views: totalViews,
            stats: {
                views: totalViews,
                favorites: parseInt(favCountRes[0][0]?.total || 0)
            },
            brand_name: brandName, 
            supplier: supplierInfo ? {
                id: supplierInfo.id,
                name: brandName, 
                brand_name: brandName,
                profile_pic: supplierInfo.profile_pic,
                verified_status: supplierInfo.verified_status,
                supplier_code: supplierInfo.supplier_code,
                average_rating: parseFloat(supplierInfo.average_rating || 0),
                followers_count: parseInt(supplierInfo.followers_count || 0),
                total_products: parseInt(supplierInfo.total_products || 0),
                city: supplierInfo.city
            } : null,
            variants: varRes.rows || [], 
            reviews: revRes[0] || [], 
            
            related_products: relatedEnriched, 
            relatedProducts: relatedEnriched,  
            seller_products: relatedEnriched,  
            sellerProducts: relatedEnriched,   
            
            category_info: {
                name: catRes[0][0]?.sub_name || "Collection",
                slug: catRes[0][0]?.sub_slug || "all",
                parent_name: catRes[0][0]?.parent_name || null,
                parent_slug: catRes[0][0]?.parent_slug || null
            },
            is_promoted: promotedRes[0]?.length > 0
        };

        // 5. 💾 SAVE TO REDIS PERMANENTLY
        await redis.setEx(productCacheKey, 86400, JSON.stringify(response));

        // Background Views Increment
        await redis.hIncrBy('product_views_buffer', String(product.id), 1);

        res.setHeader('Cache-Control', CACHE_HEADER);
        res.json(response);

    } catch (e) {
        console.error("🔴 Detail Error:", e.message);
        res.status(500).json({ message: "Server Error" });
    }
};
/* ======================================================
   3. CATEGORY ROWS (UPDATED: Selecting the SKU column)
   ====================================================== */
/* ======================================================
   🔥 CATEGORY ROWS (ORACLE DB)
   ====================================================== */
/* ======================================================
   🔥 CATEGORY ROWS (VIRAL SORTING + ORACLE DB)
   Priority: Reviews > Favorites > Views
   ====================================================== */
exports.getCategoryRows = async (req, res) => {
    // 🔥 YEH LOG SAB SE OOPAR HAI
    console.log("📡 [REQUEST] Frontend calling: getCategoryRows");

    try {
        console.log("🟢 [ORACLE DB] Fetching Viral Category Rows from Oracle...");
        const [allCats] = await db.inventory.query("SELECT id, name, slug, parent_id FROM categories ORDER BY name ASC");

        const parents = allCats.filter(c => !c.parent_id);
        const children = allCats.filter(c => c.parent_id); 

        const childMap = new Map();
        children.forEach(c => {
            if (!childMap.has(c.parent_id)) childMap.set(c.parent_id, []);
            childMap.get(c.parent_id).push(c.id);
        });

        const promises = parents.map(async p => {
            const subIds = childMap.get(p.id) || [];
            const ids = [p.id, ...subIds];

            if (ids.length === 0) return null;

            try {
                // Postgres placeholders
                const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
                
                // Fetch 30 products to sort them by "Viral" metrics
                const sql = `
                    SELECT * FROM products 
                    WHERE category_id IN (${placeholders}) 
                    AND status='in_stock' 
                    LIMIT 30
                `;
                
                // 🚨 ORACLE SE DATA LAA RAHAY HAIN
                const res = await db.oracle.query(sql, ids);
                
                if(res.rows.length > 0) {
                    let enriched = await constructProductCards(res.rows);
                    
                    // Add Favorites Count for sorting
                    let favMap = new Map();
                    if (db.db_social) {
                        try {
                            const pIds = enriched.map(ep => String(ep.id));
                            const [fCounts] = await db.db_social.query("SELECT product_id, COUNT(*) as c FROM product_favorites WHERE product_id IN (?) GROUP BY product_id", [pIds.length ? pIds : ['0']]);
                            fCounts.forEach(f => favMap.set(String(f.product_id), f.c));
                        } catch(e) {}
                    }
                    
                    enriched.forEach(ep => ep.favorites = favMap.get(String(ep.id)) || 0);

                    // 🔥 VIRAL SORTING ALGORITHM 🔥
                    enriched.sort((a, b) => {
                        if (b.review_count !== a.review_count) return b.review_count - a.review_count; // P1: Reviews
                        if (b.favorites !== a.favorites) return b.favorites - a.favorites; // P2: Favorites
                        return b.views - a.views; // P3: Views
                    });

                    // Top 10 viral products nikal lo
                    return { category_id: p.id, category_name: p.name, category_slug: p.slug, products: enriched.slice(0, 10) };
                }
            } catch(e) {
                console.error(`🔴 Oracle Category Row Error (Cat ID: ${p.id}):`, e.message);
            }
            return null;
        });

        const rows = (await Promise.all(promises)).filter(r => r);

        res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600');
        res.json(rows);

    } catch (e) { 
        console.error("🔴 CategoryRows Master Error:", e.message);
        res.json([]); 
    }
};
/* ======================================================
   🔥 CATEGORY PRODUCTS FEED (100% ORACLE DB)
   ====================================================== */
exports.getProductsByCategorySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const offset = (page - 1) * limit;
        
        const { sort = 'default', search, maxPrice, hasVideo, showVerified } = req.query;

        console.log(`🟢 [ORACLE DB] Fetching Products for Category: ${slug}`);

        // 1. Get Category Info from TiDB (MySQL)
        const [catRows] = await db.inventory.query("SELECT id, name, slug FROM categories WHERE slug = ?", [slug]);
        if (catRows.length === 0) return res.status(404).json({ message: "Category not found" });
        const category = catRows[0];

        // 2. Get All Subcategory IDs (taake parent category mein children ka data bhi aaye)
        const [children] = await db.inventory.query("SELECT id FROM categories WHERE parent_id = ?", [category.id]);
        const allCategoryIds = [category.id, ...children.map(c => c.id)];

        // 3. Build Oracle (Postgres) Query
        let sql = `SELECT * FROM products WHERE status = 'in_stock'`;
        let countSql = `SELECT COUNT(*) as total FROM products WHERE status = 'in_stock'`;
        let args = [];
        let pIndex = 1; // Postgres uses $1, $2...

        // --- A. Category Filter ---
        const placeholders = allCategoryIds.map((_, i) => `$${pIndex + i}`).join(',');
        sql += ` AND category_id IN (${placeholders})`;
        countSql += ` AND category_id IN (${placeholders})`;
        args.push(...allCategoryIds);
        pIndex += allCategoryIds.length;

        // --- B. Search Filter (ILIKE for case-insensitive) ---
        if (search) {
            sql += ` AND (title ILIKE $${pIndex} OR description ILIKE $${pIndex})`;
            countSql += ` AND (title ILIKE $${pIndex} OR description ILIKE $${pIndex})`;
            args.push(`%${search.trim()}%`);
            pIndex++;
        }

        // --- C. Price Filter ---
        if (maxPrice) {
            sql += ` AND price <= $${pIndex}`;
            countSql += ` AND price <= $${pIndex}`;
            args.push(parseFloat(maxPrice));
            pIndex++;
        }

        // --- D. Video Filter ---
        if (hasVideo === 'true') {
            const videoClause = ` AND (video_url IS NOT NULL AND video_url != '' OR image_urls LIKE '%.mp4%')`;
            sql += videoClause;
            countSql += videoClause;
        }

        // --- E. Sorting ---
        if (sort === 'price_high') sql += ` ORDER BY price DESC`;
        else if (sort === 'price_low') sql += ` ORDER BY price ASC`;
        else sql += ` ORDER BY created_at DESC`;

        // --- F. Pagination ---
        sql += ` LIMIT $${pIndex} OFFSET $${pIndex + 1}`;
        const finalArgs = [...args, limit, offset];

        // 4. Parallel Execution in Oracle
        const [pRes, cRes] = await Promise.all([
            db.oracle.query(sql, finalArgs),
            db.oracle.query(countSql, args)
        ]);

        // 5. Enrich with Supplier Data & Badges
        let enrichedProducts = await constructProductCards(pRes.rows);
        
        // --- G. Verified Supplier Filter (In-Memory) ---
        if (showVerified === 'true') {
            enrichedProducts = enrichedProducts.filter(p => p.supplier_verified === true);
        }

        res.set('Cache-Control', 'public, max-age=3600');
        res.json({ 
            category, 
            products: enrichedProducts, 
            total: parseInt(cRes.rows[0].total), 
            totalPages: Math.ceil(parseInt(cRes.rows[0].total) / limit), 
            currentPage: page 
        });

    } catch (e) { 
        console.error("🔴 Oracle Category Fetch Error:", e.message);
        res.status(500).json({message: "Server Error"}); 
    }
};
exports.incrementProductView = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || id === 'undefined') return res.json({ status: "ignored" });

        // 🔥 Redis Increment
        const newCount = await redis.hIncrBy('product_views_buffer', String(id), 1);
        
        // terminal mein log dikhane ke liye
        console.log(`📈 [VIEW] Product ID: ${id.substring(0,8)}... | New Buffer Count: ${newCount}`);

        res.json({ status: "ok" });
    } catch(e) {
        console.error("🔴 Redis View Error:", e.message);
        res.json({ status: "error" });
    }
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

/* ======================================================
   🔥 GET PRODUCT BY ID (ORACLE DB)
   ====================================================== */
exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🟢 [ORACLE DB] Fetching Product by ID: ${id}`);

        // 1. Fetch Product from Oracle
        const result = await db.oracle.query("SELECT * FROM products WHERE id = $1 LIMIT 1", [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Product not found in Oracle" });
        }

        const product = result.rows[0];

        // 2. Fetch Variants from Oracle
        let variants = [];
        try {
            const variantRes = await db.oracle.query("SELECT * FROM variants WHERE product_id = $1", [product.id]);
            variants = variantRes.rows;
        } catch (e) {
            console.error("🔴 Oracle Variants Error:", e.message);
        }

        const finalProduct = parseProduct(product);
        finalProduct.variants = variants; 
        
        res.json(finalProduct);

    } catch (error) {
        console.error("🔴 Oracle Get Product By ID Error:", error.message);
        res.status(500).json({ message: "Server Error" });
    }
};

// --- THIS LINE ALSO NEEDS TO BE IN THE FILE to export getExploreFeed correctly if you replaced getAllProducts logic completely




/* ======================================================
   🔥 ULTIMATE SITEMAP GENERATOR (ORACLE + REDIS)
   Cache Timing: 24 Hours (86400s)
   ====================================================== */
exports.getSitemapUrls = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const offset = (page - 1) * limit;
        const cacheKey = `sitemap_urls_v2_p${page}_l${limit}`;

        // 1. Check Redis Super Cache
        const cached = await redis.get(cacheKey);
        if (cached) {
            console.log(`⚡ [REDIS] Serving Sitemap Page ${page} from Cache`);
            return res.json(JSON.parse(cached));
        }

        console.log(`🟢 [ORACLE DB] Cache Miss! Generating Sitemap Page ${page}...`);

        // 2. Fetch from Oracle Postgres (Single Query, No Shards)
        const sql = `
            SELECT title, slug, sku, created_at as lastmod, image_urls, video_url, LEFT(description, 200) as short_desc 
            FROM products 
            ORDER BY id ASC 
            LIMIT $1 OFFSET $2
        `;
        
        // Parallel queries: Data + Total Count
        const [dataRes, countRes] = await Promise.all([
            db.oracle.query(sql, [limit, offset]),
            db.oracle.query("SELECT COUNT(*) as total FROM products")
        ]);

        const response = {
            products: dataRes.rows,
            totalCount: parseInt(countRes.rows[0].total)
        };

        // 3. Save to Redis for 24 Hours
        await redis.setEx(cacheKey, 86400, JSON.stringify(response));

        res.json(response);

    } catch (e) {
        console.error("🔴 Oracle Sitemap Error:", e.message);
        res.status(500).json({ products: [], totalCount: 0 });
    }
};

/* ======================================================
   🔥 LIGHTWEIGHT COUNT ENDPOINT (ORACLE + REDIS)
   ====================================================== */
exports.getSitemapCount = async (req, res) => {
    const cacheKey = "sitemap_total_count_v2";
    try {
        // 1. Check Redis
        const cachedCount = await redis.get(cacheKey);
        if (cachedCount) {
            console.log("⚡ [REDIS] Serving Sitemap Count from Cache");
            return res.json({ total: parseInt(cachedCount) });
        }

        console.log("🟢 [ORACLE DB] Cache Miss! Fetching Total Product Count...");

        // 2. Query Oracle (Direct Count)
        const result = await db.oracle.query("SELECT COUNT(id) as total FROM products");
        const totalCount = parseInt(result.rows[0].total || 0);

        // 3. Save to Redis for 24 Hours
        await redis.setEx(cacheKey, 86400, String(totalCount));

        // Browser Cache Header (1 Hour)
        res.set('Cache-Control', 'public, s-maxage=3600'); 
        res.json({ total: totalCount });

    } catch (e) {
        console.error("🔴 Sitemap Count Oracle Error:", e.message);
        res.status(500).json({ total: 0 });
    }
};
exports.getGoogleShoppingProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const offset = (page - 1) * limit;
        const cacheKey = `google_json_feed_pg_${page}`;

        // 1. Check Redis Super Cache
        const cachedData = await redis.get(cacheKey);
        if (cachedData) {
            console.log(`⚡ [REDIS] Serving Google JSON Feed Page ${page} from Cache`);
            return res.json(JSON.parse(cachedData));
        }

        console.log(`🟢 [ORACLE DB] Cache Miss! Generating Google JSON Feed Page ${page}...`);

        // 2. Fetch from Oracle
        const sql = `SELECT id, title, slug, sku, description, price, discounted_price, image_urls, image_url as thumbnail, brand
                     FROM products WHERE status = 'in_stock' ORDER BY id ASC LIMIT $1 OFFSET $2`;
        const pRes = await db.oracle.query(sql, [limit, offset]);
        const products = pRes.rows;

        if (products.length === 0) return res.json({ products: [], totalCount: 0 });

        const pIds = products.map(p => p.id);
        const vRes = await db.oracle.query(`SELECT * FROM variants WHERE product_id IN (${pIds.map((_, i) => `$${i + 1}`).join(',')})`, pIds);
        const allVariants = vRes.rows;

        const finalProducts = products.map(p => {
            let imageList = [];
            try {
                const parsed = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls;
                imageList = Array.isArray(parsed) ? parsed : [p.thumbnail || p.image_url].filter(Boolean);
            } catch(e) { imageList = [p.thumbnail || p.image_url].filter(Boolean); }

            return {
                id: p.sku || `SJ10-${p.id}`,
                title: p.title,
                description: p.description,
                link: `https://www.sj10.pk/products/${p.slug}${p.sku ? '-' + p.sku : ''}`,
                image_links: imageList, 
                price: parseFloat(p.price || 0),
                sale_price: parseFloat(p.discounted_price || p.price || 0),
                brand: (p.brand && p.brand.trim() !== "") ? p.brand : "SJ10",
                variants: allVariants.filter(v => v.product_id === p.id)
            };
        });

        const countRes = await db.oracle.query("SELECT COUNT(*) FROM products WHERE status = 'in_stock'");
        const response = { products: finalProducts, totalCount: parseInt(countRes.rows[0].count) };

        // 3. Save to Redis for 2 Hours
        await redis.setEx(cacheKey, 7200, JSON.stringify(response));

        res.json(response);
    } catch (e) {
        console.error("🔴 JSON Feed Error:", e.message);
        res.status(500).json({ products: [] });
    }
};
exports.getGoogleShoppingMasterFeed = async (req, res) => {
  const cacheKey = "google_shopping_xml_master";
  try {
    // 1. Check Redis First
    const cachedXml = await redis.get(cacheKey);
    if (cachedXml) {
        console.log("⚡ [REDIS] Serving Master XML Feed from Super Cache");
        res.set('Content-Type', 'application/xml');
        return res.send(cachedXml);
    }

    console.log("🟢 [ORACLE DB] Cache Miss! Generating Massive Master XML Feed...");

    const BASE_URL = "https://www.sj10.pk";
    const result = await db.oracle.query("SELECT id, title, slug, sku, description, price, discounted_price, image_urls, image_url FROM products WHERE status = 'in_stock'");
    const allProducts = result.rows;

    const escapeXml = (str) => String(str || "").replace(/[<>&'"]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c] || c));

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>SJ10.pk Master Product Feed</title>\n<link>${BASE_URL}</link>\n<description>Best Online Shopping in Pakistan</description>`;

    allProducts.forEach(p => {
        const fullLink = `${BASE_URL}/products/${p.slug}${p.sku ? '-' + p.sku : ''}`;
        let imageUrl = p.image_url || "";
        try {
            if (p.image_urls) {
                const arr = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls;
                if(Array.isArray(arr) && arr.length > 0) imageUrl = arr[0];
            }
        } catch(e) {}

        xml += `\n<item>\n  <g:id>${escapeXml(p.sku || p.id)}</g:id>\n  <g:title>${escapeXml(p.title)}</g:title>\n  <g:description>${escapeXml(p.description ? p.description.substring(0, 2000) : p.title)}</g:description>\n  <g:link>${escapeXml(fullLink)}</g:link>\n  <g:image_link>${escapeXml(imageUrl)}</g:image_link>\n  <g:availability>in stock</g:availability>\n  <g:price>${parseFloat(p.price)} PKR</g:price>\n  ${parseFloat(p.discounted_price) < parseFloat(p.price) ? `<g:sale_price>${parseFloat(p.discounted_price)} PKR</g:sale_price>` : ''}\n  <g:brand>SJ10</g:brand>\n</item>`;
    });

    xml += `\n</channel>\n</rss>`;

    // 2. Save entire XML string to Redis for 4 Hours
    await redis.setEx(cacheKey, 14400, xml);

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (e) {
    console.error("🔴 XML Feed Error:", e.message);
    res.status(500).send("Error generating feed");
  }
};
/* ======================================================
   🚀 REAL-TIME LATEST PRODUCTS (NO-CACHE)
   Fetches the 40 most recent entries across all shards
   ====================================================== */
/* ======================================================
   🚀 REAL-TIME LATEST PRODUCTS (ORACLE DB)
   ====================================================== */
exports.getLatestProductsRealTime = async (req, res) => {
    try {
        // 🔥 YEH LOG TERMINAL MEIN AAYEGA TOU MATLAB ORACLE CHAL RAHA HAI
        console.log("🟢 [ORACLE DB] Fetching Latest Real-Time Products...");

        // Seedha Oracle se 40 latest products uthao (No Turso Shards!)
        const sql = `
            SELECT id, title, slug, sku, price, discounted_price, 
                   image_urls, video_url, supplier_id, created_at 
            FROM products 
            WHERE status = 'in_stock'
            ORDER BY created_at DESC 
            LIMIT 40
        `;
        
        const result = await db.oracle.query(sql);

        // Enrich with Supplier Badges and Ratings
        const finalProducts = await constructProductCards(result.rows || []);

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.status(200).json(finalProducts);

    } catch (error) {
        console.error("🔴 Latest Products Oracle Error:", error.message);
        res.status(500).json({ message: "Failed to fetch fresh products from Oracle" });
    }
};


/**
 * 🔥 LIGHTWEIGHT PRODUCT CARDS API (100% ORACLE DB)
 * Optimized for: Extreme speed, Low Bandwidth, and Oracle Postgres
 */
exports.getProductCards = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40; 
        const offset = (page - 1) * limit;

        console.log(`🟢 [ORACLE DB] Fetching Lite Product Cards -> Page: ${page}`);

        // 1. Fetch from Oracle (No Shards needed!)
        const sql = `
            SELECT id, title, slug, sku, price, discounted_price, 
                   image_url, image_urls, video_url, supplier_id 
            FROM products 
            WHERE status = 'in_stock'
            ORDER BY created_at DESC 
            LIMIT $1 OFFSET $2
        `;
        const args = [limit, offset];

        const result = await db.oracle.query(sql, args);
        const rawProducts = result.rows;

        if (rawProducts.length === 0) {
            return res.json({ products: [], hasMore: false });
        }

        // 2. Prepare for Cross-DB Enrichment (TiDB MySQL)
        const productIds = rawProducts.map(p => p.id);
        const supplierIds = [...new Set(rawProducts.map(p => p.supplier_id).filter(Boolean))];
        
        let supplierMap = new Map();
        let ratingsMap = new Map();

        // 3. Parallel Enrichment from TiDB
        const enrichmentPromises = [];

        if (supplierIds.length > 0) {
            enrichmentPromises.push(
                db.suppliers.query("SELECT id, verified_status, brand_name FROM suppliers WHERE id IN (?)", [supplierIds])
                .then(([rows]) => rows.forEach(s => {
                    supplierMap.set(String(s.id), {
                        isVerified: String(s.verified_status).toLowerCase() === 'verified',
                        brand: s.brand_name
                    });
                }))
            );
        }

        if (productIds.length > 0) {
            enrichmentPromises.push(
                db.reviews.query("SELECT product_id, avg_rating, review_count FROM product_ratings WHERE product_id IN (?)", [productIds])
                .then(([rows]) => rows.forEach(r => {
                    ratingsMap.set(String(r.product_id), {
                        rating: parseFloat(r.avg_rating),
                        count: parseInt(r.review_count)
                    });
                }))
            );
        }

        await Promise.all(enrichmentPromises).catch(e => console.error("Enrichment Error:", e.message));

        // 4. Format to Ultra-Lite Shorthand Object
        const optimizedProducts = rawProducts.map(p => {
            const sInfo = supplierMap.get(String(p.supplier_id)) || { isVerified: false, brand: 'SJ10 Official' };
            const rInfo = ratingsMap.get(String(p.id)) || { rating: 0, count: 0 };

            // Image and Video logic
            let finalImg = p.image_url;
            try {
                const parsedImgs = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls;
                if (Array.isArray(parsedImgs) && parsedImgs.length > 0) finalImg = parsedImgs[0];
            } catch(e) {}

            const hasVideo = (p.video_url && p.video_url.length > 5) || (typeof p.image_urls === 'string' && p.image_urls.includes('.mp4'));

            return {
                id: p.id,
                t: p.title,               // title
                s: p.slug,                // slug
                sku: p.sku || 'N/A',      // sku
                p: parseFloat(p.price),   // price
                dp: parseFloat(p.discounted_price || p.price), // discounted price
                img: finalImg,            // image
                v: sInfo.isVerified,      // verified
                b: sInfo.brand,           // brand
                r: rInfo.rating,          // rating
                rc: rInfo.count,          // review count
                hv: hasVideo              // has video
            };
        });

        // 🔥 Edge Caching Headers
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000');

        res.json({
            products: optimizedProducts,
            page,
            hasMore: rawProducts.length === limit
        });

    } catch (error) {
        console.error("🔴 Oracle Lite Cards Error:", error.message);
        res.status(500).json({ message: "Error fetching cards" });
    }
};

// 1. Dedicated Banners API (12 Hours)
exports.getBanners = async (req, res) => {
    try {
        const [banners] = await db.inventory.query("SELECT id, image_url, link_url FROM banners WHERE is_active = 1");
        // 12 Hour Cache (43,200 seconds)
        res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600');
        res.json(banners);
    } catch (e) { res.json([]); }
};

/* ======================================================
   🔥 SMART POPULAR PRODUCTS API (VIRAL LOGIC + ORACLE DB)
   Priority: Reviews (Proxy for Sales) > Favorites > Views
   Features: Zero Turso Hits, Highly Scalable, Postgres Optimized
   ====================================================== */
exports.getPopularProducts = async (req, res) => {
    try {
        console.log("🟢 [ORACLE DB] Fetching VIRAL & POPULAR Products...");

        // 1. Get IDs of the most reviewed products from TiDB MySQL (Proxy for High Sales)
        const [reviewedRows] = await db.reviews.query("SELECT product_id FROM product_ratings ORDER BY review_count DESC LIMIT 45");
        const revIds = reviewedRows.map(r => String(r.product_id));

        // 2. Get IDs of the most favorited products from TiDB MySQL (Social DB)
        let favIds = [];
        if (db.social) {
            try {
                const [favRows] = await db.social.query("SELECT product_id, COUNT(*) as fav_count FROM product_favorites GROUP BY product_id ORDER BY fav_count DESC LIMIT 45");
                favIds = favRows.map(r => String(r.product_id));
            } catch(e) { console.error("Social DB Query Warning:", e.message); }
        }

        // 3. 🚨 CORE FIX: Get IDs of most viewed products from Oracle Postgres (Bypasses viewsClient)
        let viewIds = [];
        try {
            const viewedRes = await db.oracle.query("SELECT id FROM products WHERE status = 'in_stock' ORDER BY views DESC LIMIT 45");
            viewIds = viewedRes.rows.map(v => String(v.id));
        } catch(e) { console.error("Oracle Views Query Warning:", e.message); }

        // Combine all unique IDs
        let popularIds = [...new Set([...revIds, ...favIds, ...viewIds])].slice(0, 60);

        if (popularIds.length === 0) {
            // Fallback to latest products if no stats exist
            const fallback = await db.oracle.query("SELECT id FROM products WHERE status = 'in_stock' ORDER BY created_at DESC LIMIT 40");
            popularIds = fallback.rows.map(r => String(r.id));
        }

        // 4. Fetch Products directly from Oracle PostgreSQL (Server 1)
        const rawProducts = await getProductsFromOracleByIds(popularIds);
        
        // Enrich Products using our optimized cards constructor
        let enriched = await constructProductCards(rawProducts);

        // Fetch exact favorites counts for these products from TiDB (Social DB)
        let favMap = new Map();
        if (db.social && popularIds.length > 0) {
            try {
                const [fCounts] = await db.social.query("SELECT product_id, COUNT(*) as c FROM product_favorites WHERE product_id IN (?) GROUP BY product_id", [popularIds]);
                fCounts.forEach(f => favMap.set(String(f.product_id), f.c));
            } catch(e){}
        }

        // Apply Favorites counts to products for sorting
        enriched.forEach(p => p.favorites = favMap.get(String(p.id)) || 0);

        // 5. 🔥 THE ULTIMATE POPULARITY SORTING ALGORITHM 🔥
        enriched.sort((a, b) => {
            // Priority 1: Reviews Count (Best proxy for high sales)
            if (b.review_count !== a.review_count) return b.review_count - a.review_count;
            // Priority 2: Favorites Count (Highly desired)
            if (b.favorites !== a.favorites) return b.favorites - a.favorites;
            // Priority 3: Views (Most Viral)
            return b.views - a.views;
        });

        // Slice to return top 40 highly popular and sold products
        const finalProducts = enriched.slice(0, 40);

        res.setHeader('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=600');
        res.json(finalProducts);

    } catch (error) {
        console.error("🔴 Oracle Popular Algorithm Error:", error.message);
        res.status(200).json([]); 
    }
};
exports.getActiveStripBanners = async (req, res) => {
    try {
        const [rows] = await db.inventory.query(
            "SELECT video_url, redirect_link, device_type FROM strip_banners WHERE is_active = 1"
        );

        // 🔥 10-Day Edge Caching (864,000 seconds)
        // This ensures Cloudflare serves the response instantly to the App and Web
        res.setHeader('Cache-Control', 'public, s-maxage=864000, stale-while-revalidate=3600');
        
        res.status(200).json(rows);
    } catch (error) {
        console.error("Strip Banner Error:", error);
        res.status(500).json({ message: "Error fetching banners" });
    }
};

// Background Worker: Redis to Oracle
const syncViewsToOracle = async () => {
    try {
        const data = await redis.hGetAll('product_views_buffer');
        const ids = Object.keys(data);

        if (ids.length === 0) return;

        console.log(`\n☁️  [ORACLE SYNC] Moving ${ids.length} views from Redis to Database...`);

        for (const id of ids) {
            const count = parseInt(data[id]);
            if (count > 0) {
                // Oracle Query
                await db.oracle.query(
                    "UPDATE products SET views = COALESCE(views, 0) + $1 WHERE id = $2",
                    [count, id]
                );
            }
        }

        await redis.del('product_views_buffer');
        console.log("✅ [ORACLE SYNC] Success. Database is now updated.\n");

    } catch (error) {
        console.error("🔴 [ORACLE SYNC] Error:", error.message);
    }
};

// 🕒 Timer: 5 minute = 300,000 milliseconds
// Isay file ke end par check karein aur update kar dein:
setInterval(syncViewsToOracle, 5 * 60 * 1000);
