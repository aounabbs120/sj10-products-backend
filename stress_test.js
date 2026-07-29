import http from 'k6/http';
import { sleep, check } from 'k6';

// --- ⚙️ CONFIGURATION (Surgical Stress Test - 500 Virtual Users) ---
export const options = {
    stages: [
        { duration: '30s', target: 50 },  // 1. Pehle 30s mein 50 users
        { duration: '1m', target: 200 },  // 2. Aglay 1m mein 200 users
        { duration: '2m', target: 500 },  // 3. Aglay 2m mein 500 users (Direct DB Attack!)
        { duration: '30s', target: 0 },   // 4. Cooldown
    ],
    thresholds: {
        http_req_failed: ['rate<0.05'], // 95% success rate limit
    },
};

// 🚨 Direct IP to bypass Cloudflare
const BASE_URL = 'http://129.154.42.80/api'; 

const params = {
    headers: {
        'Host': 'api.sj10.pk',
        'Content-Type': 'application/json'
    }
};

// Helper: Generate Random String to force 100% Cache Miss on Redis!
function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export default function () {
    const rand = Math.random();
    const randomQuery = generateRandomString(5); // Generates words like 'abcde', 'xyzqp'

    if (rand < 0.50) {
        // ==========================================
        // 🚨 50% Users: Real-time Search on Meilisearch (No Cache!)
        // ==========================================
        const res = http.get(`${BASE_URL}/products/search?q=${randomQuery}`, params);
        check(res, {
            'Meili Search OK (200)': (r) => r.status === 200,
        });
    } else {
        // ==========================================
        // 🚨 50% Users: Postgres DB ILIKE Query on 27,000 Rows (No Cache!)
        // ==========================================
        const res = http.get(`${BASE_URL}/explore?page=1&search=${randomQuery}`, params);
        check(res, {
            'Postgres ILIKE OK (200)': (r) => r.status === 200,
        });
    }

    // High speed interval (Zero delay to push the CPU!)
    sleep(0.5); 
}