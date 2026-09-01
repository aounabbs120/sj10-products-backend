// controllers/socialController.js (Product Backend - High-Speed Multi-Node Social Sync)
const db = require('../config/database');
const axios = require('axios');

const ORDERS_BACKEND_URL = (process.env.ORDERS_BACKEND_URL || 'https://orders.sj10.pk').replace(/\/$/, '');
const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || 'Sj10_Internal_AounAbbas_!@2025_#_TopSecret').replace(/['"]/g, '').trim();

// ==============================================================
// ⚡ ASYNC NOTIFICATION DISPATCHER (NON-BLOCKING: 0ms UI LAG)
// ==============================================================
const dispatchPushAsync = (payload) => {
    setImmediate(async () => {
        try {
            await axios.post(`${ORDERS_BACKEND_URL}/api/internal/notify/broadcast`, {
                userIds: [payload.recipientId],
                title: payload.title,
                body: payload.body,
                url: payload.url || '/profile/followed-shops',
                imageUrl: payload.image || null
            }, {
                headers: { 
                    'x-internal-api-key': INTERNAL_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 6000
            });
            console.log(`✅ [Async Social Push] Delivered to ${payload.recipientType}: ${payload.recipientId}`);
        } catch (err) {
            console.warn(`⚠️ [Social Push Warning] Could not notify ${payload.recipientId}:`, err.response?.data?.message || err.message);
        }
    });
};

// ==============================================================
// 🎯 HELPER: Fetch Products from Oracle PostgreSQL
// ==============================================================
const getProductsFromOracleByIds = async (productIds) => {
    if (!productIds || productIds.length === 0) return [];
    try {
        const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
        const sql = `SELECT id, title, image_urls, image_url, price, discounted_price, slug, supplier_id FROM products WHERE id IN (${placeholders})`;
        
        const res = await db.oracle.query(sql, productIds);
        return res.rows || [];
    } catch (e) { 
        console.error("🔴 Oracle Social Helper Error:", e.message);
        return []; 
    }
};

// ==============================================================
// 1. GET MY FAVORITES (User's Wishlist List)
// ==============================================================
exports.getMyFavorites = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get IDs from TiDB MySQL (Social DB)
        const [favRows] = await db.db_social.query(
            "SELECT product_id, created_at FROM product_favorites WHERE user_id = ? ORDER BY created_at DESC", 
            [userId]
        );

        if (!favRows || favRows.length === 0) return res.json([]);

        // 2. Get Details from Oracle DB
        const productIds = favRows.map(row => row.product_id);
        const products = await getProductsFromOracleByIds(productIds);

        // 3. Merge Data & Parse Images Safely
        const detailedFavorites = products.map(p => {
            const favInfo = favRows.find(f => String(f.product_id) === String(p.id)); 
            
            let images = [];
            try { 
                if (Array.isArray(p.image_urls)) images = p.image_urls;
                else if (typeof p.image_urls === 'string' && p.image_urls.startsWith('[')) images = JSON.parse(p.image_urls);
                else images = [p.image_url || p.image_urls].filter(Boolean);
            } catch (e) { 
                images = ["/placeholder.jpg"]; 
            }

            return { 
                ...p, 
                price: parseFloat(p.price || 0),
                discounted_price: parseFloat(p.discounted_price || p.price || 0),
                image_urls: images, 
                favorited_at: favInfo ? favInfo.created_at : null 
            };
        });

        // 4. Sort: Newest First
        detailedFavorites.sort((a, b) => new Date(b.favorited_at) - new Date(a.favorited_at));

        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.json(detailedFavorites);
    } catch (error) {
        console.error("🔴 Favorites List Error:", error.message);
        res.status(500).json({ message: "Error fetching favorites" });
    }
};

// ==============================================================
// 🟢 2. TOGGLE PRODUCT FAVORITE (NOTIFIES SUPPLIER WITH BANNER IMAGE)
// ==============================================================
exports.toggleFavoriteProduct = async (req, res) => {
    const connection = await db.db_social.getConnection();
    try {
        const userId = req.user.id;
        const { productId } = req.params;
        await connection.beginTransaction();

        const [existing] = await connection.query(
            "SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", 
            [userId, productId]
        );

        let isFavorite = false;

        if (existing.length > 0) {
            // Remove from Favorites (Silent removal)
            await connection.query("DELETE FROM product_favorites WHERE id = ?", [existing[0].id]);
            await connection.commit();
            isFavorite = false;
        } else {
            // Add to Favorites
            await connection.query("INSERT INTO product_favorites (user_id, product_id, created_at) VALUES (?, ?, NOW())", [userId, productId]);
            await connection.commit();
            isFavorite = true;

            // 🟢 ASYNC NOTIFY SUPPLIER ONLY (With Product Banner Image)
            setImmediate(async () => {
                try {
                    const [userRows] = await db.users.query("SELECT full_name FROM users WHERE id = ?", [userId]);
                    const userName = userRows[0]?.full_name || "A Customer";

                    const products = await getProductsFromOracleByIds([productId]);
                    if (products.length > 0) {
                        const product = products[0];
                        const supplierId = product.supplier_id;

                        // Parse First Image for Notification Banner
                        let firstImage = null;
                        if (product.image_urls) {
                            try {
                                if (Array.isArray(product.image_urls)) firstImage = product.image_urls[0];
                                else if (typeof product.image_urls === 'string' && product.image_urls.startsWith('[')) firstImage = JSON.parse(product.image_urls)[0];
                                else firstImage = product.image_urls;
                            } catch (e) { 
                                firstImage = product.image_url; 
                            }
                        }

                        if (supplierId) {
                            dispatchPushAsync({
                                recipientId: supplierId,
                                recipientType: 'supplier',
                                title: "❤️ Product Liked!",
                                body: `${userName} ne aapki product "${product.title}" ko wishlist mein shamil kiya hai.`,
                                image: firstImage,
                                url: `/products/${productId}`
                            });
                        }
                    }
                } catch (favNotifErr) {
                    console.warn("⚠️ Favorite notification background error:", favNotifErr.message);
                }
            });
        }

        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.json({ 
            success: true, 
            message: isFavorite ? "Added to favorites" : "Removed from favorites", 
            isFavorite 
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("🔴 Toggle Favorite Error:", error.message);
        res.status(500).json({ message: "Action failed" });
    } finally {
        connection.release();
    }
};

// ==============================================================
// 3. CHECK FAVORITE STATUS (NO CACHE - 100% LIVE)
// ==============================================================
exports.checkFavoriteStatus = async (req, res) => {
    try {
        const [rows] = await db.db_social.query(
            "SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", 
            [req.user.id, req.params.productId]
        );
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.json({ isFavorite: rows.length > 0 });
    } catch (error) {
        res.status(200).json({ isFavorite: false });
    }
};

// ==============================================================
// 🟢 4. TOGGLE FOLLOW SUPPLIER (DUAL ALERTS WITH DPs & STORE LOGOS)
// ==============================================================
exports.toggleFollowSupplier = async (req, res) => {
    let socialConnection, suppliersConnection;

    try {
        const userId = req.user.id;
        const { supplierId } = req.params;

        socialConnection = await db.db_social.getConnection();
        suppliersConnection = await db.suppliers.getConnection();

        await socialConnection.beginTransaction();
        await suppliersConnection.beginTransaction();

        const [existing] = await socialConnection.query(
            "SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", 
            [userId, supplierId]
        );

        let isFollowing = false;

        if (existing.length > 0) {
            // UNFOLLOW STORE
            await socialConnection.query("DELETE FROM supplier_followers WHERE id = ?", [existing[0].id]);
            await suppliersConnection.query(
                "UPDATE suppliers SET followers_count = GREATEST(0, followers_count - 1) WHERE id = ?", 
                [supplierId]
            );
            isFollowing = false;
        } else {
            // FOLLOW STORE
            await socialConnection.query(
                "INSERT INTO supplier_followers (user_id, supplier_id, created_at) VALUES (?, ?, NOW())", 
                [userId, supplierId]
            );
            await suppliersConnection.query(
                "UPDATE suppliers SET followers_count = followers_count + 1 WHERE id = ?", 
                [supplierId]
            );
            isFollowing = true;
        }

        await socialConnection.commit();
        await suppliersConnection.commit();

        // 🟢 5. ASYNC DUAL NOTIFICATIONS DISPATCH (Non-blocking)
        setImmediate(async () => {
            try {
                const [userRows] = await db.users.query("SELECT full_name, profile_pic FROM users WHERE id = ?", [userId]);
                const [supRows] = await db.suppliers.query("SELECT brand_name, full_name, profile_pic FROM suppliers WHERE id = ?", [supplierId]);

                const user = userRows[0] || { full_name: "Valued Customer", profile_pic: null };
                const supplier = supRows[0] || { brand_name: "SJ10 Store", profile_pic: null };

                const userDp = user.profile_pic || "https://www.sj10.pk/default-avatar.png";
                const storeLogo = supplier.profile_pic || "https://www.sj10.pk/default-store.png";
                const storeName = supplier.brand_name || supplier.full_name || "SJ10 Store";
                const userName = user.full_name || "A Customer";

                if (isFollowing) {
                    // A. Alert to Supplier (With Customer DP & Name)
                    dispatchPushAsync({
                        recipientId: supplierId,
                        recipientType: 'supplier',
                        title: "🎉 Naya Follower Mila!",
                        body: `${userName} ne aapke store ko follow karna shuru kar diya hai.`,
                        image: userDp,
                        url: "/profile/followed-shops"
                    });

                    // B. Alert to Customer (With Store Logo & Brand Name)
                    dispatchPushAsync({
                        recipientId: userId,
                        recipientType: 'user',
                        title: "🏪 Store Follow Ho Gaya!",
                        body: `Aapne "${storeName}" ko follow kar liya hai. Inki nayi products ke updates aapko milte rahenge!`,
                        image: storeLogo,
                        url: "/profile/followed-shops"
                    });
                } else {
                    // Unfollow Notice to Supplier
                    dispatchPushAsync({
                        recipientId: supplierId,
                        recipientType: 'supplier',
                        title: "⚠️ Store Unfollowed",
                        body: `Dear ${storeName}, ${userName} ne aapke store ko unfollow kar diya hai.`,
                        image: userDp,
                        url: "/profile/followed-shops"
                    });
                }
            } catch (notifAsyncErr) {
                console.warn("⚠️ Follow notification async error:", notifAsyncErr.message);
            }
        });

        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.status(200).json({ 
            success: true, 
            isFollowing,
            message: isFollowing ? "Store followed." : "Store unfollowed." 
        });

    } catch (error) {
        if (socialConnection) await socialConnection.rollback();
        if (suppliersConnection) await suppliersConnection.rollback();
        console.error("🔴 Follow Error:", error.message);
        res.status(500).json({ message: "Action failed" });
    } finally {
        if (socialConnection) socialConnection.release();
        if (suppliersConnection) suppliersConnection.release();
    }
};

// ==============================================================
// 5. CHECK FOLLOW STATUS (NO CACHE - 100% LIVE)
// ==============================================================
exports.checkFollowStatus = async (req, res) => {
    try {
        const [existing] = await db.db_social.query(
            "SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", 
            [req.user.id, req.params.supplierId]
        );
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.status(200).json({ isFollowing: existing.length > 0 });
    } catch (error) {
        res.status(200).json({ isFollowing: false });
    }
};