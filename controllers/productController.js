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
   🔥 GLOBAL CARD CONSTRUCTOR (BULLETPROOF VERSION WITH DEBUGGING) 🔥
   ========================================================================== */
const constructProductCards = async (rawProducts) => {
    if (!rawProducts || rawProducts.length === 0) return [];

    const productIds = rawProducts.map(p => p.id);
    const supplierIds = [...new Set(rawProducts.map(p => p.supplier_id).filter(Boolean))];
    
    const sIdsSafe = supplierIds.length > 0 ? supplierIds : [0];
    const pIdsSafe = productIds.length > 0 ? productIds : [0];

    try {
        const [suppliersRes, ratingsRes, viewsRes, discountRes] = await Promise.all([
            db.suppliers.query(`SELECT id, verified_status, city, brand_name FROM suppliers WHERE id IN (?)`, [sIdsSafe])
                .catch(e => { console.error('[DEBUG] Supplier query failed:', e.message); return [[]]; }),
            
            db.reviews.query(`SELECT product_id, avg_rating, review_count FROM product_ratings WHERE product_id IN (?)`, [pIdsSafe])
                .catch(e => { console.error('[DEBUG] Ratings query failed:', e.message); return [[]]; }),
            
            viewsClient ? viewsClient.execute({ 
                sql: `SELECT product_id, views FROM product_views WHERE product_id IN (${pIdsSafe.map(()=>'?').join(',')})`,
                args: pIdsSafe 
            }).catch(e => { console.error('[DEBUG] Views query failed:', e.message); return { rows: [] }; }) : Promise.resolve({ rows: [] }),

            db.inventory.query(`SELECT dp.product_id, d.name FROM discount_products dp JOIN discounts d ON dp.discount_id = d.id WHERE d.is_active = 1 AND dp.product_id IN (?)`, [pIdsSafe])
                .catch(e => { console.error('[DEBUG] Discounts query failed:', e.message); return [[]]; })
        ]);

        // =================================================================
        //  DEBUG LOG 1: CHECK THE RAW DATABASE RESULTS
        //  This will tell us if the database is returning any data at all.
        // =================================================================
        console.log('[DEBUG] Raw Ratings Result:', ratingsRes[0]);
        console.log('[DEBUG] Raw Views Result:', viewsRes.rows);

        const supplierMap = new Map(suppliersRes[0].map(s => [String(s.id), s]));
        const ratingMap = new Map(ratingsRes[0].map(r => [String(r.product_id), r]));
        const viewsMap = new Map(viewsRes.rows.map(v =>[String(v.product_id), v.views]));
        const discountNameMap = new Map(discountRes[0].map(d => [String(d.product_id), d.name]));

        return rawProducts.map(p => {
            let image_urls = [];
            try { image_urls = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : (p.image_urls || []); } 
            catch (e) { image_urls = p.image_url ? [p.image_url] : []; }

            const sData = supplierMap.get(String(p.supplier_id));
            const rData = ratingMap.get(String(p.id)) || { avg_rating: 0, review_count: 0 };
            const viewCount = viewsMap.get(String(p.id)) || 0;

            // =================================================================
            //  DEBUG LOG 2: CHECK IF THE LOOKUP IS WORKING FOR EACH PRODUCT
            // =================================================================
            if (rData.review_count > 0 || viewCount > 0) {
                console.log(`[DEBUG] Product ${p.id} has review data:`, rData, `and view count:`, viewCount);
            }

            const isVerified = sData && String(sData.verified_status).toLowerCase() === 'verified';
            const hasVideo = (p.video_url && p.video_url.length > 5) || image_urls.some(url => url && url.includes('.mp4'));

            return {
                id: p.id,
                title: p.title,
                slug: p.slug,
                price: parseFloat(p.price),
                discounted_price: parseFloat(p.discounted_price || p.price),
                discount_label: discountNameMap.get(String(p.id)) || null,
                image_urls: image_urls,
                video_url: p.video_url,
                has_video: hasVideo,
                created_at: p.created_at,
                supplier_id: p.supplier_id,
                supplier_verified: isVerified,
                supplier: { 
                    verified_status: isVerified ? 'verified' : 'unverified', 
                    city: sData ? sData.city : '',
                    brand_name: sData ? sData.brand_name : ''
                },
                avg_rating: parseFloat(rData.avg_rating || 0),
                review_count: parseInt(rData.review_count) || 0,
                views: parseInt(viewCount) || 0,
            };
        });

    } catch (e) {
        console.error("ConstructCard CRITICAL Error:", e);
        return rawProducts.map(p => parseProduct(p));
    }
};
// ... existing getExploreFeed code ...

