const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');

// Your authentication middleware
const authenticateUser = require('../middleware/authenticateUser');

// --- Favorites Routes (Protected) ---
// Note: I am applying the 'authenticateUser' middleware to each route
router.get('/favorite/status/:productId', authenticateUser, socialController.checkFavoriteStatus);
router.post('/favorite/:productId', authenticateUser, socialController.toggleFavoriteProduct);
router.get('/favorites/me', authenticateUser, socialController.getMyFavorites);

// --- Follows Routes (Protected) ---
// This is the route that was causing the 404 error because of the wrong middleware name
router.get('/follow/status/:supplierId', authenticateUser, socialController.checkFollowStatus);
router.post('/follow/:supplierId', authenticateUser, socialController.toggleFollowSupplier);

module.exports = router;