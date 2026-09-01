// controllers/socialController.js (Product Backend - Professional English & Strict Target Sync)
const db = require('../config/database');
const axios = require('axios');

let redis = null;
try {
    redis = require('../config/redis');
} catch (e) {}

const ORDERS_BACKEND_URL = (process.env.ORDERS_BACKEND_URL || 'https://orders.sj10.pk').replace(/\/$/, '');
const SUPPLIER_BACKEND_URL = (process.env.SUPPLIER_BACKEND_URL || 'https://sj1osupplierbackend1.vercel.app').replace(/\/$/, '');
const INTERNAL_API_KEY = (process.env.INTERNAL_API_KEY || 'Sj10_Internal_AounAbbas_!@2025_#_TopSecret').replace(/['"]/g, '').trim();

// ==============================================================
// ⚡ ASYNC NOTIFICATION DISPATCHER (STRICT TARGETED DELIVERY)
// ==============================================================
const sendSocialPushNotification = (payload) => {
    setImmediate(async () => {
        try {
            // A. Send to Specific Customer ONLY
            if (payload.recipientType === 'user') {
                await axios.post(`${ORDERS_BACKEND_URL}/api/internal/notify/broadcast`, {
                    userIds: [payload.recipientId], // Strict Target
                    title: payload.title,
                    body: payload.body,
                    url: payload.url || '/profile/followed-shops',
                    imageUrl: payload.image || null
                }, {
                    headers: { 'x-internal-api-key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
                    timeout: 6000
                });
                console.log(`✅ [User Push Sent] ${payload.recipientId}`);
            }

            // B. Send to Specific Supplier ONLY
            if (payload.recipientType === 'supplier' && SUPPLIER_BACKEND_URL) {
                await axios.post(`${SUPPLIER_BACKEND_URL}/api/internal/notify/supplier-alert`, {
                    supplierId: payload.recipientId, // Strict Target
                    title: payload.title,
                    body: payload.body,
                    url: payload.url || '/social/followers',
                    imageUrl: payload.image || null
                }, {
                    headers: { 'x-internal-api-key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
                    timeout: 6000
                }).catch(() => {});
                console.log(`✅ [Supplier Push Sent] ${payload.recipientId}`);
            }
        } catch (err) {
            console.warn(`⚠️ [Social Push Warning] Failed for ${payload.recipientId}:`, err.response?.data?.message || err.message);
        }
    });
};

// --- Helper: Fetch Products from Oracle ---
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

// 1. GET MY FAVORITES
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
// 🟢 2. TOGGLE PRODUCT FAVORITE (NOTIFIES SPECIFIC SUPPLIER IN ENGLISH)
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

            // Notify specific supplier only
            setImmediate(async () => {
                try {
                    const [userRows] = await db.users.query("SELECT full_name FROM users WHERE id = ?", [userId]);
                    const userName = userRows[0]?.full_name || "A Customer";

                    const products = await getProductsFromOracleByIds([productId]);
                    if (products.length > 0) {
                        const product = products[0];
                        const supplierId = product.supplier_id;

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
                            const supplierName = supRows[0]?.brand_name || supRows[0]?.full_name || "Partner";

                            // 🟢 PROFESSIONAL ENGLISH TEMPLATE
                            const notifTitle = "❤️ Product Added to Favorites";
                            const notifBody = `Dear ${supplierName}, ${userName} added "${product.title}" to their favorites.`;

                            await db.db_social.query(
                                `INSERT INTO notification_logs (id, recipient_id, recipient_type, title, body, action_url, image_url, type, is_read, created_at) 
                                 VALUES (UUID(), ?, 'supplier', ?, ?, ?, ?, 'favorite', 0, NOW())`,
                                [supplierId, notifTitle, notifBody, `/products/${productId}`, firstImage]
                            ).catch(() => {});

                            sendSocialPushNotification({
                                recipientId: supplierId,
                                recipientType: 'supplier',
                                title: notifTitle,
                                body: notifBody,
                                image: firstImage,
                                url: `/products/${productId}`
                            });
                        }
                    }
                } catch (favNotifErr) {}
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
// 🟢 4. TOGGLE FOLLOW SUPPLIER (STRICT DUAL ALERTS IN ENGLISH)
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

        // 🟢 ASYNC NOTIFICATIONS TO EXACT TARGETS
        setImmediate(async () => {
            try {
                if (redis) {
                    await redis.del(`supplier_followers_v3_${supplierId}`);
                }

                const [userRows] = await db.users.query("SELECT full_name, profile_pic FROM users WHERE id = ?", [userId]);
                const [supRows] = await db.suppliers.query("SELECT brand_name, full_name, profile_pic FROM suppliers WHERE id = ?", [supplierId]);

                const user = userRows[0] || { full_name: "Valued Customer", profile_pic: null };
                const supplier = supRows[0] || { brand_name: "SJ10 Store", profile_pic: null };

                const userDp = user.profile_pic || "https://www.sj10.pk/default-avatar.png";
                const storeLogo = supplier.profile_pic || "https://www.sj10.pk/default-store.png";
                const storeName = supplier.brand_name || supplier.full_name || "SJ10 Store";
                const userName = user.full_name || "Customer";

                if (isFollowing) {
                    // 🟢 PROFESSIONAL ENGLISH TEMPLATES (FOLLOW)
                    const supNotifTitle = "👤 New Store Follower";
                    const supNotifBody = `Dear ${storeName}, ${userName} started following your shop.`;

                    const userNotifTitle = "🏪 Store Followed";
                    const userNotifBody = `Dear ${userName}, you started following "${storeName}". You'll receive updates on their latest products!`;

                    // 1. Log in DB for Supplier
                    await db.db_social.query(
                        `INSERT INTO notification_logs (id, recipient_id, recipient_type, title, body, action_url, image_url, type, is_read, created_at) 
                         VALUES (UUID(), ?, 'supplier', ?, ?, '/social/followers', ?, 'social', 0, NOW())`,
                        [supplierId, supNotifTitle, supNotifBody, userDp]
                    ).catch(() => {});

                    // 2. Log in DB for User
                    await db.db_social.query(
                        `INSERT INTO notification_logs (id, recipient_id, recipient_type, title, body, action_url, image_url, type, is_read, created_at) 
                         VALUES (UUID(), ?, 'user', ?, ?, '/profile/followed-shops', ?, 'social', 0, NOW())`,
                        [userId, userNotifTitle, userNotifBody, storeLogo]
                    ).catch(() => {});

                    // 3. Send Push to Exact Supplier
                    sendSocialPushNotification({
                        recipientId: supplierId,
                        recipientType: 'supplier',
                        title: supNotifTitle,
                        body: supNotifBody,
                        image: userDp,
                        url: "/social/followers"
                    });

                    // 4. Send Push to Exact User
                    sendSocialPushNotification({
                        recipientId: userId,
                        recipientType: 'user',
                        title: userNotifTitle,
                        body: userNotifBody,
                        image: storeLogo,
                        url: "/profile/followed-shops"
                    });

                } else {
                    // 🟢 PROFESSIONAL ENGLISH TEMPLATES (UNFOLLOW)
                    const supUnfollowTitle = "⚠️ Store Unfollowed";
                    const supUnfollowBody = `Dear ${storeName}, ${userName} unfollowed your shop.`;

                    const userUnfollowTitle = "👋 Store Unfollowed";
                    const userUnfollowBody = `Dear ${userName}, you unfollowed "${storeName}".`;

                    // Log in DB for Supplier
                    await db.db_social.query(
                        `INSERT INTO notification_logs (id, recipient_id, recipient_type, title, body, action_url, image_url, type, is_read, created_at) 
                         VALUES (UUID(), ?, 'supplier', ?, ?, '/social/followers', ?, 'social', 0, NOW())`,
                        [supplierId, supUnfollowTitle, supUnfollowBody, userDp]
                    ).catch(() => {});

                    // Log in DB for User
                    await db.db_social.query(
                        `INSERT INTO notification_logs (id, recipient_id, recipient_type, title, body, action_url, image_url, type, is_read, created_at) 
                         VALUES (UUID(), ?, 'user', ?, ?, '/profile/followed-shops', ?, 'social', 0, NOW())`,
                        [userId, userUnfollowTitle, userUnfollowBody, storeLogo]
                    ).catch(() => {});

                    // Send Push to Exact Supplier
                    sendSocialPushNotification({
                        recipientId: supplierId,
                        recipientType: 'supplier',
                        title: supUnfollowTitle,
                        body: supUnfollowBody,
                        image: userDp,
                        url: "/social/followers"
                    });

                    // Send Push to Exact User
                    sendSocialPushNotification({
                        recipientId: userId,
                        recipientType: 'user',
                        title: userUnfollowTitle,
                        body: userUnfollowBody,
                        image: storeLogo,
                        url: "/profile/followed-shops"
                    });
                }
            } catch (asyncErr) {}
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