/* ======================================================
   NEW: DEDICATED SEARCH RESULTS (Promoted First + Auto-Learning)
   ====================================================== */
exports.getSearchResults = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const offset = (page - 1) * limit;
        const { q } = req.query; // Search term

        if (!q) return res.json({ products:[], totalCount: 0 });

        // 1. Fetch Promoted IDs
        let promotedIds =[];
        try {
            const [pRows] = await db.inventory.query(
                "SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW()"
            );
            promotedIds = pRows.map(r => String(r.product_id));
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
            } catch (e) { return[]; }
        });

        const results = await Promise.all(promises);
        let allProducts = results.flat();

        // 4. 🔥 SORTING MAGIC: Promoted First 🔥
        const promotedSet = new Set(promotedIds);

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

        // ==========================================================
        // 🔥 THE MAGIC: AUTO-LEARN SUCCESSFUL SEARCHES 🔥
        // ==========================================================
        // Only save the keyword if:
        // 1. It is the first page of search (page === 1)
        // 2. We actually found products (totalCount > 0)
        // 3. The keyword is at least 3 letters long (to avoid junk words)
        if (page === 1 && totalCount > 0 && q.length >= 3) {
            const safeKeyword = q.trim().toLowerCase();
            
            // We use a try/catch inside so it NEVER crashes the user's search
            try {
                // If keyword doesn't exist, insert it with count 1. 
                // If it already exists, just increase the count by 1!
                await db.inventory.query(`
                    INSERT INTO search_keywords (keyword, search_count) 
                    VALUES (?, 1) 
                    ON DUPLICATE KEY UPDATE search_count = search_count + 1
                `, [safeKeyword]);
            } catch (learnError) {
                console.error("Auto-Learn Error:", learnError.message);
            }
        }
        // ==========================================================

        // 8. Send the results back to the user
        res.json({ products: finalWithFlag, totalCount });

    } catch (e) {
        console.error("Search Error:", e);
        res.status(500).json({ products:[], totalCount: 0 });
    }
};
/* ======================================================
   🔥 SUPER FAST TEXT SUGGESTIONS (Daraz Style) 🔥
   ====================================================== */
exports.getSearchSuggestionsText = async (req, res) => {
    try {
        const { q } = req.query;
        
        // If the user types less than 2 letters, don't search yet (saves server power)
        if(!q || q.length < 2) return res.json([]);

        // 1. Prepare the search term
        const searchTerm = `%${q.trim().toLowerCase()}%`;

        // 2. Search ONLY the new 'search_keywords' table in MySQL
        // We order by 'search_count' DESC so the most popular searches show at the top!
        const[rows] = await db.inventory.query(
            `SELECT id, keyword 
             FROM search_keywords 
             WHERE LOWER(keyword) LIKE ? 
             ORDER BY search_count DESC 
             LIMIT 8`, 
            [searchTerm]
        );

        // 3. Format the data EXACTLY how your Next.js frontend expects it
        const suggestions = rows.map(row => ({
            id: row.id,
            title: row.keyword,  // Frontend expects 'title'
            slug: row.keyword    // Frontend redirects using this
        }));

        // 4. Cache the result for 60 seconds for extreme speed
        res.set('Cache-Control', 'public, s-maxage=60'); 

        res.json(suggestions);
    } catch(e) { 
        console.error("Fast Suggestions Error:", e);
        res.json([]); 
    }
};
/* ======================================================
   🔥 UPDATED: EXPLORE FEED (Fixes 'More from Seller') 🔥
   ====================================================== */
