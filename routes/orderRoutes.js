const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/orderController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', OrderController.createOrder);
router.get('/', OrderController.getAllOrders);
router.get('/statistics', OrderController.getOrderStatistics);
router.get('/:id', OrderController.getOrderById);
router.put('/:id', OrderController.updateOrder);
router.patch('/:id/status', OrderController.updateOrderStatus);
router.post('/:id/cancel', OrderController.cancelOrder);

module.exports = router;