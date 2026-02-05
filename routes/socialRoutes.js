const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const authenticateUser = require('../middleware/authenticateUser');

router.use(authenticateUser);

router.post('/follow/:supplierId', socialController.toggleFollowSupplier);
router.get('/status/:supplierId', socialController.checkFollowStatus);

// Favorites Routes
router.post('/favorite/:productId', socialController.toggleFavoriteProduct);
router.get('/favorite/status/:productId', socialController.checkFavoriteStatus);
router.get('/favorites', socialController.getMyFavorites); // <--- THIS MUST BE HERE

module.exports = router;