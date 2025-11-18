const db = require('../config/database');
const { ResponseHandler, ErrorHandler, handleError, Helpers } = require('../utils/responseHandler');

class EmployeeController {
  // Create Employee
  static async createEmployee(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        user_id, employee_code, first_name, last_name, email, phone,
        date_of_birth, hire_date, designation, department,
        employment_type, salary_amount, salary_type,
        bank_account_number, bank_name, tax_id, address,
        emergency_contact_name, emergency_contact_phone, notes
      } = req.body;

      // Validate required fields
      if (!employee_code || !first_name || !last_name || !hire_date || !salary_amount) {
        throw new ErrorHandler('Employee code, name, hire date, and salary are required', 400);
      }

      // Validate email
      if (email && !Helpers.validateEmail(email)) {
        throw new ErrorHandler('Invalid email format', 400);
      }

      // Check for duplicate employee code
      const [existingEmployee] = await connection.execute(
        'SELECT id FROM employees WHERE employee_code = ? AND company_id = ?',
        [employee_code.trim(), req.query.company_id]
      );

      if (existingEmployee.length > 0) {
        throw new ErrorHandler('Employee code already exists', 409);
      }

      // Verify user if provided
      if (user_id) {
        const [user] = await connection.execute(
          'SELECT id FROM users WHERE id = ? AND company_id = ?',
          [user_id, req.query.company_id]
        );

        if (user.length === 0) {
          throw new ErrorHandler('User not found', 404);
        }
      }