exports.getExploreFeed = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 40;
        const offset = (page - 1) * limit;
        
        // Destructure all possible filters
        const { 
            sort = 'default', 
            hasVideo, 
            showVerified, 
            search, 
            category_id, 
            supplierId, // <--- ADDED THIS
            rating, 
            minPrice, 
            maxPrice, 
            city 
        } = req.query;

        let sql = `SELECT * FROM products WHERE status = 'in_stock'`;
        let countSql = `SELECT COUNT(*) as total FROM products WHERE status = 'in_stock'`;
        let args = [];

        // --- FILTER LOGIC ---
        if (search) { 
            const term = `%${search.trim().toLowerCase()}%`; 
            sql += ` AND LOWER(title) LIKE ?`; 
            countSql += ` AND LOWER(title) LIKE ?`; 
            args.push(term); 
        }

        // Fix for More From Seller
        if (supplierId) {
            sql += ` AND supplier_id = ?`;
            countSql += ` AND supplier_id = ?`;
            args.push(supplierId);
        }

        if (category_id && category_id.trim() !== '') {
            const selectedIds = category_id.split(',').map(id => id.trim()).filter(Boolean);
            const idsPlaceholder = selectedIds.map(() => '?').join(',');
            sql += ` AND category_id IN (${idsPlaceholder})`; 
            countSql += ` AND category_id IN (${idsPlaceholder})`; 
            args.push(...selectedIds);
        }

        if (minPrice) { 
            sql += ` AND (discounted_price >= ? OR price >= ?)`; 
            countSql += ` AND (discounted_price >= ? OR price >= ?)`; 
            args.push(minPrice, minPrice); 
        }
        if (maxPrice) { 
            sql += ` AND (discounted_price <= ? OR price <= ?)`; 
            countSql += ` AND (discounted_price <= ? OR price <= ?)`; 
            args.push(maxPrice, maxPrice); 
        }

        // --- EXECUTION ---
        const shouldCount = page === 1;
        const clientValues = Object.values(clients).filter(Boolean);
        
        const promises = clientValues.map(async (client) => {
            try {
                // Ensure we fetch enough to sort later
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

        // 🔥 Construct Cards (Adds Badges, Ratings, etc) 🔥
        let finalProducts = await constructProductCards(allProducts);

        // --- IN-MEMORY FILTERING ---
        if (hasVideo === 'true') finalProducts = finalProducts.filter(p => p.has_video);
        if (showVerified === 'true') finalProducts = finalProducts.filter(p => p.supplier_verified);
        if (rating) finalProducts = finalProducts.filter(p => Math.round(p.avg_rating) >= parseInt(rating));
        if (city && city !== 'All') finalProducts = finalProducts.filter(p => p.supplier_city?.toLowerCase() === city.toLowerCase());

        // --- SORTING ---
        if (sort === 'newest') finalProducts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        else if (sort === 'price_low_high') finalProducts.sort((a, b) => (a.discounted_price || a.price) - (b.discounted_price || b.price));
        else if (sort === 'price_high_low') finalProducts.sort((a, b) => (b.discounted_price || b.price) - (a.discounted_price || a.price));
        else { 
            // Default: Most reviewed, then most viewed
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


exports.getProductStats = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Get Views from Turso
        let views = 0;
        try {
            const vRes = await viewsClient.execute({ 
                sql: "SELECT views FROM product_views WHERE product_id = ?", 
                args: [id] 
            });
            if (vRes.rows.length > 0) views = vRes.rows[0].views;
        } catch (e) { console.error("Turso View Error", e); }

        // 2. Get Favorites Count from MySQL
        let favorites = 0;
        if (db.db_social) {
            const [rows] = await db.db_social.query(
                "SELECT COUNT(*) as total FROM product_favorites WHERE product_id = ?", 
                [id]
            );
            favorites = rows[0].total;
        }

        res.json({ views, favorites });
    } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).json({ views: 0, favorites: 0 });
    }
};

/* ======================================================
   2. HOMEPAGE DATA (Controller Update)
   ====================================================== */
