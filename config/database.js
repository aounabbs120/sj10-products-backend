require('dotenv').config();
const mysql = require('mysql2/promise');
const { URL } = require('url');
const fs = require('fs');

const createPool = (connectionUrl) => {
    if (!connectionUrl) {
        return null; // Fail silently if env is missing, but log it in real app
    }
    
    try {
        const url = new URL(connectionUrl);
        const config = {
            host: url.hostname,
            user: url.username,
            password: url.password,
            database: url.pathname.substring(1),
            port: url.port || 3306,
            ssl: { rejectUnauthorized: true },
            
            // ⚡ VERCEL OPTIMIZATION: Low connection limit ⚡
            waitForConnections: true,
            connectionLimit: 1, // Keep this low for Serverless
            queueLimit: 0,
            connectTimeout: 20000,
            enableKeepAlive: true
        };

        return mysql.createPool(config);

    } catch (error) {
        console.error(`🔴 DB Config Error`, error);
        return null;
    }
};

const pools = {
    inventory: createPool(process.env.DB_INVENTORY_URL),
    suppliers: createPool(process.env.DB_SUPPLIERS_URL),
    reviews: createPool(process.env.DB_REVIEWS_URL),
    db_social: createPool(process.env.DB_SOCIAL_URL)
};

module.exports = pools;