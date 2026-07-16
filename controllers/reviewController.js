const db = require('../config/database');
const axios = require('axios');

// --- 🎯 HELPER: Get Product Info from Oracle (Instead of 12 Turso Shards) ---
const getProductFromOracle = async (productId) => {
    try {
        // Single fast query to Oracle Postgres
        const res = await db.oracle.query(
            "SELECT title, supplier_id FROM products WHERE id = $1 LIMIT 1", 
            [productId]
        );
        return res.rows[0];
    } catch (e) {
        console.error("🔴 Oracle Fetch Error in Reviews:", e.message);
        return null;
    }
};

// 1. GET PRODUCT REVIEWS
exports.getProductReviews = async (req, res) => {
    try {
        const { productId } = req.params;
        const [reviews] = await db.reviews.query(
            "SELECT id, rating, comment, user_name, created_at, image_urls, order_id FROM reviews WHERE product_id = ? ORDER BY created_at DESC", 
            [productId]
        );
        
        const parsedReviews = reviews.map(r => ({
            ...r,
            image_urls: typeof r.image_urls === 'string' ? JSON.parse(r.image_urls || '[]') : (r.image_urls || [])
        }));

        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=10');
        res.status(200).json(parsedReviews);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch reviews." });
    }
};

// 2. GET USER REVIEWS (For Profile Page)
exports.getUserReviews = async (req, res) => {
    try {
        const userId = req.user.id;
        const [rows] = await db.reviews.query(
            "SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC",
            [userId]
        );
        
        const reviews = rows.map(r => ({
            ...r,
            image_urls: typeof r.image_urls === 'string' ? JSON.parse(r.image_urls || '[]') : (r.image_urls || [])
        }));

        res.json(reviews);
    } catch (error) {
        res.status(500).json({ message: "Error fetching user reviews" });
    }
};

// 3. CREATE REVIEW (The Heavy Lifting Logic)
exports.createReview = async (req, res) => {
    const reviewsConnection = await db.reviews.getConnection();
    const suppliersConnection = await db.suppliers.getConnection();

    try {
        const userId = req.user.id;
        const { productId } = req.params;
        const { rating, comment, userName, image_url, orderId } = req.body; 

        if (!rating) return res.status(400).json({ message: "Rating is required." });

        // 🚨 STEP 1: Get Product Info from Oracle (Lightning Fast)
        const productInfo = await getProductFromOracle(productId);
        if (!productInfo) return res.status(404).json({ message: "Product not found in Oracle DB." });

        const { title: productName, supplier_id: supplierId } = productInfo;

        // Start Transactions on MySQL (TiDB)
        await reviewsConnection.beginTransaction();
        await suppliersConnection.beginTransaction();

        // 🚨 STEP 2: Insert Review into TiDB MySQL
        await reviewsConnection.execute(
            "INSERT INTO reviews (product_id, supplier_id, user_id, rating, comment, user_name, image_urls, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [productId, supplierId, userId, rating, comment, userName || 'User', image_url || '[]', orderId || null]
        );

        // 🚨 STEP 3: Update Supplier Overall Rating (MySQL)
        const [stats] = await reviewsConnection.query(
            "SELECT COUNT(*) as total, AVG(rating) as average FROM reviews WHERE supplier_id = ?",
            [supplierId]
        );
        
        await suppliersConnection.execute(
            "UPDATE suppliers SET total_reviews = ?, average_rating = ? WHERE id = ?",
            [stats[0].total, parseFloat(stats[0].average || 0).toFixed(1), supplierId]
        );

        // 🚨 STEP 4: Update Product Rating Stats (MySQL)
        const [prodStats] = await reviewsConnection.query(
            "SELECT COUNT(*) as total, AVG(rating) as average FROM reviews WHERE product_id = ?",
            [productId]
        );
        
        await reviewsConnection.execute(
            `INSERT INTO product_ratings (product_id, avg_rating, review_count) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE avg_rating = VALUES(avg_rating), review_count = VALUES(review_count)`,
            [productId, parseFloat(prodStats[0].average || 0).toFixed(1), prodStats[0].total]
        );

        await reviewsConnection.commit();
        await suppliersConnection.commit();

        // 🚨 STEP 5: Notify Supplier App (Async)
        if (process.env.SUPPLIER_BACKEND_URL) {
            let firstImage = null;
            try {
                const imgs = typeof image_url === 'string' ? JSON.parse(image_url) : image_url;
                if(Array.isArray(imgs) && imgs.length > 0) firstImage = imgs[0];
            } catch(e) {}

            axios.post(`${process.env.SUPPLIER_BACKEND_URL}/api/internal/notify/new-review`, {
                supplierId, 
                productId,
                productName, 
                rating, 
                user_name: userName,
                image: firstImage 
            }, { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } })
            .catch(e => console.log("Supplier Notification failed:", e.message));
        }

        res.status(201).json({ success: true, message: "Review submitted successfully." });

    } catch (error) {
        if(reviewsConnection) await reviewsConnection.rollback();
        if(suppliersConnection) await suppliersConnection.rollback();
        console.error("🔴 Review Submit Error:", error.message);
        res.status(500).json({ message: "Failed to submit review." });
    } finally {
        reviewsConnection.release();
        suppliersConnection.release();
    }
};