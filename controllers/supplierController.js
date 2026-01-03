const db = require('../config/database');

exports.getSupplierById = async (req, res) => {
    try {
        const { supplierId } = req.params;
        const userId = req.user ? req.user.id : null;

        const [supplierRows] = await db.suppliers.query(
            `SELECT id, brand_name, profile_pic, followers_count, average_rating, total_reviews, verified_status 
             FROM suppliers WHERE id = ?`, 
            [supplierId]
        );

        if (supplierRows.length === 0) return res.status(404).json({ message: "Supplier not found." });
        const supplierData = supplierRows[0];

        let isFollowing = false;
        if (userId) {
            const [followCheck] = await db.db_social.query(
                "SELECT 1 FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", 
                [userId, supplierId]
            );
            isFollowing = followCheck.length > 0;
        }

        res.status(200).json({
            ...supplierData,
            name: supplierData.brand_name,
            isFollowing
        });

    } catch (error) {
        res.status(500).json({ message: "Failed to fetch supplier." });
    }
};