exports.getHomepageData = async (req, res) => {
    try {
        const[bannersRes, catsRes] = await Promise.all([
            db.inventory.query("SELECT id, image_url, link_url FROM banners WHERE is_active = 1").catch(() => [[]]),
            db.inventory.query("SELECT id, name, image_url, slug, parent_id FROM categories ORDER BY name ASC").catch(() => [[]])
        ]);

        const[promotedRows, topReviewedRows, topViewedRes] = await Promise.all([
            db.inventory.query("SELECT product_id FROM promoted_products WHERE payment_status = 'paid' AND start_date <= NOW() AND end_date >= NOW() ORDER BY start_date DESC").catch(() => [[]]),
            db.reviews.query("SELECT product_id FROM product_ratings ORDER BY review_count DESC, avg_rating DESC LIMIT 50").catch(() =>[[]]),
            viewsClient ? viewsClient.execute("SELECT product_id FROM product_views ORDER BY views DESC LIMIT 50").catch(() => ({rows:[]})) : Promise.resolve({rows:[]})
        ]);

        const promotedIds =[...new Set(promotedRows[0].map(r => String(r.product_id)))].slice(0, 50);
        const popularIds = [...new Set([
            ...topReviewedRows[0].map(r => String(r.product_id)),
            ...topViewedRes.rows.map(r => String(r.product_id))
        ])].slice(0, 100);

        const[promotedProductsRaw, popularProductsRaw, ...shardLatestResults] = await Promise.all([
            getProductsFromTursoByIds(promotedIds),
            getProductsFromTursoByIds(popularIds),
            ...Object.values(clients).map(c => c.execute("SELECT * FROM products WHERE status = 'in_stock' ORDER BY created_at DESC LIMIT 20").catch(() => ({ rows: [] })))
        ]);

        const rawLatest = shardLatestResults.map(res => res.rows).flat();
        
        const[promotedTop50, popularMixedRaw, enrichedLatest] = await Promise.all([
            constructProductCards(promotedProductsRaw),
            constructProductCards(popularProductsRaw),
            constructProductCards(rawLatest)
        ]);
        
        // =================================================================
        //  DEBUG LOG 3: CHECK THE DATA JUST BEFORE SORTING
        // =================================================================
        console.log('[DEBUG] Data for Popular sorting:', JSON.stringify(popularMixedRaw.slice(0, 5), null, 2));


        const popularMixed = popularMixedRaw.sort((a, b) => {
            const reviewsA = a.review_count || 0;
            const reviewsB = b.review_count || 0;
            if (reviewsB !== reviewsA) return reviewsB - reviewsA;
            
            const viewsA = a.views || 0;
            const viewsB = b.views || 0;
            if (viewsB !== viewsA) return viewsB - viewsA;
            
            return new Date(b.created_at) - new Date(a.created_at);
        });

        const latestProducts = enrichedLatest
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50);

        const subCategoriesAll = catsRes[0].filter(cat => cat.parent_id);
        const subCatRow1 = subCategoriesAll.slice(0, 16);
        const subCatRow2 = subCategoriesAll.slice(16, 32);
        const subCatRow3 = subCategoriesAll.slice(32, 48);
        
        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
        
        res.json({ 
            banners: bannersRes[0] ||[], 
            subCatRow1, subCatRow2, subCatRow3, 
            promotedTop50, popularMixed, latestProducts 
        });

    } catch (error) {
        console.error("Homepage Error:", error);
        res.status(500).json({ 
            banners:[], subCatRow1: [], subCatRow2: [], subCatRow3:[], 
            promotedTop50: [], popularMixed: [], latestProducts:[] 
        });
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

/* ======================================================
   🔥 FULLY UPDATED: GET PRODUCT BY SLUG 🔥
   - Fixes View Count (Fetches from Turso Views Table)
   - Fixes Favorites Count (Counts rows in MySQL Social DB)
   - Handles "Smart Peel" for Slug matching
   ====================================================== */
exports.getProductBySlug = async (req, res) => {
    try {
        // 1. Validate Input
        let rawParam = req.params.slug || req.params.id;
        if (!rawParam || rawParam === 'undefined') {
            return res.status(400).json({ message: "Invalid Product Identifier" });
        }

        const decodedParam = decodeURIComponent(rawParam).trim();
        const shardKeys = Object.keys(clients);
        const lookupOps = [];

        // --- STEP 2: SMART PEEL STRATEGY (Find the Product) ---
        const candidates = new Set();
        candidates.add(decodedParam); 

        // Pattern: ends with "--123" (ID extraction)
        const idMatch = decodedParam.match(/--(\d+)$/);
        const extractedId = idMatch ? idMatch[1] : null;

        const parts = decodedParam.split('-');
        if (parts.length > 1) {
            candidates.add(parts.slice(0, -1).join('-')); 
            if (parts.length > 2) candidates.add(parts.slice(0, -2).join('-'));
        }

        // Search all shards in parallel
        shardKeys.forEach(key => {
            const client = clients[key];
            
            // A. ID Match
            if (extractedId) {
                lookupOps.push(client.execute({ sql: "SELECT * FROM products WHERE id = ? LIMIT 1", args: [extractedId] }).then(r => r.rows.length ? { p: r.rows[0], key } : null).catch(() => null));
            }
            // B. Slug Match
            candidates.forEach(slugCandidate => {
                lookupOps.push(client.execute({ sql: "SELECT * FROM products WHERE slug = ? LIMIT 1", args: [slugCandidate] }).then(r => r.rows.length ? { p: r.rows[0], key } : null).catch(() => null));
            });
            // C. SKU Match (Last part)
            const potentialSku = parts[parts.length - 1]; 
            if (potentialSku) {
                lookupOps.push(client.execute({ sql: "SELECT * FROM products WHERE sku = ? LIMIT 1", args: [potentialSku] }).then(r => r.rows.length ? { p: r.rows[0], key } : null).catch(() => null));
            }
        });

        const results = await Promise.all(lookupOps);
        
        // Priority: ID > Slug > SKU
        let match = null;
        if (extractedId) match = results.find(r => r && String(r.p.id) === String(extractedId));
        if (!match) {
            const validMatches = results.filter(r => r);
            match = validMatches.find(r => candidates.has(r.p.slug)) || validMatches[0];
        }

        if (!match) {
            return res.status(404).json({ message: "Product not found" });
        }

        const product = match.p;

        // --- STEP 3: PARALLEL DATA FETCHING (Views, Favs, Reviews, etc) ---
        
        // A. Prepare View Count Promise (Turso)
        const viewCountPromise = viewsClient ? viewsClient.execute({
            sql: "SELECT views FROM product_views WHERE product_id = ?",
            args: [product.id]
        }).catch(e => ({ rows: [] })) : Promise.resolve({ rows: [] });

        // B. Prepare Favorites Count Promise (MySQL)
        const favCountPromise = db.db_social ? db.db_social.query(
            "SELECT COUNT(*) as total FROM product_favorites WHERE product_id = ?",
            [product.id]
        ).catch(e => [[{ total: 0 }]]) : Promise.resolve([[{ total: 0 }]]);

        // C. Fetch Everything
        const [
            [sup],           // Supplier Info
            [rev],           // Reviews
            rel,             // Related Products
            varRes,          // Variants
            viewRes,         // Views Result
            [favRes],        // Favorites Result
            [promotedRes]    // Check if Promoted
        ] = await Promise.all([
            db.suppliers.query("SELECT id, brand_name as name, profile_pic, average_rating, followers_count, verified_status, total_products, city FROM suppliers WHERE id = ?", [product.supplier_id]),
            db.reviews.query("SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 5", [product.id]),
            clients[match.key].execute({ sql: "SELECT * FROM products WHERE category_id = ? AND id != ? LIMIT 8", args: [product.category_id, product.id] }),
            clients[match.key].execute({ sql: "SELECT * FROM variants WHERE product_id = ?", args: [product.id] }),
            viewCountPromise,
            favCountPromise,
            db.inventory.query("SELECT id FROM promoted_products WHERE product_id = ? AND payment_status='paid' AND end_date > NOW()", [product.id]).catch(()=>[[]])
        ]);

        // --- STEP 4: DATA PROCESSING ---

        // Images
        let image_urls = [];
        try { image_urls = typeof product.image_urls === 'string' ? JSON.parse(product.image_urls) : product.image_urls; } catch (e) {}

        // Supplier
        const sData = sup[0] || {};
        const isVerified = ['verified', 'true', '1'].includes(String(sData.verified_status).toLowerCase());

        // Counts
        const realViews = viewRes.rows.length > 0 ? viewRes.rows[0].views : 0;
        const realFavorites = favRes[0]?.total || 0;

        // Enrich Related Products (Add badges/ratings to slider)
        const relatedEnriched = await constructProductCards(rel.rows);

        // Check Promoted
        const isPromoted = promotedRes.length > 0;

        // --- STEP 5: FINAL RESPONSE ---
        res.json({ 
            ...product, 
            image_urls,
            price: parseFloat(product.price),
            discounted_price: parseFloat(product.discounted_price || product.price),
            
            // Supplier Data
            supplier_verified: isVerified,
            supplier: { 
                ...sData, 
                verified_status: isVerified ? 'verified' : 'unverified',
                is_verified: isVerified
            }, 
            
            // Reviews & Ratings
            reviews: rev, 
            avg_rating: rev.length > 0 ? (rev.reduce((a, b) => a + parseFloat(b.rating), 0) / rev.length) : 0,
            
            // Related Items
            related_products: relatedEnriched,
            variants: varRes.rows || [],
            
            // 🔥 CRITICAL STATS 🔥
            views: realViews,          // Fetched from Turso
            favorites: realFavorites,  // Fetched from MySQL
            is_promoted: isPromoted,   // Fetched from MySQL
            
            // Helper for initial stats on frontend
            stats: {
                views: realViews,
                favorites: realFavorites
            }
        });

    } catch (e) { 
        console.error("GetProduct Critical Error:", e);
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
                    SELECT id, title, slug, price, discounted_price, 
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





/* ======================================================
   🔥 ULTIMATE SITEMAP GENERATOR (Images + Video) 🔥
   ====================================================== */
exports.getSitemapUrls = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const offset = (page - 1) * limit;

    // 🔥 CHANGED: Added title, description, and video_url
    // We limit description to 200 chars to keep the sitemap file size small
    const sql = `
      SELECT title, slug, sku, created_at as lastmod, image_urls, video_url, LEFT(description, 200) as short_desc
      FROM products
    `;

    const clientValues = Object.values(clients).filter(Boolean);

    // 1. Fetch
    const promises = clientValues.map(client =>
      client.execute({ sql })
        .then(r => r.rows || [])
        .catch(() => [])
    );

    const results = await Promise.all(promises);
    const allProducts = results.flat();

    // 2. Sort
    allProducts.sort((a, b) => {
        if (a.id && b.id) return a.id - b.id; 
        return 0; 
    });

    // 3. Paginate
    const paginatedProducts = allProducts.slice(offset, offset + limit);

    res.json({
      products: paginatedProducts,
      totalCount: allProducts.length
    });

  } catch (e) {
    console.error("Sitemap Error:", e);
    res.status(500).json({ products: [], totalCount: 0 });
  }
};
// Add this new function anywhere in productController.js

/* ======================================================
   🔥 LIGHTWEIGHT COUNT ENDPOINT 🔥
   ====================================================== */
exports.getSitemapCount = async (req, res) => {
    try {
        const countSql = `SELECT COUNT(id) as total FROM products`;
        const clientValues = Object.values(clients).filter(Boolean);
        
        const promises = clientValues.map(client =>
            client.execute(countSql).then(r => r.rows[0]?.total || 0).catch(() => 0)
        );
        
        const results = await Promise.all(promises);
        const totalCount = results.reduce((sum, count) => sum + count, 0);

        // Set a short cache, as this is hit frequently by Google
        res.set('Cache-Control', 'public, s-maxage=3600'); // Cache for 1 hour
        res.json({ total: totalCount });

    } catch (e) {
        console.error("Sitemap Count Error:", e);
        res.status(500).json({ total: 0 });
    }
};

/* ======================================================
   🔥 ENTERPRISE GOOGLE SHOPPING FEED (Images + Variants) 🔥
   ====================================================== */
exports.getGoogleShoppingProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 1000;
        const offset = (page - 1) * limit;

        // 1. Fetch products + variants
        const sql = `
            SELECT p.id, p.title, p.slug, p.sku, p.description, p.price, 
                   p.discounted_price, p.image_urls, p.image_url as thumbnail, p.brand
            FROM products p
            WHERE p.status = 'in_stock'
        `;

        const clientValues = Object.values(clients).filter(Boolean);
        const promises = clientValues.map(client => 
            client.execute({ sql }).then(r => r.rows || []).catch(() => [])
        );
        const results = await Promise.all(promises);
        let allProducts = results.flat();
        
        // Paginate after flat
        const paginatedProducts = allProducts.slice(offset, offset + limit);

        // 2. Fetch variants for these specific products to map them
        const pIds = paginatedProducts.map(p => p.id);
        const variantPromises = clientValues.map(client => 
            client.execute({ sql: `SELECT * FROM variants WHERE product_id IN (${pIds.map(()=>'?').join(',')})`, args: pIds })
            .then(r => r.rows || [])
            .catch(() => [])
        );
        const varResults = await Promise.all(variantPromises);
        const allVariants = varResults.flat();

        // 3. Construct Data
        const finalProducts = paginatedProducts.map(p => {
            // A. Handle Images (Multiple)
            let imageList = [];
            try {
                const parsed = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls;
                imageList = Array.isArray(parsed) ? parsed : [p.thumbnail].filter(Boolean);
            } catch(e) { imageList = [p.thumbnail].filter(Boolean); }

            // B. Handle Variants
            const productVariants = allVariants.filter(v => v.product_id === p.id);

            return {
                id: p.sku || `SJ10-${p.id}`,
                title: p.title,
                description: p.description,
                link: p.slug,
                // Google takes up to 10 images. We provide the array.
                image_links: imageList, 
                price: parseFloat(p.price),
                sale_price: parseFloat(p.discounted_price || p.price),
                // 🔥 BRAND FIX: Use product brand if exists, else "SJ10"
                brand: (p.brand && p.brand.trim() !== "") ? p.brand : "SJ10",
                variants: productVariants
            };
        });

        res.json({ products: finalProducts, totalCount: allProducts.length });
    } catch (e) {
        res.status(500).json({ products: [] });
    }
};
/* ======================================================
   🔥 GOOGLE SHOPPING MASTER FEED (1 LINK FOR EVERYTHING) 🔥
   ====================================================== */
