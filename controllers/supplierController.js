const db = require('../config/database');
const { ResponseHandler, ErrorHandler, handleError, Helpers } = require('../utils/responseHandler');

class SupplierController {
  // Create Supplier
  static async createSupplier(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        supplier_name, contact_person, email, phone, address,
        city, state, postal_code, country, supplier_type,
        tax_id, payment_terms, credit_limit, notes
      } = req.body;

      // Validate required fields
      if (!supplier_name || !supplier_name.trim()) {
        throw new ErrorHandler('Supplier name is required', 400);
      }

      // Validate email if provided
      if (email && !Helpers.validateEmail(email)) {
        throw new ErrorHandler('Invalid email format', 400);
      }

      // Validate phone if provided
      if (phone && !Helpers.validatePhone(phone)) {
        throw new ErrorHandler('Invalid phone format', 400);
      }

      const supplierData = {
        company_id: req.query.company_id,
        supplier_name: supplier_name.trim(),
        contact_person: contact_person?.trim() || null,
        email: email?.trim().toLowerCase() || null,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        city: city?.trim() || null,
        state: state?.trim() || null,
        postal_code: postal_code?.trim() || null,
        country: country?.trim() || null,
        supplier_type: supplier_type?.trim() || null,
        tax_id: tax_id?.trim() || null,
        payment_terms: payment_terms?.trim() || null,
        credit_limit: credit_limit || null,
        notes: notes?.trim() || null,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('suppliers', supplierData);
      const [result] = await connection.execute(query, values);

      // Fetch created supplier
      const [supplier] = await connection.execute(
        'SELECT * FROM suppliers WHERE id = ?',
        [result.insertId]
      );

      await connection.commit();
      return ResponseHandler.created(res, supplier[0], 'Supplier created successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Suppliers
  static async getAllSuppliers(req, res) {
    try {
      const { page, limit, search, is_active } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['company_id = ?'];
      let queryParams = [req.query.company_id];

      // Search filter
      if (search && search.trim()) {
        whereConditions.push('(supplier_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
        const searchTerm = `%${search.trim()}%`;
        queryParams.push(searchTerm, searchTerm, searchTerm);
      }

      // Active status filter
      if (is_active !== undefined) {
        whereConditions.push('is_active = ?');
        queryParams.push(is_active === 'true' || is_active === '1' ? 1 : 0);
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total records
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM suppliers WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch suppliers
      const [suppliers] = await db.execute(
        `SELECT * FROM suppliers WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        suppliers,
        { page: pageNum, limit: limitNum, total },
        'Suppliers retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Single Supplier
  static async getSupplierById(req, res) {
    try {
      const supplierId = Helpers.validateId(req.params.id, 'Supplier ID');

      const [supplier] = await db.execute(
        `SELECT s.*, 
         (SELECT COUNT(*) FROM orders WHERE supplier_id = s.id) as total_orders,
         (SELECT COUNT(*) FROM bills WHERE supplier_id = s.id) as total_bills
         FROM suppliers s 
         WHERE s.id = ? AND s.company_id = ?`,
        [supplierId, req.query.company_id]
      );

      if (supplier.length === 0) {
        throw new ErrorHandler('Supplier not found', 404);
      }

      return ResponseHandler.success(res, supplier[0], 'Supplier retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Update Supplier
  static async updateSupplier(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const supplierId = Helpers.validateId(req.params.id, 'Supplier ID');

      // Check if supplier exists
      const [existingSupplier] = await connection.execute(
        'SELECT id FROM suppliers WHERE id = ? AND company_id = ?',
        [supplierId, req.query.company_id]
      );

      if (existingSupplier.length === 0) {
        throw new ErrorHandler('Supplier not found', 404);
      }

      // Validate email if provided
      if (req.body.email && !Helpers.validateEmail(req.body.email)) {
        throw new ErrorHandler('Invalid email format', 400);
      }

      // Validate phone if provided
      if (req.body.phone && !Helpers.validatePhone(req.body.phone)) {
        throw new ErrorHandler('Invalid phone format', 400);
      }

      const updateData = {
        ...Helpers.sanitizeInput(req.body),
        updated_at: new Date()
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.created_at;

      if (Object.keys(updateData).length <= 1) {
        throw new ErrorHandler('No valid fields to update', 400);
      }

      const { query, values } = Helpers.buildUpdateQuery(
        'suppliers',
        updateData,
        'id = ? AND company_id = ?'
      );

      await connection.execute(query, [...values, supplierId, req.query.company_id]);

      // Fetch updated supplier
      const [updatedSupplier] = await connection.execute(
        'SELECT * FROM suppliers WHERE id = ?',
        [supplierId]
      );

      await connection.commit();
      return ResponseHandler.success(res, updatedSupplier[0], 'Supplier updated successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Delete Supplier (Soft Delete)
  static async deleteSupplier(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const supplierId = Helpers.validateId(req.params.id, 'Supplier ID');

      // Check if supplier exists
      const [existingSupplier] = await connection.execute(
        'SELECT id FROM suppliers WHERE id = ? AND company_id = ?',
        [supplierId, req.query.company_id]
      );

      if (existingSupplier.length === 0) {
        throw new ErrorHandler('Supplier not found', 404);
      }

      // Check if supplier has active orders or bills
      const [activeRecords] = await connection.execute(
        `SELECT 
          (SELECT COUNT(*) FROM orders WHERE supplier_id = ? AND status NOT IN ('CANCELLED', 'DELIVERED')) as active_orders,
          (SELECT COUNT(*) FROM bills WHERE supplier_id = ? AND status NOT IN ('CANCELLED', 'PAID')) as active_bills`,
        [supplierId, supplierId]
      );

      if (activeRecords[0].active_orders > 0 || activeRecords[0].active_bills > 0) {
        throw new ErrorHandler(
          'Cannot delete supplier with active orders or bills. Please complete or cancel them first.',
          400
        );
      }

      // Soft delete
      await connection.execute(
        'UPDATE suppliers SET is_active = 0, updated_at = ? WHERE id = ? AND company_id = ?',
        [new Date(), supplierId, req.query.company_id]
      );

      await connection.commit();
      return ResponseHandler.success(res, null, 'Supplier deleted successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Supplier Transactions
  static async getSupplierTransactions(req, res) {
    try {
      const supplierId = Helpers.validateId(req.params.id, 'Supplier ID');
      const { page, limit } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      // Verify supplier exists
      const [supplier] = await db.execute(
        'SELECT id FROM suppliers WHERE id = ? AND company_id = ?',
        [supplierId, req.query.company_id]
      );

      if (supplier.length === 0) {
        throw new ErrorHandler('Supplier not found', 404);
      }

      // Count total transactions
      const [countResult] = await db.execute(
        'SELECT COUNT(*) as total FROM inventory_transactions WHERE supplier_id = ? AND company_id = ?',
        [supplierId, req.query.company_id]
      );
      const total = countResult[0].total;

      // Fetch transactions
      const [transactions] = await db.execute(
        `SELECT it.*, p.product_name, p.product_code
         FROM inventory_transactions it
         LEFT JOIN products p ON it.product_id = p.id
         WHERE it.supplier_id = ? AND it.company_id = ?
         ORDER BY it.transaction_date DESC, it.created_at DESC
         LIMIT ? OFFSET ?`,
        [supplierId, req.query.company_id, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        transactions,
        { page: pageNum, limit: limitNum, total },
        'Supplier transactions retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = SupplierController;