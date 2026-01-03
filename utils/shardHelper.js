const { clients } = require('../config/tursoConnection');
const db = require('../config/database');

// Returns the correct Turso Client based on Category ID
exports.getClientForCategory = async (categoryId) => {
    try {
        const [rows] = await db.inventory.query("SELECT db_shard FROM categories WHERE id = ?", [categoryId]);
        if (rows.length === 0) return clients.shard_general;
        return clients[rows[0].db_shard] || clients.shard_general;
    } catch (error) {
        return clients.shard_general;
    }
};

// Queries ALL shards (Used for Search/Global feeds)
exports.queryAllShards = async (sql, args = []) => {
    const shardKeys = Object.keys(clients);
    const promises = shardKeys.map(async (key) => {
        try {
            const result = await clients[key].execute({ sql, args });
            return result.rows;
        } catch (e) { return []; }
    });
    const results = await Promise.all(promises);
    return results.flat();
};