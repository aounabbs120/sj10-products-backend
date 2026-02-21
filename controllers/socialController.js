const db = require('../config/database');
const { clients } = require('../config/tursoConnection'); 
const axios = require('axios'); 

// --- Helper: Fetch Product Details from Turso ---
const getProductsByIds = async (productIds) => {
    if (!productIds || productIds.length === 0) return [];
    if (!clients || Object.keys(clients).length === 0) return [];
    
    // 🔥 FIXED: Added discounted_price and supplier_id to the query
    const promises = Object.values(clients).map(async (client) => {
        try {
            const placeholders = productIds.map(() => '?').join(',');
            const sql = `SELECT id, title, image_urls, price, discounted_price, slug, supplier_id FROM products WHERE id IN (${placeholders})`;
            const res = await client.execute({ sql, args: productIds });
            return res.rows;
        } catch (e) { return []; }
    });

    const results = await Promise.all(promises);
    return results.flat(); 
};

// --- 1. Get My Favorites ---
exports.getMyFavorites = async (req, res) => {
    try {
        const userId = req.user.id;
        if (!db.db_social) return res.status(500).json({ message: "DB Error" });

        // 1. Get IDs from MySQL
        const [favRows] = await db.db_social.query(
            "SELECT product_id, created_at FROM product_favorites WHERE user_id = ? ORDER BY created_at DESC", 
            [userId]
        );

        if (!favRows || favRows.length === 0) return res.json([]);

        // 2. Get Details from Turso
        const productIds = favRows.map(row => row.product_id);
        const products = await getProductsByIds(productIds);

        // 3. Merge Data
        const detailedFavorites = products.map(p => {
            const favInfo = favRows.find(f => String(f.product_id) === String(p.id)); 
            
            // Image Parsing
            let images = [];
            try { 
                images = typeof p.image_urls === 'string' ? JSON.parse(p.image_urls) : p.image_urls; 
            } catch (e) { 
                images = ["/placeholder.jpg"]; 
            }

            return { 
                ...p, 
                // Ensure numbers for frontend math
                price: parseFloat(p.price),
                discounted_price: parseFloat(p.discounted_price || p.price),
                image_urls: images, 
                favorited_at: favInfo ? favInfo.created_at : null 
            };
        });

        // 4. Sort again by favorited_at to ensure correct order after merging
        detailedFavorites.sort((a, b) => new Date(b.favorited_at) - new Date(a.favorited_at));

        res.json(detailedFavorites);
    } catch (error) {
        console.error("Favorites Error:", error);
        res.status(500).json({ message: "Error fetching favorites" });
    }
};

// --- 2. Toggle Favorite ---
exports.toggleFavoriteProduct = async (req, res) => {
    if (!db.db_social) return res.status(500).json({ message: "DB Error" });
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
        await connection.rollback();
        res.status(500).json({ message: "Action failed" });
    } finally {
        connection.release();
    }
};

// --- 3. Check Status ---
exports.checkFavoriteStatus = async (req, res) => {
    try {
        if (!db.db_social) return res.json({ isFavorite: false });
        const [rows] = await db.db_social.query("SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", [req.user.id, req.params.productId]);
        res.json({ isFavorite: rows.length > 0 });
    } catch (error) {
        res.status(200).json({ isFavorite: false });
    }
};

// --- 4. Follow Logic ---
exports.toggleFollowSupplier = async (req, res) => {
    let connection;
    try {
        connection = await db.db_social.getConnection();
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

            // Notification
            if (process.env.SUPPLIER_BACKEND_URL && db.users) {
                const [userDetails] = await db.users.query("SELECT full_name, profile_pic FROM users WHERE id = ?", [userId]);
                const followerName = (userDetails.length > 0) ? userDetails[0].full_name : "A Customer";
                const followerPic = (userDetails.length > 0) ? userDetails[0].profile_pic : null;

                axios.post(`${process.env.SUPPLIER_BACKEND_URL}/api/internal/notify/new-follower`, {
                    supplierId,
                    followerName,
                    followerPic
                }, { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } })
                .catch(e => console.log("Notification Skipped"));
            }
        }

        await connection.commit();
        res.status(200).json({ isFollowing });

    } catch (error) {
        if(connection) await connection.rollback();
        console.error("Follow Error:", error);
        res.status(500).json({ message: "Action failed" });
    } finally {
        if(connection) connection.release();
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