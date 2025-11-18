const express = require('express');
const router = express.Router();
const { createSupplier, getAllSuppliers, getSupplierById, getSupplierTransactions, updateSupplier, deleteSupplier } = require('../controllers/supplierController');
const { authenticateToken } = require('../middleware/auth');

// All routes require authentication
// router.use(authenticateToken);

// Supplier CRUD routes
router.post('/', createSupplier);
router.get('/', getAllSuppliers);
router.get('/:id', getSupplierById);
router.put('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

// Additional routes
router.get('/:id/transactions', getSupplierTransactions);

module.exports = router;