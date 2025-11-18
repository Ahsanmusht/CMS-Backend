const express = require('express');
const router = express.Router();
const SalaryController = require('../controllers/salaryController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', SalaryController.createSalary);
router.get('/', SalaryController.getAllSalaries);
router.get('/report', SalaryController.getSalaryReport);
router.post('/:id/pay', SalaryController.paySalary);

module.exports = router;