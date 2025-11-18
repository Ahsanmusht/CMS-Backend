const express = require("express");
const router = express.Router();
const BillController = require("../controllers/billController");
const { authenticateToken } = require("../middleware/auth");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/rbac");

router.use(authenticateToken);

router.post(
  "/",
  requirePermission("bills", "create_bill"),
  BillController.createBill
);
router.get(
  "/",
  requireAnyPermission(
    ["bills", "view_all_bills"],
    ["bills", "view_own_bills"]
  ),
  BillController.getAllBills
);
router.get(
  "/overdue",
  requireAnyPermission(
    ["bills", "view_all_bills"],
    ["bills", "view_own_bills"]
  ),
  BillController.getOverdueBills
);
router.get(
  "/report",
  requirePermission("bills", "view_reports"),
  BillController.getBillsReport
);
router.get(
  "/:id",
  requireAnyPermission(
    ["bills", "view_all_bills"],
    ["bills", "view_own_bills"]
  ),
  BillController.getBillById
);
router.put(
  "/:id",
  requirePermission("bills", "edit_bill"),
  BillController.updateBill
);
router.post(
  "/:id/payments",
  requirePermission("bills", "record_payment"),
  BillController.recordPayment
);
router.get(
  "/:id/payments",
  requireAnyPermission(
    ["bills", "view_all_bills"],
    ["bills", "view_own_bills"]
  ),
  BillController.getBillPayments
);

module.exports = router;
