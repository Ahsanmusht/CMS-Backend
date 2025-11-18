const express = require('express');
const router = express.Router();
const EmployeeController = require('../controllers/employeeController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', EmployeeController.createEmployee);
router.get('/', EmployeeController.getAllEmployees);
router.get('/:id', EmployeeController.getEmployeeById);
router.put('/:id', EmployeeController.updateEmployee);
router.post('/:id/terminate', EmployeeController.terminateEmployee);
router.get('/:id/salaries', EmployeeController.getEmployeeSalaries);

module.exports = router;