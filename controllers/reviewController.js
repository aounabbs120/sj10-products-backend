const db = require('../config/database');
const { clients } = require('../config/tursoConnection');
const axios = require('axios');

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
            "SELECT rating, comment, user_name, created_at, image_url FROM reviews WHERE product_id = ? ORDER BY created_at DESC", 
            [req.params.productId]
        );
        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=10');
        res.status(200).json(reviews);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch reviews." });
    }
};

exports.createReview = async (req, res) => {
    const reviewsConnection = await db.reviews.getConnection();
    const suppliersConnection = await db.suppliers.getConnection();

    try {
        const userId = req.user.id;
        const { productId } = req.params;
        const { rating, comment, image_url, userName } = req.body; // userName passed from frontend

        if (!rating) return res.status(400).json({ message: "Rating required." });

        // Note: We cannot check DB_ORDERS here because it's in a different service.
        // We trust the frontend to only show "Review" button if purchased, 
        // or you can make an API call to Orders Service to verify.
        
        const productInfo = await getProductFromTurso(productId);
        if (!productInfo) return res.status(404).json({ message: "Product not found." });

        const { title: productName, supplier_id: supplierId } = productInfo;

        await reviewsConnection.beginTransaction();
        await suppliersConnection.beginTransaction();

        await reviewsConnection.execute(
            "INSERT INTO reviews (product_id, supplier_id, user_id, rating, comment, user_name, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [productId, supplierId, userId, rating, comment, userName || 'User', image_url || null]
        );

        const [stats] = await reviewsConnection.query(
            "SELECT COUNT(*) as total, AVG(rating) as average FROM reviews WHERE supplier_id = ?",
            [supplierId]
        );
        
        await suppliersConnection.execute(
            "UPDATE suppliers SET total_reviews = ?, average_rating = ? WHERE id = ?",
            [stats[0].total, parseFloat(stats[0].average || 0).toFixed(1), supplierId]
        );

        await reviewsConnection.commit();
        await suppliersConnection.commit();

        // Notify Supplier via Internal API
        if (process.env.SUPPLIER_BACKEND_URL) {
            axios.post(`${process.env.SUPPLIER_BACKEND_URL}/api/internal/notify/new-review`, {
                supplierId, productName, rating, user_name: userName
            }, { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } }).catch(e => console.log("Notify failed"));
        }

        res.status(201).json({ message: "Review submitted." });

    } catch (error) {
        await reviewsConnection.rollback();
        await suppliersConnection.rollback();
        res.status(500).json({ message: "Failed." });
    } finally {
        reviewsConnection.release();
        suppliersConnection.release();
    }
};