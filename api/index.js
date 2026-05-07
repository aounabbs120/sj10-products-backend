require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');

// Routes Import
const productRoutes = require('../routes/productRoutes');
const supplierRoutes = require('../routes/supplierRoutes');
const socialRoutes = require('../routes/socialRoutes');
const uploadRoutes = require('../routes/uploadRoutes');
const internalRoutes = require('../routes/internalRoutes');
const cjWorkerRoutes = require('../routes/cjWorkerRoutes'); 
const app = express();

// ==========================================================
// 🟢 START: SMART CORS POLICY (THE MAIN FIX)
// ==========================================================

// Ye safe list hai. Sirf in URLs se aane wali requests ko data milega.
const allowedOrigins = [
  'http://localhost:3000', 
  'http://localhost:3001',   // Aapka Local PC (for development)
  'https://www.sj10.pk',      // Aapki Live Website (with www)
  'https://sj10.pk'           // Aapki Live Website (without www)
];

app.use(cors({
  origin: function (origin, callback) {
    // Agar request in safe URLs se aa rahi hai, ya server se hi internally aa रही है (e.g., for testing), toh ijaazat hai.
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true); // Permission Granted ✅
    } else {
      // Agar kisi aur jagah se request aa rahi hai, toh block kar do.
      console.warn(`CORS Blocked: Request from origin "${origin}" was denied.`);
      callback(new Error('Not allowed by CORS')); // Permission Denied ❌
    }
  }
}));

// ==========================================================
// 🟢 END: SMART CORS POLICY
// ==========================================================


// Middleware
app.use(express.json());
app.use(compression()); // Gzip compression for speed

// Routes Mounting
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/cj-worker', cjWorkerRoutes); 


// Health Check
app.get('/', (req, res) => {
    res.json({ status: "SJ10 Products Service is Running 🚀" });
});

// Export for Vercel
module.exports = app;

// ---------------------------------------------------------
// 🚀 ADDED FOR LOCALHOST TESTING 🚀
// This part runs ONLY when you run "node api/index.js" locally
// ---------------------------------------------------------
if (require.main === module) {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
        console.log(`\n🚀 Server is running locally on: http://localhost:${PORT}`);
        console.log(`👉 Test Health Check: http://localhost:${PORT}/`);
        console.log(`👉 Test Products:     http://localhost:${PORT}/api/products`);
    });
}