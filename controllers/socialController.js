// controllers/socialController.js (Product Backend - Direct Supplier & User Notifications)
const db = require('../config/database');
const axios = require('axios');

const ORDERS_BACKEND_URL = (process.env.ORDERS_BACKEND_URL || 'https://orders.sj10.pk').replace(/\/$/, '');
const SUPPLIER_BACKEND_URL = (process.env.SUPPLIER_BACKEND_URL || 'https://sj1osupplierbackend1.vercel.app').replace(/\/$/, '');
const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || 'Sj10_Internal_AounAbbas_!@2025_#_TopSecret').replace(/['"]/g, '').trim();

// ==============================================================
// ⚡ 1. HELPER: NOTIFY CUSTOMER VIA ORDER BACKEND
// ==============================================================
const notifyCustomer = (userId, title, body, storeLogo) => {
    setImmediate(async () => {
        try {
            await axios.post(`${ORDERS_BACKEND_URL}/api/internal/notify/broadcast`, {
                userIds: [userId],
                title: title,
                body: body,
                url: '/profile/followed-shops',
                imageUrl: storeLogo || null
            }, {
                headers: { 'x-internal-api-key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
                timeout: 5000
            });
            console.log(`✅ [Customer Push Sent] ${userId}`);
        } catch (err) {
            console.warn(`⚠️ [Customer Push Error]:`, err.response?.data?.message || err.message);
        }
    });
};

// ==============================================================
// ⚡ 2. HELPER: DIRECT PING TO SUPPLIER BACKEND (GUJJAR TRICK)
// ==============================================================
const notifySupplierDirect = (payload) => {
    setImmediate(async () => {
        try {
            await axios.post(`${SUPPLIER_BACKEND_URL}/api/internal/notify/social-alert`, {
                supplierId: payload.supplierId,
                title: payload.title,
                body: payload.body,
                imageUrl: payload.image || null,
                url: payload.url || '/social/followers',
                type: payload.type || 'social'
            }, {
                headers: { 'x-internal-api-key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
                timeout: 5000
            });
            console.log(`✅ [Supplier Direct Ping SUCCESS] Alert delivered to supplier: ${payload.supplierId}`);
        } catch (err) {
            console.warn(`⚠️ [Supplier Direct Ping FAILED]:`, err.response?.data?.message || err.message);
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
// 🟢 2. TOGGLE PRODUCT FAVORITE (NOTIFIES SUPPLIER WITH PRODUCT IMAGE)
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

            // 🟢 ASYNC NOTIFY SUPPLIER DIRECTLY (WITH PRODUCT BANNER IMAGE)
            setImmediate(async () => {
                try {
                    const [userRows] = await db.users.query("SELECT full_name, profile_pic FROM users WHERE id = ?", [userId]);
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
                            } catch (e) { firstImage = product.image_url; }
                        }

                        if (supplierId) {
                            const [supRows] = await db.suppliers.query("SELECT brand_name, full_name FROM suppliers WHERE id = ?", [supplierId]);
                            const supplierName = supRows[0]?.brand_name || supRows[0]?.full_name || "Store";

                            // 🟢 DIRECT PING TO SUPPLIER BACKEND
                            notifySupplierDirect({
                                supplierId: supplierId,
                                title: "❤️ Product Added to Favorites",
                                body: `Dear ${supplierName}, ${userName} added "${product.title}" to their favorites.`,
                                image: firstImage, // 🟢 Large Product Banner Image
                                url: `/products/${productId}`,
                                type: "product_favorite"
                            });
                        }
                    }
                } catch (favErr) {
                    console.warn("Favorite notification dispatch error:", favErr.message);
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
        res.json({ isFavorite: rows.length > 0 });
    } catch (error) {
        res.status(200).json({ isFavorite: false });
    }
};

// ==============================================================
// 🟢 4. TOGGLE FOLLOW SUPPLIER (DIRECT DUAL NOTIFICATIONS)
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
            // UNFOLLOW
            await socialConnection.query("DELETE FROM supplier_followers WHERE id = ?", [existing[0].id]);
            await db.suppliers.query(
                "UPDATE suppliers SET followers_count = GREATEST(0, followers_count - 1) WHERE id = ?", 
                [supplierId]
            );
            isFollowing = false;
        } else {
            // FOLLOW
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

        // 🟢 5. ASYNC NOTIFICATIONS DISPATCH
        setImmediate(async () => {
            try {
                // Fetch User & Supplier Details
                const [userRows] = await db.users.query("SELECT full_name, profile_pic FROM users WHERE id = ?", [userId]);
                const [supRows] = await db.suppliers.query("SELECT brand_name, full_name, profile_pic FROM suppliers WHERE id = ?", [supplierId]);

                const user = userRows[0] || { full_name: "Valued Customer", profile_pic: null };
                const supplier = supRows[0] || { brand_name: "SJ10 Store", profile_pic: null };

                const userDp = user.profile_pic || "https://www.sj10.pk/default-avatar.png";
                const storeLogo = supplier.profile_pic || "https://www.sj10.pk/default-store.png";
                const storeName = supplier.brand_name || supplier.full_name || "SJ10 Store";
                const userName = user.full_name || "A Customer";

                if (isFollowing) {
                    // A. Direct Ping to Supplier Backend (With User DP)
                    notifySupplierDirect({
                        supplierId: supplierId,
                        title: "👤 New Store Follower",
                        body: `Dear ${storeName}, ${userName} started following your shop.`,
                        image: userDp,
                        url: "/social/followers",
                        type: "new_follower"
                    });

                    // B. Send Push to Customer via Order Backend (With Store Logo)
                    notifyCustomer(
                        userId,
                        "🏪 Store Followed",
                        `Dear ${userName}, you started following "${storeName}". You'll receive updates on their latest products!`,
                        storeLogo
                    );

                } else {
                    // Unfollow Notice to Supplier Backend
                    notifySupplierDirect({
                        supplierId: supplierId,
                        title: "⚠️ Store Unfollowed",
                        body: `Dear ${storeName}, ${userName} unfollowed your shop.`,
                        image: userDp,
                        url: "/social/followers",
                        type: "unfollow"
                    });

                    // Unfollow Notice to Customer
                    notifyCustomer(
                        userId,
                        "👋 Store Unfollowed",
                        `Dear ${userName}, you unfollowed "${storeName}".`,
                        storeLogo
                    );
                }
            } catch (asyncErr) {
                console.warn("Async Follow Notification Error:", asyncErr.message);
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