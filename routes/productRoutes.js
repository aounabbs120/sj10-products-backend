// user_backend/routes/productRoutes.js
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const reviewController = require('../controllers/reviewController');
const authenticateUser = require('../middleware/authenticateUser');

// ==========================================================
// 🚨 1. SITEMAP ROUTES (MUST BE AT THE VERY TOP OF FILE!)
// ==========================================================
router.get('/sitemap-search.xml', productController.getSearchSitemapIndex);
router.get('/sitemap-search-:page.xml', productController.getSearchSitemapChunk);
router.get('/sitemap-search-count', productController.getSearchSitemapCount);

// --- HOMEPAGE & STATIC DATA ---
router.get('/search', productController.getSearchResults);
router.get('/search-results', productController.getSearchResults);
router.get('/suggestions-text', productController.getSearchSuggestionsText);
router.get('/suggestions', productController.getSearchSuggestions);
router.get('/google-shopping-master.xml', productController.getGoogleShoppingMasterFeed);
router.get('/sitemap-count', productController.getSitemapCount);
router.get('/shopping-feed', productController.getGoogleShoppingProducts);

// 🟢 HOMEPAGE ROUTES (Dono Support Kardiye Hain)
router.get('/homepage-data', productController.getHomepageData);
router.get('/homepage-master', productController.getHomepageData); // Alias Added!

router.get('/sitemap-urls', productController.getSitemapUrls);
router.get('/category-rows', productController.getCategoryRows);
router.get('/categories-with-subcategories', productController.getCategoriesWithSubcategories);
router.get('/active-timer', productController.getActivePromotionalTimer);
router.get('/homepage-categories', productController.getHomepageCategories);

// REAL-TIME ROUTES
router.get('/feed-cards', productController.getProductCards);
router.get('/latest-realtime', productController.getLatestProductsRealTime);

// --- EXPLORE & SEARCH ---
router.get('/explore-feed', productController.getExploreFeed);
router.get('/popular', productController.getPopularProducts);
router.get('/banners', productController.getBanners);
router.get('/strip-banners', productController.getActiveStripBanners);
router.get('/vertical-banners', productController.getVerticalBanners);

// --- CATEGORY ---
router.get('/category/:slug', productController.getProductsByCategorySlug);
router.get('/:id/stats', productController.getProductStats);

// --- SINGLE PRODUCT ROUTES (FIXED :slug PARAMETER) ---

// 1. Matches: /api/products/slug/bike-cover--12
router.get('/slug/:slug', productController.getProductBySlug);

// 2. Matches: /api/products/bike-cover--12
// 🟢 FIX: Changed :id to :slug so req.params.slug is defined!
router.get('/:slug', productController.getProductBySlug); 

// --- ACTIONS ---
router.post('/:id/view', productController.incrementProductView);
router.get('/:productId/reviews', reviewController.getProductReviews);
router.post('/:productId/reviews', authenticateUser, reviewController.createReview);
router.get('/reviews/mine', authenticateUser, reviewController.getUserReviews);

module.exports = router;