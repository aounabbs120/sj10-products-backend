require('dotenv').config();
const mysql = require('mysql2/promise');
const { Pool } = require('pg'); // Naya Postgres Driver
const { URL } = require('url');

// --- Helper for MySQL Pools (TiDB) ---
const createMysqlPool = (connectionUrl) => {
    if (!connectionUrl) return null;
    try {
        const url = new URL(connectionUrl);
        return mysql.createPool({
            host: url.hostname,
            user: url.username,
            password: url.password,
            database: url.pathname.substring(1),
            port: url.port || 4000,
            ssl: { rejectUnauthorized: true },
            waitForConnections: true,
            connectionLimit: 5,
            enableKeepAlive: true
        });
    } catch (error) {
        console.error(`🔴 MySQL Config Error:`, error.message);
        return null;
    }
};

const pools = {
    // 🟢 1. NAYA ORACLE POSTGRES POOL (Sirf is line ko note karein)
    oracle: new Pool({
        connectionString: process.env.DB_ORACLE_PRODUCTS_URL,
        ssl: false
    }),

    // 🟡 2. PURANE MYSQL POOLS (Categories/Banners/Suppliers)
    inventory: createMysqlPool(process.env.DB_INVENTORY_URL),
    suppliers: createMysqlPool(process.env.DB_SUPPLIERS_URL),
    reviews: createMysqlPool(process.env.DB_REVIEWS_URL),
    db_social: createMysqlPool(process.env.DB_SOCIAL_URL),
    users: createMysqlPool(process.env.DB_USERS_URL)
};

module.exports = pools;