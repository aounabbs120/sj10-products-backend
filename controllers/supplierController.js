const db = require('../config/database');

// api/controllers/supplierController.js

exports.getSupplierById = async (req, res) => {
    try {
        const { supplierId } = req.params;
        
        // Fetch Supplier Details including the new stats
        const [rows] = await db.suppliers.query(
            "SELECT id, name, profile_pic, followers_count, average_rating, total_reviews, verified_status, total_products FROM suppliers WHERE id = ?", 
            [supplierId]
        );

        if (rows.length === 0) return res.status(404).json({ message: "Supplier not found." });

        const supplier = rows[0];

        // Check if current user is following (Optional, if you have auth)
        let isFollowing = false;
        if (req.user) {
            // Check follow status logic here if needed
        }

        res.json({
            ...supplier,
            isFollowing // Add logic for this if needed
        });

    } catch (error) {
        res.status(500).json({ message: "Error fetching supplier" });
    }
};