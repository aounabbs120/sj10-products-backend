const db = require('../config/database');

exports.toggleFollowSupplier = async (req, res) => {
    let socialConn = null;
    let supplierConn = null;

    try {
        const userId = req.user.id;
        const { supplierId } = req.params;

        socialConn = await db.db_social.getConnection();
        supplierConn = await db.suppliers.getConnection();

        await socialConn.beginTransaction();
        await supplierConn.beginTransaction();

        const [existing] = await socialConn.query(
            "SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?",
            [userId, supplierId]
        );

        let isFollowing = false;

        if (existing.length > 0) {
            // Unfollow
            await socialConn.execute("DELETE FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", [userId, supplierId]);
            await supplierConn.execute("UPDATE suppliers SET followers_count = GREATEST(0, followers_count - 1) WHERE id = ?", [supplierId]);
            isFollowing = false;
        } else {
            // Follow
            await socialConn.execute("INSERT INTO supplier_followers (user_id, supplier_id) VALUES (?, ?)", [userId, supplierId]);
            await supplierConn.execute("UPDATE suppliers SET followers_count = followers_count + 1 WHERE id = ?", [supplierId]);
            isFollowing = true;
        }

        await socialConn.commit();
        await supplierConn.commit();

        res.status(200).json({ message: "Success", isFollowing });

    } catch (error) {
        if (socialConn) await socialConn.rollback();
        if (supplierConn) await supplierConn.rollback();
        res.status(500).json({ message: "Error" });
    } finally {
        if (socialConn) socialConn.release();
        if (supplierConn) supplierConn.release();
    }
};

exports.checkFollowStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const { supplierId } = req.params;
        const [existing] = await db.db_social.query("SELECT id FROM supplier_followers WHERE user_id = ? AND supplier_id = ?", [userId, supplierId]);
        res.status(200).json({ isFollowing: existing.length > 0 });
    } catch (error) {
        res.status(500).json({ isFollowing: false });
    }
};

exports.toggleFavoriteProduct = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.params;
        const [existing] = await db.db_social.query("SELECT id FROM product_favorites WHERE user_id = ? AND product_id = ?", [userId, productId]);
        let isFavorite = false;
        if (existing.length > 0) {
            await db.db_social.execute("DELETE FROM product_favorites WHERE id = ?", [existing[0].id]);
        } else {
            await db.db_social.execute("INSERT INTO product_favorites (user_id, product_id) VALUES (?, ?)", [userId, productId]);
            isFavorite = true;
        }
        res.status(200).json({ message: "Success", isFavorite });
    } catch (error) {
        res.status(500).json({ message: "Failed" });
    }
};

exports.getMyFavorites = async (req, res) => {
    try {
        const [favs] = await db.db_social.query("SELECT product_id FROM product_favorites WHERE user_id = ?", [req.user.id]);
        if (favs.length === 0) return res.status(200).json([]);
        const productIds = favs.map(f => f.product_id);
        
        // Note: This logic assumes you might need to query Turso here.
        // For now returning IDs, or you can use shardHelper to fetch full products.
        res.status(200).json(productIds); 
    } catch (error) {
        res.status(500).json({ message: "Failed" });
    }
};