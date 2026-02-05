// api/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/uploadController');
const authenticateUser = require('../middleware/authenticateUser');

// Configure Multer (Store in RAM so Sharp can process it immediately)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB input limit (we compress it down anyway)
});

// Route: POST /api/upload/review-images
// Expects: 'images' (array of files), 'productId', 'orderId'
router.post(
    '/review-images', 
    authenticateUser, // Ensure user is logged in
    upload.array('images', 3), // Max 3 images
    uploadController.uploadReviewImages
);

module.exports = router;