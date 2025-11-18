const express = require("express");
const router = express.Router();
const ProductController = require("../controllers/productController");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

router.use(authenticateToken);

router.post(
  "/",
  requirePermission("products", "create_product"),
  ProductController.createProduct
);
router.get(
  "/",
  requirePermission("products", "view_products"),
  ProductController.getAllProducts
);
router.get(
  "/low-stock",
  requirePermission("products", "view_stock"),
  ProductController.getLowStockProducts
);
router.get(
  "/inventory-report",
  requirePermission("products", "view_stock"),
  ProductController.getInventoryReport
);
router.get(
  "/:id",
  requirePermission("products", "view_products"),
  ProductController.getProductById
);
router.put(
  "/:id",
  requirePermission("products", "edit_product"),
  ProductController.updateProduct
);
router.delete(
  "/:id",
  requirePermission("products", "delete_product"),
  ProductController.deleteProduct
);
router.get(
  "/:id/stock-history",
  requirePermission("products", "view_stock"),
  ProductController.getProductStockHistory
);

module.exports = router;
