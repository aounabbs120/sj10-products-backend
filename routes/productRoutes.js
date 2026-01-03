const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const reviewController = require('../controllers/reviewController');
const authenticateUser = require('../middleware/authenticateUser');

// --- 1. HOMEPAGE & STATIC DATA ---
router.get('/homepage-data', productController.getHomepageData);
router.get('/category-rows', productController.getCategoryRows);
router.get('/categories-with-subcategories', productController.getCategoriesWithSubcategories);
router.get('/active-timer', productController.getActivePromotionalTimer);

// --- 2. SPECIFIC PAGES ---
router.get('/category/:slug', productController.getProductsByCategorySlug);
router.get('/slug/:slug', productController.getProductBySlug);
router.get('/:id', productController.getProductById);

// --- 3. GENERIC SEARCH ---
router.get('/', productController.getAllProducts);

// --- 4. ACTIONS ---
router.post('/:id/view', productController.incrementProductView);
router.get('/:productId/reviews', reviewController.getProductReviews);
router.post('/:productId/reviews', authenticateUser, reviewController.createReview);

module.exports = router;