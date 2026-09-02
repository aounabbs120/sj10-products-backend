// controllers/socialController.js (Product Backend - With Full Diagnostic Logs)
const db = require('../config/database');
const axios = require('axios');

const ORDERS_BACKEND_URL = (process.env.ORDERS_BACKEND_URL || 'https://orders.sj10.pk').replace(/\/$/, '');
const SUPPLIER_BACKEND_URL = (process.env.SUPPLIER_BACKEND_URL || 'https://sj1osupplierbackend1.vercel.app').replace(/\/$/, '');
const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || 'Sj10_Internal_AounAbbas_!@2025_#_TopSecret').replace(/['"]/g, '').trim();

// 🟢 ASYNC PUSH DISPATCHERS WITH FULL ERROR LOGGING
const sendPushToCustomerApp = (userId, title, body, imageUrl, url) => {
    setImmediate(async () => {
        try {
            await axios.post(`${ORDERS_BACKEND_URL}/api/internal/notify/broadcast`, {
                userIds: [userId],
                title,
                body,
                url: url || '/profile/favorites',
                imageUrl: imageUrl || null
            }, {
                headers: { 'x-internal-api-key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
                timeout: 8000
            });
            console.log(`✅ [User Push Sent] Delivered to User: ${userId}`);
        } catch (err) {
            console.error(`🔴 [User Push Error]:`, err.response?.data || err.message);
        }
    });
};

const sendPushToSupplierApp = (supplierId, title, body, imageUrl, url, type) => {
    setImmediate(async () => {
        try {
            console.log(`📡 [Supplier Ping] Attempting to notify Supplier: ${supplierId} at ${SUPPLIER_BACKEND_URL}/api/internal/notify/social-alert...`);
            
            const res = await axios.post(`${SUPPLIER_BACKEND_URL}/api/internal/notify/social-alert`, {
                supplierId,
                title,
                body,
                imageUrl: imageUrl || null,
                url: url || '/social/followers',
                type: type || 'social'
            }, {
                headers: { 'x-internal-api-key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
                timeout: 8000
            });
            console.log(`✅ [Supplier Ping SUCCESS] Response from Supplier Backend:`, res.data);
        } catch (err) {
            console.error(`🔴 [Supplier Ping FAILED] Status: ${err.response?.status} | Error:`, err.response?.data || err.message);
        }
    });
};

// --- Helper: Fetch Products from Oracle PostgreSQL ---
const getProductsFromOracleByIds = async (productIds) => {
    if (!productIds || productIds.length === 0) return [];
    try {
        const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
        const sql = `SELECT id, title, image_urls, image_url, price, discounted_price, slug, supplier_id FROM products WHERE id IN (${placeholders})`;
        const res = await db.oracle.query(sql, productIds);
        return res.rows || [];
    } catch (e) { 
        console.error("🔴 Oracle Fetch Error:", e.message);
        return []; 
    }
};

// ==============================================================
// 1. GET MY FAVORITES
// ==============================================================
exports.getMyFavorites = async (req, res) => {
    try {
        const userId = req.user.id;
        const [favRows] = await db.db_social.query(
            "SELECT product_id, created_at FROM product_favorites WHERE user_id = ? ORDER BY created_at DESC", 
            [userId]
        );

        if (!favRows || favRows.length === 0) return res.json([]);

        const productIds = favRows.map(row => row.product_id);
        const products = await getProductsFromOracleByIds(productIds);

        const detailedFavorites = products.map(p => {
            const favInfo = favRows.find(f => String(f.product_id) === String(p.id)); 
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

        detailedFavorites.sort((a, b) => new Date(b.favorited_at) - new Date(a.favorited_at));
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.json(detailedFavorites);
    } catch (error) {
        res.status(500).json({ message: "Error fetching favorites" });
    }
};

// ==============================================================
// 🟢 2. TOGGLE PRODUCT FAVORITE (WITH DIRECT SUPPLIER DISPATCH)
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
            await connection.query("DELETE FROM product_favorites WHERE id = ?", [existing[0].id]);
            await connection.commit();
            isFavorite = false;
        } else {
            await connection.query("INSERT INTO product_favorites (user_id, product_id, created_at) VALUES (?, ?, NOW())", [userId, productId]);
            await connection.commit();
            isFavorite = true;

            // 🟢 BACKGROUND NOTIFICATIONS
            setImmediate(async () => {
                try {
                    const [userRows] = await db.users.query("SELECT full_name FROM users WHERE id = ?", [userId]);
                    const userName = userRows[0]?.full_name || "A Customer";

                    const products = await getProductsFromOracleByIds([productId]);
                    if (products.length > 0) {
                        const product = products[0];
                        const supplierId = product.supplier_id;
                        const productTitle = product.title || "Product";

                        console.log(`📦 [Favorite Debug] Product: "${productTitle}" | Found Supplier ID: "${supplierId}"`);

                        let firstImage = null;
                        if (product.image_urls) {
                            try {
                                if (Array.isArray(product.image_urls)) firstImage = product.image_urls[0];
                                else if (typeof product.image_urls === 'string' && product.image_urls.startsWith('[')) firstImage = JSON.parse(product.image_urls)[0];
                                else firstImage = product.image_urls;
                            } catch (e) { firstImage = product.image_url; }
                        }

                        // A. User Notification
                        const userTitle = "❤️ Added to Wishlist!";
                        const userBody = `"${productTitle}" has been added to your favorites.`;
                        sendPushToCustomerApp(userId, userTitle, userBody, firstImage, `/products/${productId}`);

                        // B. Supplier Notification
                        if (supplierId && supplierId !== 'sj10-official' && supplierId !== 'unknown') {
                            const [supRows] = await db.suppliers.query("SELECT brand_name, full_name FROM suppliers WHERE id = ?", [supplierId]);
                            const supplierName = supRows[0]?.brand_name || supRows[0]?.full_name || "Store";

                            const supTitle = "❤️ Product Added to Favorites";
                            const supBody = `Dear ${supplierName}, ${userName} added "${productTitle}" to their favorites.`;

                            sendPushToSupplierApp(supplierId, supTitle, supBody, firstImage, `/products/${productId}`, "product_favorite");
                        } else {
                            console.warn(`⚠️ [Supplier Skipped] Invalid supplier_id: "${supplierId}" for Product ID: ${productId}`);
                        }
                    }
                } catch (favErr) {
                    console.error("🔴 Favorite Dispatch Error:", favErr.message);
                }
            });
        }

        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.status(200).json({ 
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

// 3. CHECK FAVORITE STATUS
exports.checkFavoriteStatus = async (req, res) => {
    try {
        const [rows] = await db.db_social.query(
            "SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", 
            [req.user.id, req.params.productId]
        );
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.status(200).json({ isFavorite: rows.length > 0 });
    } catch (error) {
        res.status(200).json({ isFavorite: false });
    }
};

// ==============================================================
// 🟢 4. TOGGLE FOLLOW SUPPLIER
// ==============================================================
exports.toggleFollowSupplier = async (req, res) => {
    const socialConnection = await db.db_social.getConnection();
    try {
        const userId = req.user.id;
        const { supplierId } = req.params;

        await socialConnection.beginTransaction();

        const [existing] = await socialConnection.query(
            "SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", 
            [userId, supplierId]
        );

        let isFollowing = false;

        if (existing.length > 0) {
            await socialConnection.query("DELETE FROM supplier_followers WHERE id = ?", [existing[0].id]);
            await db.suppliers.query(
                "UPDATE suppliers SET followers_count = GREATEST(0, followers_count - 1) WHERE id = ?", 
                [supplierId]
            );
            isFollowing = false;
        } else {
            await socialConnection.query(
                "INSERT INTO supplier_followers (user_id, supplier_id, created_at) VALUES (?, ?, NOW())", 
                [userId, supplierId]
            );
            await db.suppliers.query(
                "UPDATE suppliers SET followers_count = followers_count + 1 WHERE id = ?", 
                [supplierId]
            );
            isFollowing = true;
        }

        await socialConnection.commit();

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
                    const supTitle = "👤 New Store Follower";
                    const supBody = `Dear ${storeName}, ${userName} started following your shop.`;
                    const userTitle = "🏪 Store Followed";
                    const userBody = `Dear ${userName}, you started following "${storeName}". You'll receive updates on their latest products!`;

                    sendPushToSupplierApp(supplierId, supTitle, supBody, userDp, "/social/followers", "new_follower");
                    sendPushToCustomerApp(userId, userTitle, userBody, storeLogo, "/profile/followed-shops");
                } else {
                    const supUnfollowTitle = "⚠️ Store Unfollowed";
                    const supUnfollowBody = `Dear ${storeName}, ${userName} unfollowed your shop.`;
                    const userUnfollowTitle = "👋 Store Unfollowed";
                    const userUnfollowBody = `Dear ${userName}, you unfollowed "${storeName}".`;

                    sendPushToSupplierApp(supplierId, supUnfollowTitle, supUnfollowBody, userDp, "/social/followers", "unfollow");
                    sendPushToCustomerApp(userId, userUnfollowTitle, userUnfollowBody, storeLogo, "/profile/followed-shops");
                }
            } catch (asyncErr) {
                console.error("🔴 Follow Notification Error:", asyncErr.message);
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
        console.error("🔴 Follow Error:", error.message);
        res.status(500).json({ message: "Action failed" });
    } finally {
        socialConnection.release();
    }
};

// 5. CHECK FOLLOW STATUS
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