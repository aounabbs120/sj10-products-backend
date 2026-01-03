require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');

// Routes Import
const productRoutes = require('../routes/productRoutes');
const supplierRoutes = require('../routes/supplierRoutes');
const socialRoutes = require('../routes/socialRoutes');

const app = express();

// Middleware
app.use(cors()); 
app.use(express.json());
app.use(compression()); // Gzip compression for speed

// Routes Mounting
app.use('/api/products', productRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/social', socialRoutes);

// Health Check
app.get('/', (req, res) => {
    res.json({ status: "SJ10 Products Service is Running 🚀" });
});

// Export for Vercel
module.exports = app;