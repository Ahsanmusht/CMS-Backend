const express = require("express");
const router = express.Router();
const SalaryController = require("../controllers/salaryController");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

router.use(authenticateToken);

router.post(
  "/",
  requirePermission("salaries", "create_salary"),
  SalaryController.createSalary
);
router.get(
  "/",
  requirePermission("salaries", "view_salaries"),
  SalaryController.getAllSalaries
);
router.get(
  "/report",
  requirePermission("salaries", "view_reports"),
  SalaryController.getSalaryReport
);
router.post(
  "/:id/pay",
  requirePermission("salaries", "process_salary"),
  SalaryController.paySalary
);

module.exports = router;
