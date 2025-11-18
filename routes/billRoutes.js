const express = require('express');
const router = express.Router();
const BillController = require('../controllers/billController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', BillController.createBill);
router.get('/', BillController.getAllBills);
router.get('/overdue', BillController.getOverdueBills);
router.get('/report', BillController.getBillsReport);
router.get('/:id', BillController.getBillById);
router.put('/:id', BillController.updateBill);
router.post('/:id/payments', BillController.recordPayment);
router.get('/:id/payments', BillController.getBillPayments);

module.exports = router;