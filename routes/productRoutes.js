const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const reviewController = require('../controllers/reviewController');
const authenticateUser = require('../middleware/authenticateUser');

// --- HOMEPAGE & STATIC DATA ---
router.get('/homepage-data', productController.getHomepageData);
router.get('/category-rows', productController.getCategoryRows);
router.get('/categories-with-subcategories', productController.getCategoriesWithSubcategories);
router.get('/active-timer', productController.getActivePromotionalTimer);

// --- EXPLORE FEED (Dedicated Endpoint) ---
// ✅ FIX: This is the route for your infinite scroll section.
router.get('/explore-feed', productController.getExploreFeed);
router.get('/search-results', productController.getSearchResults); // For the results page
router.get('/suggestions-text', productController.getSearchSuggestionsText); // ✅ THIS LINE IS CRITICAL

router.get('/homepage-categories', productController.getHomepageCategories);
// --- OTHER PRODUCT ROUTES ---
router.get('/category/:slug', productController.getProductsByCategorySlug);
router.get('/slug/:slug', productController.getProductBySlug);
router.get('/suggestions', productController.getSearchSuggestions);
router.get('/:id', productController.getProductById);

// --- ACTIONS ---
router.post('/:id/view', productController.incrementProductView);
router.get('/:productId/reviews', reviewController.getProductReviews);
router.post('/:productId/reviews', authenticateUser, reviewController.createReview);
router.get('/reviews/mine', authenticateUser, reviewController.getUserReviews);


// Note: The generic '/' route is now handled by the explore feed,
// so it is removed to avoid conflict.
// router.get('/', productController.getAllProducts); // This can be removed or pointed to getExploreFeed

module.exports = router;