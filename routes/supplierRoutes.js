const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');

router.get('/:supplierId', supplierController.getSupplierById);

module.exports = router;