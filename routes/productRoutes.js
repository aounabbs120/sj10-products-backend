const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const reviewController = require('../controllers/reviewController');
const authenticateUser = require('../middleware/authenticateUser');

// --- HOMEPAGE & STATIC DATA ---
// Add near the top of the file
router.get('/search', productController.getSearchResults);         // 🚨 YEH LINE MISSING THI!
router.get('/search-results', productController.getSearchResults); // 🚨 Dono add kar diye
router.get('/suggestions-text', productController.getSearchSuggestionsText);
router.get('/suggestions', productController.getSearchSuggestions);
router.get('/google-shopping-master.xml', productController.getGoogleShoppingMasterFeed);
router.get('/sitemap-count', productController.getSitemapCount);
router.get('/shopping-feed', productController.getGoogleShoppingProducts);
router.get('/homepage-data', productController.getHomepageData);
router.get('/sitemap-urls', productController.getSitemapUrls);
router.get('/category-rows', productController.getCategoryRows);
router.get('/categories-with-subcategories', productController.getCategoriesWithSubcategories);
router.get('/active-timer', productController.getActivePromotionalTimer);
router.get('/homepage-categories', productController.getHomepageCategories);
router.get('/sitemap-search.xml', productController.getSearchSitemap);
// REAL-TIME ROUTES
// routes/productRoutes.js

// New lightweight route for Product Cards (Daraz Style)
// It handles shard-specific or global requests with strict pagination
router.get('/feed-cards', productController.getProductCards);
router.get('/latest-realtime', productController.getLatestProductsRealTime);

// --- EXPLORE & SEARCH ---
router.get('/explore-feed', productController.getExploreFeed);

router.get('/popular', productController.getPopularProducts);
router.get('/banners', productController.getBanners);
router.get('/strip-banners', productController.getActiveStripBanners);
// --- CATEGORY ---
router.get('/category/:slug', productController.getProductsByCategorySlug);
router.get('/:id/stats', productController.getProductStats);
// --- SINGLE PRODUCT ROUTES (THE FIX) ---

// 1. Matches: /api/products/slug/bike-cover--12
router.get('/slug/:slug', productController.getProductBySlug);

// 2. Matches: /api/products/bike-cover--12  (Fallback if frontend omits /slug/)
// 🔥 CHANGE: Point this to getProductBySlug too! It is smart enough to handle IDs or Slugs.
router.get('/:id', productController.getProductBySlug); 

// --- ACTIONS ---
router.post('/:id/view', productController.incrementProductView);
router.get('/:productId/reviews', reviewController.getProductReviews);
router.post('/:productId/reviews', authenticateUser, reviewController.createReview);
router.get('/reviews/mine', authenticateUser, reviewController.getUserReviews);

module.exports = router;