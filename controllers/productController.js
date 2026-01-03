const { clients } = require('../config/tursoConnection');
const { queryAllShards } = require('../utils/shardHelper');
const db = require('../config/database'); 

// --- HELPER: Parse Product ---
const parseProduct = (p, discountNameMap = null) => {
    if (!p) return null;
    try { p.image_urls = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls; } catch(e) { p.image_urls = p.image_url ? [p.image_url] : []; }
    try { p.attributes = typeof p.attributes === 'string' ? JSON.parse(p.attributes) : {}; } catch(e) { p.attributes = {}; }
    p.price = parseFloat(p.price);
    p.discounted_price = parseFloat(p.discounted_price || p.price);
    if (discountNameMap && discountNameMap.has(p.id)) {
        p.discounts = [{ name: discountNameMap.get(p.id) }];
    } else {
        p.discounts = [];
    }
    return p;
};

/* ======================================================
   1. HOMEPAGE DATA 
   ====================================================== */
exports.getHomepageData = async (req, res) => {
    try {
        console.log("🚀 Building Homepage...");

        // PARALLEL FETCH
        const promotedPromise = db.inventory.query("SELECT product_id FROM promoted_products WHERE payment_status IN ('paid', 'approved', 'active') AND end_date > NOW()");
        const bannerPromise = db.inventory.query("SELECT id, image_url, link_url FROM banners WHERE is_active = 1");
        const catPromise = db.inventory.query("SELECT id, name, image_url, slug, parent_id FROM categories ORDER BY name ASC");
        const discountPromise = db.inventory.query(`SELECT dp.product_id, d.name FROM discount_products dp JOIN discounts d ON dp.discount_id = d.id WHERE d.is_active = 1`);
        const sqlRecent = "SELECT * FROM products WHERE status = 'in_stock' ORDER BY created_at DESC LIMIT 5";
        const shardPromises = Object.values(clients).map(c => c.execute(sqlRecent));

        const [[promotedRows], [banners], [allCats], [discountRows], ...shardResults] = await Promise.all([
            promotedPromise, bannerPromise, catPromise, discountPromise, ...shardPromises
        ]);

        // PREPARE MAPS
        const promotedIds = new Set(promotedRows.map(p => p.product_id));
        const discountNameMap = new Map();
        if(discountRows) discountRows.forEach(row => discountNameMap.set(row.product_id, row.name));

        // PROCESS PRODUCTS
        let allProducts = [];
        shardResults.forEach(res => { if(res.rows) allProducts.push(...res.rows); });

        allProducts = allProducts.map(p => parseProduct(p, discountNameMap));
        allProducts.sort((a, b) => {
            const isAPromoted = promotedIds.has(a.id);
            const isBPromoted = promotedIds.has(b.id);
            if (isAPromoted && !isBPromoted) return -1; 
            if (!isAPromoted && isBPromoted) return 1;  
            return new Date(b.created_at) - new Date(a.created_at);
        });

        const finalProducts = allProducts.slice(0, 60).map(p => ({
            ...p,
            isPromoted: promotedIds.has(p.id)
        }));

        // PROCESS CATEGORIES
        const categoryMap = new Map();
        const mainCategories = [];   
        const childCategories = [];  

        allCats.forEach(cat => {
            cat.subcategories = []; 
            categoryMap.set(cat.id, cat);
            if (cat.parent_id) childCategories.push(cat); 
            else mainCategories.push(cat);
        });

        childCategories.forEach(child => {
            if (categoryMap.has(child.parent_id)) categoryMap.get(child.parent_id).subcategories.push(child);
        });

        const circularIcons = childCategories.slice(0, 16); 

        const responsePayload = {
            banners: banners,
            subcategories: circularIcons, 
            categories: mainCategories,   
            products: finalProducts        
        };

        // ⚡ SET CLOUDFLARE CACHE (10 Minutes) ⚡
        res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=30');
        res.status(200).json(responsePayload);

    } catch (error) {
        console.error("Homepage Error:", error);
        res.status(500).json({ banners: [], subcategories: [], categories: [], products: [] });
    }
};

/* ======================================================
   2. EXPLORE / SEARCH
   ====================================================== */
