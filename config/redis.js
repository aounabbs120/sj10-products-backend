// config/redis.js
const redis = require('redis');
require('dotenv').config();

const client = redis.createClient({
    url: process.env.REDIS_URL
});

client.on('error', (err) => console.error('🔴 [REDIS] Error:', err.message));
client.on('connect', () => console.log('⚡ Connected to Centralized Redis Successfully!'));

// Smart Wrapper: Localhost par testing ke waqt Cache Read ko Bypass karein
const originalGet = client.get.bind(client);
client.get = async (key) => {
    if (process.env.DISABLE_REDIS === 'true') {
        return null; // Forces 100% DB fresh hits on localhost!
    }
    return await originalGet(key);
};

// 🚨 NEW HACK: Bypass Cache Writing during local testing
const originalSetEx = client.setEx.bind(client);
client.setEx = async (key, seconds, value) => {
    if (process.env.DISABLE_REDIS === 'true') {
        return 'OK'; // Skip writing to Redis during local testing
    }
    return await originalSetEx(key, seconds, value);
};

// 🚨 NEW HACK: Bypass Hash Writing during local testing
const originalHSet = client.hSet ? client.hSet.bind(client) : null;
if (originalHSet) {
    client.hSet = async (key, field, value) => {
        if (process.env.DISABLE_REDIS === 'true') {
            return 1; // Skip writing to Redis
        }
        return await originalHSet(key, field, value);
    };
}

(async () => {
    try { await client.connect(); } 
    catch (e) { console.error('🔴 Redis connection failed:', e.message); }
})();

module.exports = client;