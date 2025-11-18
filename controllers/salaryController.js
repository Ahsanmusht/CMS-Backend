class SalaryController {
  // Create Salary Record
  static async createSalary(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        employee_id, salary_month, basic_salary, allowances,
        deductions, bonuses, overtime_pay, notes
      } = req.body;

      // Validate required fields
      if (!employee_id || !salary_month || !basic_salary) {
        throw new ErrorHandler('Employee ID, salary month, and basic salary are required', 400);
      }

      // Verify employee exists
      const [employee] = await connection.execute(
        'SELECT id, first_name, last_name FROM employees WHERE id = ? AND company_id = ? AND is_active = 1',
        [employee_id, req.query.company_id]
      );

      if (employee.length === 0) {
        throw new ErrorHandler('Employee not found or inactive', 404);
      }

      // Check for duplicate salary for the same month
      const [existingSalary] = await connection.execute(
        'SELECT id FROM salaries WHERE employee_id = ? AND salary_month = ? AND company_id = ?',
        [employee_id, Helpers.formatDate(salary_month), req.query.company_id]
      );

      if (existingSalary.length > 0) {
        throw new ErrorHandler('Salary for this month already exists', 409);
      }

      // Calculate totals
      const allowancesAmount = parseFloat(allowances || 0);
      const deductionsAmount = parseFloat(deductions || 0);
      const bonusesAmount = parseFloat(bonuses || 0);
      const overtimeAmount = parseFloat(overtime_pay || 0);

      const gross_salary = parseFloat(basic_salary) + allowancesAmount + bonusesAmount + overtimeAmount;
      const net_salary = gross_salary - deductionsAmount;

      const salaryData = {
        company_id: req.query.company_id,
        employee_id,
        salary_month: Helpers.formatDate(salary_month),
        basic_salary,
        allowances: allowancesAmount,
        deductions: deductionsAmount,
        bonuses: bonusesAmount,
        overtime_pay: overtimeAmount,
        gross_salary,
        net_salary,
        status: 'PENDING',
        notes: notes?.trim() || null,
        created_by: req.query.id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('salaries', salaryData);
      const [result] = await connection.execute(query, values);

      // Fetch created salary
      const [salary] = await connection.execute(
        `SELECT s.*,
         CONCAT(e.first_name, ' ', e.last_name) as employee_name,
         e.employee_code
         FROM salaries s
         LEFT JOIN employees e ON s.employee_id = e.id
         WHERE s.id = ?`,
        [result.insertId]
      );

      await connection.commit();
      return ResponseHandler.created(res, salary[0], 'Salary record created successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Salaries
  static async getAllSalaries(req, res) {
    try {
      const { page, limit, employee_id, status, month, year } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['s.company_id = ?'];
      let queryParams = [req.query.company_id];

      // Filters
      if (employee_id) {
        whereConditions.push('s.employee_id = ?');
        queryParams.push(employee_id);
      }

      if (status) {
        whereConditions.push('s.status = ?');
        queryParams.push(status);
      }

      if (month && year) {
        whereConditions.push('MONTH(s.salary_month) = ? AND YEAR(s.salary_month) = ?');
        queryParams.push(month, year);
      } else if (year) {
        whereConditions.push('YEAR(s.salary_month) = ?');
        queryParams.push(year);
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM salaries s WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch salaries
      const [salaries] = await db.execute(
        `SELECT s.*,
         CONCAT(e.first_name, ' ', e.last_name) as employee_name,
         e.employee_code, e.department, e.designation
         FROM salaries s
         LEFT JOIN employees e ON s.employee_id = e.id
         WHERE ${whereClause}
         ORDER BY s.salary_month DESC, s.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        salaries,
        { page: pageNum, limit: limitNum, total },
        'Salaries retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Pay Salary
  static async paySalary(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const salaryId = Helpers.validateId(req.params.id, 'Salary ID');
      const { payment_date, payment_method } = req.body;

      if (!payment_date || !payment_method) {
        throw new ErrorHandler('Payment date and method are required', 400);
      }

      // Get salary details
      const [salary] = await connection.execute(
        'SELECT * FROM salaries WHERE id = ? AND company_id = ?',
        [salaryId, req.query.company_id]
      );

      if (salary.length === 0) {
        throw new ErrorHandler('Salary record not found', 404);
      }

      if (salary[0].status === 'PAID') {
        throw new ErrorHandler('Salary is already paid', 400);
      }

      // Update salary status
      await connection.execute(
        `UPDATE salaries 
         SET status = 'PAID', payment_date = ?, payment_method = ?, updated_at = ?
         WHERE id = ? AND company_id = ?`,
        [
          Helpers.formatDate(payment_date),
          payment_method.trim(),
          new Date(),
          salaryId,
          req.query.company_id
        ]
      );

      // Create transaction record
      await connection.execute(
        `INSERT INTO transactions 
         (company_id, transaction_date, transaction_type, account_id, amount, 
          reference_type, reference_id, description, created_by, created_at, updated_at)
         VALUES (?, ?, 'CREDIT', ?, ?, 'salary', ?, ?, ?, ?, ?)`,
        [
          req.query.company_id,
          Helpers.formatDate(payment_date),
          1, // Default expense account - should be configurable
          salary[0].net_salary,
          salaryId,
          `Salary payment for employee ID ${salary[0].employee_id}`,
          req.query.id,
          new Date(),
          new Date()
        ]
      );

      // Fetch updated salary
      const [updatedSalary] = await connection.execute(
        `SELECT s.*,
         CONCAT(e.first_name, ' ', e.last_name) as employee_name,
         e.employee_code
         FROM salaries s
         LEFT JOIN employees e ON s.employee_id = e.id
         WHERE s.id = ?`,
        [salaryId]
      );

      await connection.commit();
      return ResponseHandler.success(res, updatedSalary[0], 'Salary paid successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Salary Report
  static async getSalaryReport(req, res) {
    try {
      const { month, year, department } = req.query;

      let whereConditions = ['s.company_id = ?'];
      let queryParams = [req.query.company_id];

      if (month && year) {
        whereConditions.push('MONTH(s.salary_month) = ? AND YEAR(s.salary_month) = ?');
        queryParams.push(month, year);
      } else if (year) {
        whereConditions.push('YEAR(s.salary_month) = ?');
        queryParams.push(year);
      }

      if (department && department.trim()) {
        whereConditions.push('e.department = ?');
        queryParams.push(department.trim());
      }

      const whereClause = whereConditions.join(' AND ');

      const [report] = await db.execute(`
        SELECT 
          COUNT(*) as total_salaries,
          COUNT(CASE WHEN s.status = 'PENDING' THEN 1 END) as pending_salaries,
          COUNT(CASE WHEN s.status = 'PAID' THEN 1 END) as paid_salaries,
          COALESCE(SUM(s.gross_salary), 0) as total_gross_salary,
          COALESCE(SUM(s.net_salary), 0) as total_net_salary,
          COALESCE(SUM(s.deductions), 0) as total_deductions,
          COALESCE(SUM(CASE WHEN s.status = 'PAID' THEN s.net_salary ELSE 0 END), 0) as total_paid_amount,
          COALESCE(SUM(CASE WHEN s.status = 'PENDING' THEN s.net_salary ELSE 0 END), 0) as total_pending_amount
        FROM salaries s
        LEFT JOIN employees e ON s.employee_id = e.id
        WHERE ${whereClause}
      `, queryParams);

      return ResponseHandler.success(res, report[0], 'Salary report generated successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = SalaryController;