exports.getAllProducts = async (req, res) => {
    try {
        const { search, category, supplierId, limit = 40 } = req.query;
        let results = [];
        
        // This array will hold any connection errors we find
        const debugErrors = [];

        // CASE A: CATEGORY FILTER
        if (category) {
            const [catRows] = await db.inventory.query("SELECT db_shard FROM categories WHERE id = ?", [category]);
            if (catRows.length > 0) {
                const shardKey = catRows[0].db_shard || 'shard_general';
                const client = clients[shardKey] || clients.shard_general;
                try {
                    const res = await client.execute({
                        sql: `SELECT * FROM products WHERE category_id = ? AND status = 'in_stock' ORDER BY created_at DESC LIMIT ?`,
                        args: [category, parseInt(limit)]
                    });
                    results = res.rows;
                } catch (e) {
                    debugErrors.push({ shard: shardKey, error: e.message });
                }
            }
        }
        
        // CASE B: SUPPLIER
        else if (supplierId) {
            // We use the helper, but wrap in try/catch in case it fails silently
            try {
                results = await queryAllShards(
                    `SELECT * FROM products WHERE supplier_id = ? AND status = 'in_stock' ORDER BY created_at DESC LIMIT ${parseInt(limit)}`, 
                    [supplierId]
                );
            } catch (e) {
                console.error("Supplier Query Error:", e);
            }
        }
        
        // CASE C: SEARCH
        else if (search) {
             try {
                results = await queryAllShards(
                    `SELECT * FROM products WHERE title LIKE ? AND status = 'in_stock' LIMIT 15`, 
                    [`%${search}%`]
                );
             } catch (e) {
                console.error("Search Query Error:", e);
             }
        }
        
        // CASE D: EXPLORE ALL (DIAGNOSTIC MODE)
        else {
            const itemsPerShard = Math.ceil(parseInt(limit) / 10) + 2; 
            const sql = `SELECT * FROM products WHERE status = 'in_stock' ORDER BY created_at DESC LIMIT ${itemsPerShard}`;
            
            // 🔥 DEBUGGING LOGIC START 🔥
            // Map over shards to find EXACTLY which one is broken
            const allPromises = Object.entries(clients).map(async ([key, client]) => {
                try {
                    const res = await client.execute(sql);
                    return res.rows;
                } catch (e) {
                    // Log the error for Vercel Console
                    console.error(`❌ FAILED Shard: [${key}] - Error: ${e.message}`);
                    
                    // Add to our debug list to show you in the browser
                    debugErrors.push({ shard: key, error: e.message });
                    
                    return []; // Return empty so the site DOES NOT CRASH
                }
            });

            const allRes = await Promise.all(allPromises);
            
            // Combine results from working shards
            allRes.forEach(rows => results.push(...rows));
            
            // Sort valid results
            results.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
            results = results.slice(0, parseInt(limit));
        }

        // 🚨 IF ERRORS EXIST, SEND DIAGNOSTIC REPORT 🚨
        if (debugErrors.length > 0) {
            console.log("⚠️ Sending Diagnostic Report to Browser");
            return res.status(200).json({ 
                message: "⚠️ WARNING: Connection Failed for specific shards",
                failed_shards: debugErrors, // <--- READ THIS IN YOUR BROWSER TO FIND THE BAD TOKEN
                products: results.map(p => parseProduct(p)) 
            });
        }

        // Standard Success Response
        res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=30');
        res.status(200).json({ products: results.map(p => parseProduct(p)) });

    } catch (e) {
        console.error("Explore Critical Error:", e);
        // Even in critical error, try to return empty list instead of 500
        res.status(200).json({ products: [], error: e.message });
    }
};
/* ======================================================
   3. SINGLE PRODUCT DETAIL
   ====================================================== */
exports.getProductBySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const shardKeys = Object.keys(clients);
        const searchPromises = shardKeys.map(async (key) => {
            const res = await clients[key].execute({ sql: "SELECT * FROM products WHERE slug = ? LIMIT 1", args: [slug] });
            return res.rows.length > 0 ? { p: res.rows[0], key: key } : null;
        });

        const matches = await Promise.all(searchPromises);
        const match = matches.find(r => r !== null);

        if (!match) return res.status(404).json({ message: "Product not found" });
        const product = parseProduct(match.p);
        const client = clients[match.key]; 

        const [[supplierRows], [reviews], relatedRes, variantsRes] = await Promise.all([
            db.suppliers.query("SELECT id, brand_name as name, profile_pic, average_rating, followers_count, verified_status FROM suppliers WHERE id = ?", [product.supplier_id]),
            db.reviews.query("SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 5", [product.id]),
            client.execute({ sql: "SELECT * FROM products WHERE category_id = ? AND id != ? LIMIT 8", args: [product.category_id, product.id] }),
            client.execute({ sql: "SELECT * FROM variants WHERE product_id = ?", args: [product.id] })
        ]);

        const supplier = supplierRows[0] || { name: "Store Seller", verified_status: "verified", followers_count: 0, average_rating: 0 };
        const avgRating = reviews.length > 0 ? (reviews.reduce((acc, r) => acc + parseFloat(r.rating), 0) / reviews.length) : 0;

        const finalData = {
            ...product,
            variants: variantsRes.rows,
            supplier,
            reviews,
            related_products: relatedRes.rows.map(p => parseProduct(p)),
            avg_rating: avgRating,
            total_reviews_count: reviews.length,
            product_ratings: [{ avg_rating: avgRating, review_count: reviews.length }], 
            is_favorite: false 
        };

        // ⚡ CACHE FOR 5 MINUTES (Unless user is logged in, but header handles static parts) ⚡
        res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=30');
        res.status(200).json(finalData);

    } catch (e) {
        console.error("Product Detail Error:", e);
        res.status(500).json({ message: "Error" });
    }
};

