const express = require('express');
const router = express.Router();
const InventoryController = require('../controllers/inventoryController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/transactions', InventoryController.createTransaction);
router.get('/transactions', InventoryController.getTransactions);

module.exports = router;