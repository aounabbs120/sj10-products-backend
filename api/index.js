require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Routes Import
const productRoutes = require('../routes/productRoutes');
const supplierRoutes = require('../routes/supplierRoutes');
const socialRoutes = require('../routes/socialRoutes');
const uploadRoutes = require('../routes/uploadRoutes');
const internalRoutes = require('../routes/internalRoutes');

const app = express();

// Enable trust proxy for accurate IP detection on Vercel & Nginx
app.set('trust proxy', 1);

// ==========================================================
// 🛡️ 1. AUTOMATED DYNAMIC IP BANNING SYSTEM (Memory-Based)
// ==========================================================
const bannedIPs = new Map(); // Stores banned IPs and unban timestamps

// Clean up expired bans every 30 minutes to free memory
setInterval(() => {
    const now = Date.now();
    for (const [ip, expiry] of bannedIPs.entries()) {
        if (now > expiry) bannedIPs.delete(ip);
    }
}, 30 * 60 * 1000);

// IP Ban Middleware
const checkIPBanList = (req, res, next) => {
    // 🚨 FIX: Cloudflare True-Client-IP prioritization
    const clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    if (bannedIPs.has(clientIP)) {
        const expiry = bannedIPs.get(clientIP);
        if (Date.now() < expiry) {
            console.warn(`🚨 [BANNED ACCESS ATTEMPT] Blocked IP: ${clientIP} on path: ${req.path}`);
            return res.status(403).json({ 
                error: "Your IP has been temporarily banned due to security policy violations." 
            });
        } else {
            bannedIPs.delete(clientIP); // Ban expired, remove from list
        }
    }
    next();
};
app.use(checkIPBanList);

// Function to manually trigger an IP Ban
const banIPAddress = (ip, reason, durationHours = 24) => {
    const expiryTime = Date.now() + (durationHours * 60 * 60 * 1000);
    bannedIPs.set(ip, expiryTime);
    console.error(`🚫 [IP BANNED] IP: ${ip} | Reason: ${reason} | Duration: ${durationHours} Hours`);
};

// ==========================================================
// 🛡️ 2. HELMET & ADVANCED SECURITY HEADERS
// ==========================================================
app.use(helmet({
    crossOriginResourcePolicy: false, // Prevents media loading blocks on frontend
}));

// ==========================================================
// 🤖 3. EXPLOIT SCANNER & BAD BOT BLOCKER (With Auto-Ban)
// ==========================================================
const exploitAndBotScanner = (req, res, next) => {
    // 🚨 FIX: Cloudflare True-Client-IP prioritization
    const clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const path = req.path.toLowerCase();

    // A. Detect Exploit Attempts (WordPress, PHP, Env files, SQL injection patterns)
    const maliciousPaths = /(\.env|wp-login|xmlrpc|wp-admin|select\s+count|union\s+select|eval\(|concat\()/i;
    
    if (maliciousPaths.test(path) || maliciousPaths.test(req.url)) {
        banIPAddress(clientIP, `Exploit scanning attempt on path: ${req.path}`, 24);
        return res.status(403).json({ error: "Access Denied. Malicious activity detected." });
    }

    // B. Detect Bad Scrapers & Bots (Allow Googlebot, Bingbot)
    const goodBots = /Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot/i;
    const badBots = /curl|wget|python|scrapy|httpx|postman|insomnia|libwww-perl|go-http-client|java/i;

    if (badBots.test(userAgent) && !goodBots.test(userAgent)) {
        // Auto-ban aggressive scrapers for 12 hours
        banIPAddress(clientIP, `Automated scraping tool: ${userAgent}`, 12);
        return res.status(403).json({ error: "Access denied. Automated scraping is prohibited." });
    }

    next();
};
app.use(exploitAndBotScanner);

// ==========================================================
// 📊 REAL-TIME PULSE-CHECK FOR MONITORING (P1 & P2 ONLY)
// ==========================================================
const os = require('os');
const { execSync } = require('child_process');

app.get('/api/internal/pulse-check', (req, res) => {
    // Security Key check
    if (req.headers['x-internal-api-key'] !== "Pakistanc456") {
        return res.status(403).send("Forbidden");
    }
    try {
        const disk = execSync("df -h / | tail -1 | awk '{print $2,$3,$4,$5}'").toString().trim().split(/\s+/);
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        res.json({
            cpu: `${os.loadavg()[0].toFixed(2)}%`,
            ram: {
                total: `${(totalMem / 1024/1024/1024).toFixed(2)} GB`,
                used: `${(usedMem / 1024/1024/1024).toFixed(2)} GB`,
                percent: Math.round((usedMem / totalMem) * 100)
            },
            disk: {
                total: disk[0] || 'N/A',
                used: disk[1] || 'N/A',
                available: disk[2] || 'N/A',
                percent: disk[3] || 'N/A'
            },
            uptime: `${(os.uptime() / 3600).toFixed(1)} Hours`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================
// 🚥 4. RATE LIMITER (With Auto-Ban for Spammers)
// ==========================================================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 requests per window
    handler: (req, res, next, options) => {
        // 🚨 FIX: Cloudflare True-Client-IP prioritization
        const clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
        // Ban the IP for 6 hours if they hit the limit continuously
        banIPAddress(clientIP, "API Rate limit exceeded (DDoS protection)", 6);
        res.status(429).json({ error: options.message });
    },
    message: "Too many requests from this IP, please try again after 15 minutes."
});
app.use('/api/', apiLimiter);

// ==========================================================
// 🟢 5. SMART CORS POLICY
// ==========================================================
const allowedOrigins = [
  'http://localhost:3000', 
  'http://localhost:3001',   
  'https://www.sj10.pk',      
  'https://sj10.pk'           
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true); 
    } else {
      console.warn(`CORS Blocked: Request from origin "${origin}" was denied.`);
      callback(new Error('Not allowed by CORS')); 
    }
  }
}));

// Middleware
app.use(express.json());
app.use(compression()); 

// Routes Mounting
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/internal', internalRoutes);

// Health Check
app.get('/', (req, res) => {
    res.json({ status: "SJ10 Products Service is Running & Heavily Secured 🚀🛡️" });
});

module.exports = app;

// Localhost server entry
if (require.main === module) {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
        console.log(`\n🚀 Server is running locally on: http://localhost:${PORT}`);
    });
}