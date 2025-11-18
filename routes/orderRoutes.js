const express = require("express");
const router = express.Router();
const OrderController = require("../controllers/orderController");
const { authenticateToken } = require("../middleware/auth");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/rbac");

router.use(authenticateToken);

router.post(
  "/",
  requirePermission("orders", "create_order"),
  OrderController.createOrder
);
router.get(
  "/",
  requireAnyPermission(
    ["orders", "view_all_orders"],
    ["orders", "view_own_orders"]
  ),
  OrderController.getAllOrders
);
router.get(
  "/statistics",
  requirePermission("orders", "view_statistics"),
  OrderController.getOrderStatistics
);
router.get(
  "/:id",
  requireAnyPermission(
    ["orders", "view_all_orders"],
    ["orders", "view_own_orders"]
  ),
  OrderController.getOrderById
);
router.put(
  "/:id",
  requirePermission("orders", "edit_order"),
  OrderController.updateOrder
);
router.patch(
  "/:id/status",
  requirePermission("orders", "manage_order_status"),
  OrderController.updateOrderStatus
);
router.post(
  "/:id/cancel",
  requirePermission("orders", "edit_order"),
  OrderController.cancelOrder
);

module.exports = router;
