const express = require("express");
const router = express.Router();
const InventoryController = require("../controllers/inventoryController");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

router.use(authenticateToken);

router.post(
  "/transactions",
  requirePermission("inventory", "create_transaction"),
  InventoryController.createTransaction
);
router.get(
  "/transactions",
  requirePermission("inventory", "view_inventory"),
  InventoryController.getTransactions
);

module.exports = router;
