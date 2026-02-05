require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');

// Routes Import
const productRoutes = require('../routes/productRoutes');
const supplierRoutes = require('../routes/supplierRoutes');
const socialRoutes = require('../routes/socialRoutes');
const uploadRoutes = require('../routes/uploadRoutes'); // <--- ADD THIS
const internalRoutes = require('../routes/internalRoutes'); // 👈 IMPORT THIS
const app = express();

// Middleware
app.use(cors()); 
app.use(express.json());
app.use(compression()); // Gzip compression for speed

// Routes Mounting
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/upload', uploadRoutes); // <--- ADD THIS
app.use('/api/internal', internalRoutes); // 👈 MOUNT THIS

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