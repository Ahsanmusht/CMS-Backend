const express = require("express");
const router = express.Router();
const EmployeeController = require("../controllers/employeeController");
const { authenticateToken } = require("../middleware/auth");
const {
  requirePermission,
  requireAllPermissions,
} = require("../middleware/rbac");

router.use(authenticateToken);

router.post(
  "/",
  requirePermission("employees", "create_employee"),
  EmployeeController.createEmployee
);
router.get(
  "/",
  requirePermission("employees", "view_employees"),
  EmployeeController.getAllEmployees
);
router.get(
  "/:id",
  requirePermission("employees", "view_employees"),
  EmployeeController.getEmployeeById
);
router.put(
  "/:id",
  requirePermission("employees", "edit_employee"),
  EmployeeController.updateEmployee
);
router.post(
  "/:id/terminate",
  requireAllPermissions(
    ["employees", "edit_employee"],
    ["employees", "terminate_employee"]
  ),
  EmployeeController.terminateEmployee
);
router.get(
  "/:id/salaries",
  requirePermission("employees", "view_salary_info"),
  EmployeeController.getEmployeeSalaries
);

module.exports = router;