      const employeeData = {
        company_id: req.query.company_id,
        user_id: user_id || null,
        employee_code: employee_code.trim().toUpperCase(),
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email?.trim().toLowerCase() || null,
        phone: phone?.trim() || null,
        date_of_birth: date_of_birth ? Helpers.formatDate(date_of_birth) : null,
        hire_date: Helpers.formatDate(hire_date),
        designation: designation?.trim() || null,
        department: department?.trim() || null,
        employment_type: employment_type || 'FULL_TIME',
        salary_amount,
        salary_type: salary_type || 'MONTHLY',
        bank_account_number: bank_account_number?.trim() || null,
        bank_name: bank_name?.trim() || null,
        tax_id: tax_id?.trim() || null,
        address: address?.trim() || null,
        emergency_contact_name: emergency_contact_name?.trim() || null,
        emergency_contact_phone: emergency_contact_phone?.trim() || null,
        is_active: 1,
        notes: notes?.trim() || null,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('employees', employeeData);
      const [result] = await connection.execute(query, values);

      // Fetch created employee
      const [employee] = await connection.execute(
        'SELECT * FROM employees WHERE id = ?',
        [result.insertId]
      );

      await connection.commit();
      return ResponseHandler.created(res, employee[0], 'Employee created successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Employees
  static async getAllEmployees(req, res) {
    try {
      const { page, limit, search, department, employment_type, is_active } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['e.company_id = ?'];
      let queryParams = [req.query.company_id];

      // Search filter
      if (search && search.trim()) {
        whereConditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_code LIKE ? OR e.email LIKE ?)');
        const searchTerm = `%${search.trim()}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
      }

      // Department filter
      if (department && department.trim()) {
        whereConditions.push('e.department = ?');
        queryParams.push(department.trim());
      }

      // Employment type filter
      if (employment_type) {
        whereConditions.push('e.employment_type = ?');
        queryParams.push(employment_type);
      }

      // Active status filter
      if (is_active !== undefined) {
        whereConditions.push('e.is_active = ?');
        queryParams.push(is_active === 'true' || is_active === '1' ? 1 : 0);
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total records
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM employees e WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch employees
      const [employees] = await db.execute(
        `SELECT e.*,
         u.email as user_email,
         (SELECT COUNT(*) FROM salaries WHERE employee_id = e.id) as total_salaries
         FROM employees e
         LEFT JOIN users u ON e.user_id = u.id
         WHERE ${whereClause}
         ORDER BY e.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        employees,
        { page: pageNum, limit: limitNum, total },
        'Employees retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Employee Details
  static async getEmployeeById(req, res) {
    try {
      const employeeId = Helpers.validateId(req.params.id, 'Employee ID');

      const [employee] = await db.execute(
        `SELECT e.*,
         u.email as user_email,
         (SELECT COUNT(*) FROM salaries WHERE employee_id = e.id) as total_salaries,
         (SELECT SUM(net_salary) FROM salaries WHERE employee_id = e.id AND status = 'PAID') as total_paid_salaries
         FROM employees e
         LEFT JOIN users u ON e.user_id = u.id
         WHERE e.id = ? AND e.company_id = ?`,
        [employeeId, req.query.company_id]
      );

      if (employee.length === 0) {
        throw new ErrorHandler('Employee not found', 404);
      }

      return ResponseHandler.success(res, employee[0], 'Employee retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Update Employee
  static async updateEmployee(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const employeeId = Helpers.validateId(req.params.id, 'Employee ID');

      // Check if employee exists
      const [existingEmployee] = await connection.execute(
        'SELECT id FROM employees WHERE id = ? AND company_id = ?',
        [employeeId, req.query.company_id]
      );

      if (existingEmployee.length === 0) {
        throw new ErrorHandler('Employee not found', 404);
      }

      // Validate email if provided
      if (req.body.email && !Helpers.validateEmail(req.body.email)) {
        throw new ErrorHandler('Invalid email format', 400);
      }

      const updateData = {
        ...Helpers.sanitizeInput(req.body),
        updated_at: new Date()
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.employee_code;
      delete updateData.created_at;

      if (Object.keys(updateData).length <= 1) {
        throw new ErrorHandler('No valid fields to update', 400);
      }

      const { query, values } = Helpers.buildUpdateQuery(
        'employees',
        updateData,
        'id = ? AND company_id = ?'
      );

      await connection.execute(query, [...values, employeeId, req.query.company_id]);

      // Fetch updated employee
      const [updatedEmployee] = await connection.execute(
        'SELECT * FROM employees WHERE id = ?',
        [employeeId]
      );

      await connection.commit();
      return ResponseHandler.success(res, updatedEmployee[0], 'Employee updated successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Terminate Employee
  static async terminateEmployee(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const employeeId = Helpers.validateId(req.params.id, 'Employee ID');
      const { termination_date, notes } = req.body;

      if (!termination_date) {
        throw new ErrorHandler('Termination date is required', 400);
      }

      const [existingEmployee] = await connection.execute(
        'SELECT id, is_active FROM employees WHERE id = ? AND company_id = ?',
        [employeeId, req.query.company_id]
      );

      if (existingEmployee.length === 0) {
        throw new ErrorHandler('Employee not found', 404);
      }

      if (existingEmployee[0].is_active === 0) {
        throw new ErrorHandler('Employee is already terminated', 400);
      }

      await connection.execute(
        `UPDATE employees 
         SET termination_date = ?, is_active = 0, notes = CONCAT(COALESCE(notes, ''), '\n\nTermination: ', ?), updated_at = ?
         WHERE id = ? AND company_id = ?`,
        [
          Helpers.formatDate(termination_date),
          notes?.trim() || 'No reason provided',
          new Date(),
          employeeId,
          req.query.company_id
        ]
      );

      await connection.commit();
      return ResponseHandler.success(res, null, 'Employee terminated successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Employee Salary History
  static async getEmployeeSalaries(req, res) {
    try {
      const employeeId = Helpers.validateId(req.params.id, 'Employee ID');
      const { page, limit } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      // Verify employee exists
      const [employee] = await db.execute(
        'SELECT id FROM employees WHERE id = ? AND company_id = ?',
        [employeeId, req.query.company_id]
      );

      if (employee.length === 0) {
        throw new ErrorHandler('Employee not found', 404);
      }

      // Count total salaries
      const [countResult] = await db.execute(
        'SELECT COUNT(*) as total FROM salaries WHERE employee_id = ? AND company_id = ?',
        [employeeId, req.query.company_id]
      );
      const total = countResult[0].total;

      // Fetch salaries
      const [salaries] = await db.execute(
        `SELECT s.*,
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name
         FROM salaries s
         LEFT JOIN users u ON s.created_by = u.id
         WHERE s.employee_id = ? AND s.company_id = ?
         ORDER BY s.salary_month DESC
         LIMIT ? OFFSET ?`,
        [employeeId, req.query.company_id, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        salaries,
        { page: pageNum, limit: limitNum, total },
        'Employee salary history retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = EmployeeController;