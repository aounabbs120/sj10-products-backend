const db = require('../config/database');
const { clients } = require('../config/tursoConnection');
const axios = require('axios');

// Helper to get product info
const getProductFromTurso = async (productId) => {
    const promises = Object.values(clients).map(async (client) => {
        try {
            const res = await client.execute({ sql: "SELECT title, supplier_id FROM products WHERE id = ?", args: [productId] });
            return res.rows[0];
        } catch (e) { return null; }
    });
    const results = await Promise.all(promises);
    return results.find(r => r); 
};

exports.getProductReviews = async (req, res) => {
    try {
        const [reviews] = await db.reviews.query(
            "SELECT rating, comment, user_name, created_at, image_urls FROM reviews WHERE product_id = ? ORDER BY created_at DESC", 
            [req.params.productId]
        );
        
        const parsedReviews = reviews.map(r => ({
            ...r,
            image_urls: r.image_urls ? JSON.parse(r.image_urls) : []
        }));

        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=10');
        res.status(200).json(parsedReviews);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch reviews." });
    }
};

// --- UPDATED: Fetch reviews with order_id ---
exports.getUserReviews = async (req, res) => {
    try {
        const userId = req.user.id;
        // ✅ Added order_id to select
        const [rows] = await db.reviews.query(
            "SELECT * FROM reviews WHERE user_id = ? ORDER BY created_at DESC",
            [userId]
        );
        
        const reviews = rows.map(r => ({
            ...r,
            image_urls: r.image_urls ? JSON.parse(r.image_urls) : []
        }));

        res.json(reviews);
    } catch (error) {
        console.error("Get User Reviews Error:", error);
        res.status(500).json({ message: "Error fetching reviews" });
    }
};

// --- UPDATED: Save review with order_id ---
exports.createReview = async (req, res) => {
    const reviewsConnection = await db.reviews.getConnection();
    const suppliersConnection = await db.suppliers.getConnection();

    try {
        const userId = req.user.id;
        const { productId } = req.params;
        
        // ✅ Get orderId from body
        const { rating, comment, userName, image_url, orderId } = req.body; 

        if (!rating) return res.status(400).json({ message: "Rating required." });

        const productInfo = await getProductFromTurso(productId);
        if (!productInfo) return res.status(404).json({ message: "Product not found." });

        const { title: productName, supplier_id: supplierId } = productInfo;

        await reviewsConnection.beginTransaction();
        await suppliersConnection.beginTransaction();

        // ✅ Insert with order_id
        await reviewsConnection.execute(
            "INSERT INTO reviews (product_id, supplier_id, user_id, rating, comment, user_name, image_urls, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())",
            [productId, supplierId, userId, rating, comment, userName || 'User', image_url || null, orderId || null]
        );

        const [stats] = await reviewsConnection.query(
            "SELECT COUNT(*) as total, AVG(rating) as average FROM reviews WHERE supplier_id = ?",
            [supplierId]
        );
        
        await suppliersConnection.execute(
            "UPDATE suppliers SET total_reviews = ?, average_rating = ? WHERE id = ?",
            [stats[0].total, parseFloat(stats[0].average || 0).toFixed(1), supplierId]
        );

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

        if (process.env.SUPPLIER_BACKEND_URL) {
            let firstImage = null;
            try {
                const imgs = JSON.parse(image_url);
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
            .catch(e => console.log("Notify failed:", e.message));
        }

        res.status(201).json({ message: "Review submitted." });

    } catch (error) {
        if(reviewsConnection) await reviewsConnection.rollback();
        if(suppliersConnection) await suppliersConnection.rollback();
        console.error("Review Submit Error:", error);
        res.status(500).json({ message: "Failed to submit review." });
    } finally {
        reviewsConnection.release();
        suppliersConnection.release();
    }
};