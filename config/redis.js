const { createClient } = require('redis');

// Asli Redis client banayen, lekin usay batayen ke infinite reconnect NA kare
const realClient = createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: false // 🔥 Yeh line terminal ke infinite timeout error ko rokegi
    }
});

// Terminal mein anay wale faltu errors ko khamosh kar diya
realClient.on('error', () => {}); 

// 🛡️ Smart Wrapper: Agar Redis down ho toh backend ko safe rakhne ke liye
const safeClient = {
    isOpen: false,
    
    async connect() {
        try {
            await realClient.connect();
            this.isOpen = true;
            console.log("⚡ Connected to Centralized Redis Successfully!");
        } catch (e) {
            console.log("⚠️ Redis server is currently offline. App running smoothly in Bypass Mode (No Cache).");
            this.isOpen = false;
        }
    },

    async get(key) {
        if (!this.isOpen) return null;
        try { return await realClient.get(key); } catch(e) { return null; }
    },

    async setEx(key, time, value) {
        if (!this.isOpen) return null;
        try { return await realClient.setEx(key, time, value); } catch(e) { return null; }
    },

    async hGetAll(key) {
        if (!this.isOpen) return {};
        try { return await realClient.hGetAll(key); } catch(e) { return {}; }
    },

    async hGet(key, field) {
        if (!this.isOpen) return null;
        try { return await realClient.hGet(key, field); } catch(e) { return null; }
    },

    async hIncrBy(key, field, increment) {
        if (!this.isOpen) return 1;
        try { return await realClient.hIncrBy(key, field, increment); } catch(e) { return 1; }
    },

    async del(key) {
        if (!this.isOpen) return null;
        try { return await realClient.del(key); } catch(e) { return null; }
    }
};

// Start-up par connect karne ki koshish karega
safeClient.connect();

module.exports = safeClient;