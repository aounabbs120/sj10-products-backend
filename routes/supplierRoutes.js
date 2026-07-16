const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');
router.get('/sitemap-urls', supplierController.getAllSupplierIds); 
router.get('/suppliers/search/discovery', supplierController.searchSuppliers);
router.get('/:supplierId', supplierController.getSupplierById);

module.exports = router;