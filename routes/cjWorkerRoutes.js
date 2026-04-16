const express = require('express');
const router = express.Router();
const controller = require('../controllers/cjWorkerController');

// Oracle hit maarega is link pe
router.get('/trigger-sync', controller.runAutoUpdate);

module.exports = router;