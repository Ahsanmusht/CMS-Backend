const db = require('../config/database');
const { ResponseHandler, ErrorHandler, handleError, Helpers } = require('../utils/responseHandler');

class BillController {
  // Create Bill
  static async createBill(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        bill_type, order_id, supplier_id, client_id,
        bill_date, due_date, subtotal, tax_amount,
        discount_amount, total_amount, payment_terms, notes
      } = req.body;

      // Validate required fields
      if (!bill_type || !bill_date || !due_date || !total_amount) {
        throw new ErrorHandler('Bill type, dates, and total amount are required', 400);
      }

      // Validate bill type
      const validTypes = ['PURCHASE', 'SALES'];
      if (!validTypes.includes(bill_type)) {
        throw new ErrorHandler(`Invalid bill type. Must be one of: ${validTypes.join(', ')}`, 400);
      }

      // Validate supplier/client based on bill type
      if (bill_type === 'PURCHASE' && !supplier_id) {
        throw new ErrorHandler('Supplier ID is required for purchase bills', 400);
      }

      if (bill_type === 'SALES' && !client_id) {
        throw new ErrorHandler('Client ID is required for sales bills', 400);
      }

      // Verify order if provided
      if (order_id) {
        const [order] = await connection.execute(
          'SELECT id, order_type FROM orders WHERE id = ? AND company_id = ?',
          [order_id, req.query.company_id]
        );

        if (order.length === 0) {
          throw new ErrorHandler('Order not found', 404);
        }

        // Verify order type matches bill type
        if (order[0].order_type !== bill_type) {
          throw new ErrorHandler('Order type must match bill type', 400);
        }
      }

      // Generate unique bill number
      const bill_number = Helpers.generateUniqueCode(`${bill_type.substring(0, 2)}BILL`);

      // Validate dates
      const billDate = new Date(bill_date);
      const dueDate = new Date(due_date);

      if (dueDate < billDate) {
        throw new ErrorHandler('Due date cannot be before bill date', 400);
      }

