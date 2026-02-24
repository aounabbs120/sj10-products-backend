const db = require('../config/database');

// api/controllers/supplierController.js

exports.getSupplierById = async (req, res) => {
    try {
        const { supplierId } = req.params;

        if (!db.suppliers) {
            return res.status(500).json({ message: "Database not configured." });
        }

        // ✅ FIXED QUERY: Explicitly Fetching 'total_products'
        const sqlQuery = `
            SELECT 
                id, 
                brand_name, 
                full_name, 
                profile_pic, 
                followers_count, 
                average_rating, 
                total_reviews, 
                verified_status, 
                total_products, 
                city
            FROM suppliers 
            WHERE id = ?
            LIMIT 1
        `;
        
        const [rows] = await db.suppliers.query(sqlQuery, [supplierId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: "Supplier not found." });
        }

        const supplier = rows[0];
        
        const responseData = {
            ...supplier,
            name: supplier.brand_name || supplier.full_name
        };
        
        // Caching on Server side to make it fast
        res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
        res.json(responseData);

    } catch (error) {
        console.error("🔴 [Backend] Database Error:", error.message);
        res.status(500).json({ message: "Server Error", error: error.message });
    }
};

exports.getAllSupplierIds = async (req, res) => {
    try {
        // Fetch all verified/active suppliers quickly
        const [rows] = await db.suppliers.query(
            "SELECT id FROM suppliers WHERE verified_status = 'verified' OR verified_status = '1'"
        );
        const ids = rows.map(r => r.id);
        res.json(ids);
    } catch (error) {
        console.error("Supplier Sitemap Error:", error);
        res.status(500).json([]);
    }
};