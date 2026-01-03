const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const authenticateUser = require('../middleware/authenticateUser');

router.use(authenticateUser);

router.post('/follow/:supplierId', socialController.toggleFollowSupplier);
router.get('/status/:supplierId', socialController.checkFollowStatus);
router.post('/favorite/:productId', socialController.toggleFavoriteProduct);
router.get('/favorites', socialController.getMyFavorites);

module.exports = router;