      const billData = {
        company_id: req.query.company_id,
        bill_number,
        bill_type,
        order_id: order_id || null,
        supplier_id: supplier_id || null,
        client_id: client_id || null,
        bill_date: Helpers.formatDate(bill_date),
        due_date: Helpers.formatDate(due_date),
        subtotal: subtotal || 0,
        tax_amount: tax_amount || 0,
        discount_amount: discount_amount || 0,
        total_amount,
        paid_amount: 0,
        status: 'PENDING',
        payment_terms: payment_terms?.trim() || null,
        notes: notes?.trim() || null,
        created_by: req.query.id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('bills', billData);
      const [result] = await connection.execute(query, values);

      // Fetch created bill
      const [bill] = await connection.execute(
        `SELECT b.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         o.order_number
         FROM bills b
         LEFT JOIN suppliers s ON b.supplier_id = s.id
         LEFT JOIN clients c ON b.client_id = c.id
         LEFT JOIN orders o ON b.order_id = o.id
         WHERE b.id = ?`,
        [result.insertId]
      );

      await connection.commit();
      return ResponseHandler.created(res, bill[0], 'Bill created successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Bills
  static async getAllBills(req, res) {
    try {
      const {
        page, limit, bill_type, status, client_id,
        supplier_id, start_date, end_date
      } = req.query;
      
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['b.company_id = ?'];
      let queryParams = [req.query.company_id];

      // Filters
      if (bill_type) {
        whereConditions.push('b.bill_type = ?');
        queryParams.push(bill_type);
      }

      if (status) {
        whereConditions.push('b.status = ?');
        queryParams.push(status);
      }

      if (client_id) {
        whereConditions.push('b.client_id = ?');
        queryParams.push(client_id);
      }

      if (supplier_id) {
        whereConditions.push('b.supplier_id = ?');
        queryParams.push(supplier_id);
      }

      if (start_date) {
        whereConditions.push('b.bill_date >= ?');
        queryParams.push(Helpers.formatDate(start_date));
      }

      if (end_date) {
        whereConditions.push('b.bill_date <= ?');
        queryParams.push(Helpers.formatDate(end_date));
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM bills b WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch bills
      const [bills] = await db.execute(
        `SELECT b.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         o.order_number,
         (b.total_amount - b.paid_amount) as outstanding_amount,
         (SELECT COUNT(*) FROM bill_payments WHERE bill_id = b.id) as payment_count
         FROM bills b
         LEFT JOIN suppliers s ON b.supplier_id = s.id
         LEFT JOIN clients c ON b.client_id = c.id
         LEFT JOIN orders o ON b.order_id = o.id
         WHERE ${whereClause}
         ORDER BY b.bill_date DESC, b.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        bills,
        { page: pageNum, limit: limitNum, total },
        'Bills retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Bill Details
  static async getBillById(req, res) {
    try {
      const billId = Helpers.validateId(req.params.id, 'Bill ID');

      const [bill] = await db.execute(
        `SELECT b.*,
         s.supplier_name, s.email as supplier_email, s.phone as supplier_phone,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         c.email as client_email, c.phone as client_phone,
         o.order_number,
         (b.total_amount - b.paid_amount) as outstanding_amount
         FROM bills b
         LEFT JOIN suppliers s ON b.supplier_id = s.id
         LEFT JOIN clients c ON b.client_id = c.id
         LEFT JOIN orders o ON b.order_id = o.id
         WHERE b.id = ? AND b.company_id = ?`,
        [billId, req.query.company_id]
      );

      if (bill.length === 0) {
        throw new ErrorHandler('Bill not found', 404);
      }

      // Fetch payment history
      const [payments] = await db.execute(
        `SELECT bp.*,
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name
         FROM bill_payments bp
         LEFT JOIN users u ON bp.created_by = u.id
         WHERE bp.bill_id = ?
         ORDER BY bp.payment_date DESC`,
        [billId]
      );

      return ResponseHandler.success(
        res,
        { ...bill[0], payments },
        'Bill retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Update Bill
  static async updateBill(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const billId = Helpers.validateId(req.params.id, 'Bill ID');

      // Check if bill exists
      const [existingBill] = await connection.execute(
        'SELECT id, status FROM bills WHERE id = ? AND company_id = ?',
        [billId, req.query.company_id]
      );

      if (existingBill.length === 0) {
        throw new ErrorHandler('Bill not found', 404);
      }

      // Prevent updating paid or cancelled bills
      if (['PAID', 'CANCELLED'].includes(existingBill[0].status)) {
        throw new ErrorHandler(`Cannot update ${existingBill[0].status.toLowerCase()} bills`, 400);
      }

      const updateData = {
        ...Helpers.sanitizeInput(req.body),
        updated_at: new Date()
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.bill_number;
      delete updateData.paid_amount;
      delete updateData.created_at;
      delete updateData.created_by;

      if (Object.keys(updateData).length <= 1) {
        throw new ErrorHandler('No valid fields to update', 400);
      }

      const { query, values } = Helpers.buildUpdateQuery(
        'bills',
        updateData,
        'id = ? AND company_id = ?'
      );

      await connection.execute(query, [...values, billId, req.query.company_id]);

      // Fetch updated bill
      const [updatedBill] = await connection.execute(
        `SELECT b.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name
         FROM bills b
         LEFT JOIN suppliers s ON b.supplier_id = s.id
         LEFT JOIN clients c ON b.client_id = c.id
         WHERE b.id = ?`,
        [billId]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        updatedBill[0],
        'Bill updated successfully'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Record Payment
  static async recordPayment(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const billId = Helpers.validateId(req.params.id, 'Bill ID');
      const {
        payment_date, amount, payment_method,
        transaction_id, reference_number, notes
      } = req.body;

      // Validate required fields
      if (!payment_date || !amount || !payment_method) {
        throw new ErrorHandler('Payment date, amount, and payment method are required', 400);
      }

      if (amount <= 0) {
        throw new ErrorHandler('Payment amount must be greater than zero', 400);
      }

      // Get bill details
      const [bill] = await connection.execute(
        'SELECT * FROM bills WHERE id = ? AND company_id = ?',
        [billId, req.query.company_id]
      );

      if (bill.length === 0) {
        throw new ErrorHandler('Bill not found', 404);
      }

      const outstanding = bill[0].total_amount - bill[0].paid_amount;

      if (amount > outstanding) {
        throw new ErrorHandler(
          `Payment amount (${amount}) exceeds outstanding amount (${outstanding})`,
          400
        );
      }

      // Create payment record
      const paymentData = {
        bill_id: billId,
        payment_date: Helpers.formatDate(payment_date),
        amount,
        payment_method: payment_method.trim(),
        transaction_id: transaction_id?.trim() || null,
        reference_number: reference_number?.trim() || null,
        notes: notes?.trim() || null,
        created_by: req.query.id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('bill_payments', paymentData);
      const [paymentResult] = await connection.execute(query, values);

      // Update bill paid amount and status
      const newPaidAmount = parseFloat(bill[0].paid_amount) + parseFloat(amount);
      let newStatus = 'PARTIAL';

      if (newPaidAmount >= bill[0].total_amount) {
        newStatus = 'PAID';
      }

      await connection.execute(
        'UPDATE bills SET paid_amount = ?, status = ?, updated_at = ? WHERE id = ?',
        [newPaidAmount, newStatus, new Date(), billId]
      );

      // Create transaction record
      await connection.execute(
        `INSERT INTO transactions 
         (company_id, transaction_date, transaction_type, account_id, amount, 
          reference_type, reference_id, description, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.query.company_id,
          Helpers.formatDate(payment_date),
          bill[0].bill_type === 'SALES' ? 'DEBIT' : 'CREDIT',
          1, // Default cash account - should be configurable
          amount,
          'bill_payment',
          paymentResult.insertId,
          `Payment for ${bill[0].bill_type} bill ${bill[0].bill_number}`,
          req.query.id,
          new Date(),
          new Date()
        ]
      );

      // Fetch payment details
      const [payment] = await connection.execute(
        'SELECT * FROM bill_payments WHERE id = ?',
        [paymentResult.insertId]
      );

      await connection.commit();

      return ResponseHandler.created(
        res,
        {
          payment: payment[0],
          bill_status: newStatus,
          new_paid_amount: newPaidAmount,
          outstanding_amount: bill[0].total_amount - newPaidAmount
        },
        'Payment recorded successfully'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Bill Payments
  static async getBillPayments(req, res) {
    try {
      const billId = Helpers.validateId(req.params.id, 'Bill ID');

      // Verify bill exists
      const [bill] = await db.execute(
        'SELECT id FROM bills WHERE id = ? AND company_id = ?',
        [billId, req.query.company_id]
      );

      if (bill.length === 0) {
        throw new ErrorHandler('Bill not found', 404);
      }

      const [payments] = await db.execute(
        `SELECT bp.*,
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name
         FROM bill_payments bp
         LEFT JOIN users u ON bp.created_by = u.id
         WHERE bp.bill_id = ?
         ORDER BY bp.payment_date DESC`,
        [billId]
      );

      return ResponseHandler.success(
        res,
        payments,
        'Bill payments retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Overdue Bills
  static async getOverdueBills(req, res) {
    try {
      const [bills] = await db.execute(
        `SELECT b.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         (b.total_amount - b.paid_amount) as outstanding_amount,
         DATEDIFF(CURDATE(), b.due_date) as days_overdue
         FROM bills b
         LEFT JOIN suppliers s ON b.supplier_id = s.id
         LEFT JOIN clients c ON b.client_id = c.id
         WHERE b.company_id = ?
         AND b.due_date < CURDATE()
         AND b.status NOT IN ('PAID', 'CANCELLED')
         ORDER BY b.due_date ASC`,
        [req.query.company_id]
      );

      return ResponseHandler.success(
        res,
        bills,
        `Found ${bills.length} overdue bills`
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Bills Report
  static async getBillsReport(req, res) {
    try {
      const { start_date, end_date, bill_type } = req.query;

      let whereConditions = ['company_id = ?'];
      let queryParams = [req.query.company_id];

      if (start_date) {
        whereConditions.push('bill_date >= ?');
        queryParams.push(Helpers.formatDate(start_date));
      }

      if (end_date) {
        whereConditions.push('bill_date <= ?');
        queryParams.push(Helpers.formatDate(end_date));
      }

      if (bill_type) {
        whereConditions.push('bill_type = ?');
        queryParams.push(bill_type);
      }

      const whereClause = whereConditions.join(' AND ');

      const [report] = await db.execute(`
        SELECT 
          COUNT(*) as total_bills,
          COUNT(CASE WHEN bill_type = 'SALES' THEN 1 END) as sales_bills,
          COUNT(CASE WHEN bill_type = 'PURCHASE' THEN 1 END) as purchase_bills,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_bills,
          COUNT(CASE WHEN status = 'PARTIAL' THEN 1 END) as partial_bills,
          COUNT(CASE WHEN status = 'PAID' THEN 1 END) as paid_bills,
          COUNT(CASE WHEN status = 'OVERDUE' THEN 1 END) as overdue_bills,
          COALESCE(SUM(total_amount), 0) as total_billed_amount,
          COALESCE(SUM(paid_amount), 0) as total_paid_amount,
          COALESCE(SUM(total_amount - paid_amount), 0) as total_outstanding_amount,
          COALESCE(SUM(CASE WHEN bill_type = 'SALES' THEN total_amount ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN bill_type = 'PURCHASE' THEN total_amount ELSE 0 END), 0) as total_purchases
        FROM bills
        WHERE ${whereClause}
      `, queryParams);

      return ResponseHandler.success(res, report[0], 'Bills report generated successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = BillController;