exports.getGoogleShoppingMasterFeed = async (req, res) => {
  try {
    const BASE_URL = "https://www.sj10.pk";
    
    // Fetch ALL in-stock products
    const sql = `
      SELECT id, title, slug, sku, description, price, discounted_price, image_urls 
      FROM products 
      WHERE status = 'in_stock'
    `;

    const clientValues = Object.values(clients).filter(Boolean);
    const promises = clientValues.map(client => client.execute({ sql }).then(r => r.rows ||[]).catch(() =>[]));
    const results = await Promise.all(promises);
    const allProducts = results.flat();

    // Helper to clean XML characters
    const escapeXml = (str) => {
        if (!str) return "";
        return String(str).replace(/[<>&'"]/g, (c) => {
            switch (c) {
                case '<': return '&lt;'; case '>': return '&gt;';
                case '&': return '&amp;'; case '\'': return '&apos;';
                case '"': return '&quot;'; default: return c;
            }
        });
    };

    // Build the XML Header
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>SJ10.pk Master Product Feed</title>
<link>${BASE_URL}</link>
<description>Best Online Shopping in Pakistan</description>`;

    // Loop through ALL products
    allProducts.forEach(p => {
        const slug = p.sku ? `${p.slug}-${p.sku}` : p.slug;
        const fullLink = `${BASE_URL}/products/${encodeURIComponent(slug)}`;

        // Extract Image
        let imageUrl = "";
        try {
            if (p.image_urls) {
                if (typeof p.image_urls === 'string') {
                    imageUrl = p.image_urls.startsWith('[') ? JSON.parse(p.image_urls)[0] : p.image_urls;
                } else if (Array.isArray(p.image_urls)) {
                    imageUrl = p.image_urls[0];
                }
            }
        } catch(e) {}

        const price = parseFloat(p.price);
        const salePrice = parseFloat(p.discounted_price || p.price);

        xml += `
<item>
  <g:id>${escapeXml(p.sku || p.id)}</g:id>
  <g:title>${escapeXml(p.title)}</g:title>
  <g:description>${escapeXml(p.description ? p.description.substring(0, 2000) : p.title)}</g:description>
  <g:link>${fullLink}</g:link>
  <g:image_link>${escapeXml(imageUrl)}</g:image_link>
  <g:condition>new</g:condition>
  <g:availability>in stock</g:availability>
  <g:price>${price} PKR</g:price>
  ${salePrice < price ? `<g:sale_price>${salePrice} PKR</g:sale_price>` : ''}
  <g:brand>SJ10</g:brand>
  <g:identifier_exists>no</g:identifier_exists>
</item>`;
    });

    xml += `
</channel>
</rss>`;

    // Send as an XML File
    res.set('Content-Type', 'application/xml');
    // Cache for 2 hours to prevent database overload
    res.set('Cache-Control', 'public, s-maxage=7200, stale-while-revalidate=3600');
    res.send(xml);

  } catch (e) {
    console.error("Master Feed Error:", e);
    res.status(500).send("Error generating feed");
  }
};