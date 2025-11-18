const express = require("express");
const router = express.Router();
const {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  getSupplierTransactions,
  updateSupplier,
  deleteSupplier,
} = require("../controllers/supplierController");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

// All routes require authentication
router.use(authenticateToken);

// Supplier CRUD routes
router.post(
  "/",
  requirePermission("suppliers", "create_supplier"),
  createSupplier
);
router.get(
  "/",
  requirePermission("suppliers", "view_suppliers"),
  getAllSuppliers
);
router.get(
  "/:id",
  requirePermission("suppliers", "view_suppliers"),
  getSupplierById
);
router.put(
  "/:id",
  requirePermission("suppliers", "edit_supplier"),
  updateSupplier
);
router.delete(
  "/:id",
  requirePermission("suppliers", "delete_supplier"),
  deleteSupplier
);

// Additional routes
router.get(
  "/:id/transactions",
  requirePermission("suppliers", "view_supplier_transactions"),
  getSupplierTransactions
);

module.exports = router;