/* ======================================================
   4. CATEGORY ROWS 
   ====================================================== */
exports.getCategoryRows = async (req, res) => {
    try {
        const [parents] = await db.inventory.query("SELECT id, name, slug, db_shard FROM categories WHERE parent_id IS NULL ORDER BY name ASC");
        
        const promises = parents.map(async p => {
            const client = clients[p.db_shard] || clients.shard_general;
            const [subs] = await db.inventory.query("SELECT id FROM categories WHERE parent_id = ?", [p.id]);
            const ids = [p.id, ...subs.map(s => s.id)].join(',');

            try {
                const res = await client.execute(`SELECT * FROM products WHERE category_id IN (${ids}) AND status='in_stock' ORDER BY created_at DESC LIMIT 10`);
                if(res.rows.length > 0) {
                    return { 
                        category_id: p.id, 
                        category_name: p.name, 
                        category_slug: p.slug, 
                        products: res.rows.map(p => parseProduct(p)) 
                    };
                }
            } catch(e) {}
            return null;
        });

        const rows = (await Promise.all(promises)).filter(r => r);
        
        // ⚡ CACHE FOR 30 MINUTES ⚡
        res.set('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=60');
        res.json(rows);
    } catch (e) { res.json([]); }
};

/* ======================================================
   5. CATEGORY PAGE
   ====================================================== */
exports.getProductsByCategorySlug = async (req, res) => {
    try {
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const sort = req.query.sort || 'newest';

        const [catRows] = await db.inventory.query("SELECT id, name, slug, db_shard, parent_id FROM categories WHERE slug = ?", [slug]);
        if (catRows.length === 0) return res.status(404).json({ message: "Not found" });
        const category = catRows[0];

        const shardKey = category.db_shard || 'shard_general';
        const client = clients[shardKey] || clients.shard_general;

        const [children] = await db.inventory.query("SELECT id FROM categories WHERE parent_id = ?", [category.id]);
        const ids = [category.id, ...children.map(c => c.id)].join(',');

        let orderBy = "ORDER BY created_at DESC";
        if (sort === 'price_high') orderBy = "ORDER BY price DESC";
        if (sort === 'price_low') orderBy = "ORDER BY price ASC";

        const [pRes, cRes] = await Promise.all([
            client.execute({ sql: `SELECT * FROM products WHERE category_id IN (${ids}) AND status = 'in_stock' ${orderBy} LIMIT ${limit} OFFSET ${(page-1)*limit}` }),
            client.execute({ sql: `SELECT COUNT(*) as total FROM products WHERE category_id IN (${ids}) AND status = 'in_stock'` })
        ]);

        const response = {
            category,
            products: pRes.rows.map(p => parseProduct(p)),
            total: cRes.rows[0].total,
            totalPages: Math.ceil(cRes.rows[0].total / limit),
            currentPage: page
        };

        // ⚡ CACHE FOR 10 MINUTES ⚡
        res.set('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=30');
        res.status(200).json(response);

    } catch (e) { 
        res.status(500).json({message: "Error"}); 
    }
};

// HELPERS
exports.incrementProductView = async (req, res) => {
    Object.values(clients).forEach(c => {
        c.execute({sql:"UPDATE products SET views = views + 1 WHERE id = ?", args:[req.params.id]}).catch(()=>{});
    });
    res.json({status:"ok"});
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
        
        parents.forEach(p => {
            p.subcategories = []; 
            parentMap.set(p.id, p);
        });

        children.forEach(child => {
            if (parentMap.has(child.parent_id)) {
                parentMap.get(child.parent_id).subcategories.push(child);
            }
        });

        const response = { mainCats: parents };
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=60'); // 1 Hour Cache
        res.status(200).json(response);

    } catch (error) {
        res.status(500).json({ mainCats: [] });
    }
};

exports.getProductById = async (req, res) => {
    const { id } = req.params;
    const matches = await queryAllShards("SELECT * FROM products WHERE id = ? LIMIT 1", [id]);
    if (matches.length > 0) return res.json(parseProduct(matches[0]));
    res.status(404).json({ message: "Use Slug" });
};