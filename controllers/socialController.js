const db = require('../config/database');
const axios = require('axios'); 

// --- 🎯 HELPER: Fetch Product Details from Oracle (Lightning Fast) ---
const getProductsFromOracleByIds = async (productIds) => {
    if (!productIds || productIds.length === 0) return [];
    try {
        console.log(`🟢 [ORACLE DB] Fetching details for ${productIds.length} favorited products...`);
        
        // Postgres uses $1, $2 placeholders
        const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
        const sql = `SELECT id, title, image_urls, image_url, price, discounted_price, slug, supplier_id FROM products WHERE id IN (${placeholders})`;
        
        const res = await db.oracle.query(sql, productIds);
        return res.rows || [];
    } catch (e) { 
        console.error("🔴 Oracle Social Helper Error:", e.message);
        return []; 
    }
};

// --- 1. GET MY FAVORITES ---
exports.getMyFavorites = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get IDs from TiDB MySQL (Social DB)
        const [favRows] = await db.db_social.query(
            "SELECT product_id, created_at FROM product_favorites WHERE user_id = ? ORDER BY created_at DESC", 
            [userId]
        );

        if (!favRows || favRows.length === 0) return res.json([]);

        // 2. Get Details from Oracle (Instead of 12 Turso Shards)
        const productIds = favRows.map(row => row.product_id);
        const products = await getProductsFromOracleByIds(productIds);

        // 3. Merge Data & Parse Images
        const detailedFavorites = products.map(p => {
            const favInfo = favRows.find(f => String(f.product_id) === String(p.id)); 
            
            // Robust Image Parsing
            let images = [];
            try { 
                if (Array.isArray(p.image_urls)) images = p.image_urls;
                else if (typeof p.image_urls === 'string' && p.image_urls.startsWith('[')) images = JSON.parse(p.image_urls);
                else images = [p.image_url || p.image_urls].filter(Boolean);
            } catch (e) { images = ["/placeholder.jpg"]; }

            return { 
                ...p, 
                price: parseFloat(p.price || 0),
                discounted_price: parseFloat(p.discounted_price || p.price || 0),
                image_urls: images, 
                favorited_at: favInfo ? favInfo.created_at : null 
            };
        });

        // 4. Final Sort (TIDB order maintain rakhne ke liye)
        detailedFavorites.sort((a, b) => new Date(b.favorited_at) - new Date(a.favorited_at));

        res.json(detailedFavorites);
    } catch (error) {
        console.error("🔴 Favorites List Error:", error.message);
        res.status(500).json({ message: "Error fetching favorites" });
    }
};

// --- 2. TOGGLE FAVORITE ---
exports.toggleFavoriteProduct = async (req, res) => {
    const connection = await db.db_social.getConnection();
    try {
        const userId = req.user.id;
        const { productId } = req.params;
        await connection.beginTransaction();

        const [existing] = await connection.query("SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", [userId, productId]);

        if (existing.length > 0) {
            await connection.query("DELETE FROM product_favorites WHERE id = ?", [existing[0].id]);
            await connection.commit();
            res.json({ message: "Removed from favorites", isFavorite: false });
        } else {
            await connection.query("INSERT INTO product_favorites (user_id, product_id, created_at) VALUES (?, ?, NOW())", [userId, productId]);
            await connection.commit();
            res.json({ message: "Added to favorites", isFavorite: true });
        }
    } catch (error) {
        if(connection) await connection.rollback();
        res.status(500).json({ message: "Action failed" });
    } finally {
        connection.release();
    }
};

// --- 3. CHECK FAVORITE STATUS ---
exports.checkFavoriteStatus = async (req, res) => {
    try {
        const [rows] = await db.db_social.query("SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", [req.user.id, req.params.productId]);
        res.json({ isFavorite: rows.length > 0 });
    } catch (error) {
        res.status(200).json({ isFavorite: false });
    }
};

// --- 4. FOLLOW SUPPLIER LOGIC ---
exports.toggleFollowSupplier = async (req, res) => {
    const connection = await db.db_social.getConnection();
    try {
        await connection.beginTransaction();

        const userId = req.user.id;
        const { supplierId } = req.params;

        const [existing] = await connection.query(
            "SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", 
            [userId, supplierId]
        );

        let isFollowing = false;

        if (existing.length > 0) {
            await connection.query("DELETE FROM supplier_followers WHERE id = ?", [existing[0].id]);
            await db.suppliers.query(
                "UPDATE suppliers SET followers_count = GREATEST(0, followers_count - 1) WHERE id = ?", 
                [supplierId]
            );
            isFollowing = false;
        } else {
            await connection.query(
                "INSERT INTO supplier_followers (user_id, supplier_id, created_at) VALUES (?, ?, NOW())", 
                [userId, supplierId]
            );
            await db.suppliers.query(
                "UPDATE suppliers SET followers_count = followers_count + 1 WHERE id = ?", 
                [supplierId]
            );
            isFollowing = true;

            // Optional: Internal Notification to Supplier
            if (process.env.SUPPLIER_BACKEND_URL && db.users) {
                const [userDetails] = await db.users.query("SELECT full_name, profile_pic FROM users WHERE id = ?", [userId]);
                const followerName = (userDetails.length > 0) ? userDetails[0].full_name : "A Customer";
                const followerPic = (userDetails.length > 0) ? userDetails[0].profile_pic : null;

                axios.post(`${process.env.SUPPLIER_BACKEND_URL}/api/internal/notify/new-follower`, {
                    supplierId,
                    followerName,
                    followerPic
                }, { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } })
                .catch(e => { /* Silently fail notification */ });
            }
        }

        await connection.commit();
        res.status(200).json({ isFollowing });

    } catch (error) {
        if(connection) await connection.rollback();
        console.error("🔴 Follow Error:", error.message);
        res.status(500).json({ message: "Action failed" });
    } finally {
        connection.release();
    }
};

exports.checkFollowStatus = async (req, res) => {
    try {
        const [existing] = await db.db_social.query(
            "SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", 
            [req.user.id, req.params.supplierId]
        );
        res.status(200).json({ isFollowing: existing.length > 0 });
    } catch (error) {
        res.status(500).json({ isFollowing: false });
    }
};