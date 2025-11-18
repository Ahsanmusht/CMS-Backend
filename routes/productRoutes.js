const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/productController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', ProductController.createProduct);
router.get('/', ProductController.getAllProducts);
router.get('/low-stock', ProductController.getLowStockProducts);
router.get('/inventory-report', ProductController.getInventoryReport);
router.get('/:id', ProductController.getProductById);
router.put('/:id', ProductController.updateProduct);
router.delete('/:id', ProductController.deleteProduct);
router.get('/:id/stock-history', ProductController.getProductStockHistory);

module.exports = router;