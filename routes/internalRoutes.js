// api/routes/internalRoutes.js
const express = require('express');
const router = express.Router();

// Middleware to check API Key
const verifyInternalKey = (req, res, next) => {
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey === process.env.INTERNAL_API_KEY) {
        next();
    } else {
        res.status(403).json({ message: 'Forbidden' });
    }
};

router.use(verifyInternalKey);

// ✅ ROUTE: Receive Order Updates from Supplier Watcher
router.post('/notify/order-update', (req, res) => {
    const { orderId, title, body, type } = req.body;
    
    console.log(`[Internal] Received Update for Order ${orderId}: ${title}`);
    
    // Here you can implement Logic to save notification to User DB if needed
    // For now, we return 200 OK so the Supplier Backend stops crashing.
    
    res.status(200).json({ message: "Update received" });
});

// ✅ ROUTE: Receive New Review Notification (If supplier sends one back)
router.post('/notify/new-review', (req, res) => {
    console.log("[Internal] Review Sync Received");
    res.status(200).json({ message: "Review sync received" });
});

module.exports = router;