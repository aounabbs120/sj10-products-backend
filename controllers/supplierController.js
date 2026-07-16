const db = require('../config/database');
const redis = require('../config/redis');

// api/controllers/supplierController.js

exports.getSupplierById = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const cacheKey = `supplier_profile_v2_${supplierId}`;

        if (!db.suppliers) {
            return res.status(500).json({ message: "Database not configured." });
        }

        // 1. ⚡ Check Redis Cache First
        const cachedSupplier = await redis.get(cacheKey);
        if (cachedSupplier) {
            console.log(`⚡ [REDIS] Serving Supplier Profile: ${supplierId}`);
            return res.json(JSON.parse(cachedSupplier));
        }

        console.log(`🟡 [TiDB MySQL] Cache Miss! Fetching Supplier: ${supplierId}`);

        // 2. Fetch from TiDB MySQL
        const sqlQuery = `
            SELECT 
                id, brand_name, full_name, profile_pic, followers_count, 
                average_rating, total_reviews, verified_status, total_products, city
            FROM suppliers 
            WHERE id = ?
            LIMIT 1
        `;
        
        const [rows] = await db.suppliers.query(sqlQuery, [supplierId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: "Supplier not found." });
        }

        const supplier = rows[0];
        const responseData = {
            ...supplier,
            name: supplier.brand_name || supplier.full_name || 'SJ10 Seller'
        };

        // 3. 💾 Save to Redis for 30 Minutes (1800 seconds)
        // Supplier profiles don't change very often, so 30 mins is safe.
        await redis.setEx(cacheKey, 1800, JSON.stringify(responseData));
        
        // Browser/CDN Caching
        res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
        res.json(responseData);

    } catch (error) {
        console.error("🔴 [Supplier Controller] Error:", error.message);
        res.status(500).json({ message: "Server Error" });
    }
};

exports.getAllSupplierIds = async (req, res) => {
    const cacheKey = "all_verified_supplier_ids";
    try {
        // Check Cache for sitemap data
        const cachedIds = await redis.get(cacheKey);
        if (cachedIds) return res.json(JSON.parse(cachedIds));

        // Fetch all verified/active suppliers quickly from TiDB
        const [rows] = await db.suppliers.query(
            "SELECT id FROM suppliers WHERE verified_status = 'verified' OR verified_status = '1'"
        );
        
        const ids = rows.map(r => r.id);

        // Cache for 1 Hour (Sitemap data doesn't need to be real-time)
        await redis.setEx(cacheKey, 3600, JSON.stringify(ids));

        res.json(ids);
    } catch (error) {
        console.error("🔴 Supplier IDs Error:", error.message);
        res.status(500).json([]);
    }
};

/* ======================================================
   🔥 SHOP DISCOVERY: Search Suppliers by Name or Code
   Priority: SJ10 Official > Exact Match > Suggestions
   ====================================================== */
exports.searchSuppliers = async (req, res) => {
    try {
        const { q } = req.query; // Search Term
        if (!q || q.length < 2) return res.json({ shop: null, suggestions: [] });

        console.log(`🔍 [SHOP SEARCH] Searching for: "${q}"`);

        const searchTerm = `%${q.trim().toLowerCase()}%`;
        const exactTerm = q.trim();

        // 1. Logic:
        // - brand_name = 'SJ10 Official' ko priority 1 di hai (Hamesha Top)
        // - Exact Match (Name ya Code) ko priority 2 di hai
        // - Like Match ko priority 3 di hai
        const sqlQuery = `
            SELECT 
                id, brand_name, profile_pic, supplier_code, verified_status, city, average_rating
            FROM suppliers 
            WHERE 
                (LOWER(brand_name) LIKE ? OR LOWER(supplier_code) LIKE ?)
                AND status = 'active'
            ORDER BY 
                (CASE 
                    WHEN brand_name = 'SJ10 Official' THEN 1 
                    WHEN brand_name = ? OR supplier_code = ? THEN 2
                    WHEN verified_status = 'verified' THEN 3
                    ELSE 4 
                END) ASC,
                followers_count DESC
            LIMIT 10
        `;

        const [rows] = await db.suppliers.query(sqlQuery, [searchTerm, searchTerm, exactTerm, exactTerm]);

        if (rows.length === 0) {
            return res.json({ shop: null, suggestions: [] });
        }

        // 2. Exact Match ki check (For Direct Redirect)
        // Agar pehla result user ki query se exact match karta hai tou usay 'shop' mein bhejo
        const firstResult = rows[0];
        const isExactMatch = 
            firstResult.brand_name.toLowerCase() === exactTerm.toLowerCase() || 
            firstResult.supplier_code.toLowerCase() === exactTerm.toLowerCase();

        res.json({
            shop: isExactMatch ? firstResult : null, // Frontend isay direct open kar sakta hai
            suggestions: rows.map(s => ({
                id: s.id,
                name: s.brand_name,
                code: s.supplier_code,
                image: s.profile_pic,
                verified: s.verified_status === 'verified',
                city: s.city,
                rating: s.average_rating
            }))
        });

    } catch (error) {
        console.error("🔴 Shop Search Error:", error.message);
        res.status(500).json({ shop: null, suggestions: [] });
    }
};