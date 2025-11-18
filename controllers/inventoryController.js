class InventoryController {
  // Create Inventory Transaction
  static async createTransaction(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        product_id, transaction_type, quantity, unit_price, total_amount,
        reference_type, reference_id, supplier_id, client_id,
        transaction_date, notes
      } = req.body;

      // Validate required fields
      if (!product_id || !transaction_type || !quantity) {
        throw new ErrorHandler('Product ID, transaction type, and quantity are required', 400);
      }

      // Validate transaction type
      const validTypes = ['IN', 'OUT', 'ADJUSTMENT'];
      if (!validTypes.includes(transaction_type)) {
        throw new ErrorHandler(`Invalid transaction type. Must be one of: ${validTypes.join(', ')}`, 400);
      }

      // Verify product exists
      const [product] = await connection.execute(
        'SELECT id, current_stock, product_name FROM products WHERE id = ? AND company_id = ?',
        [product_id, req.query.company_id]
      );

      if (product.length === 0) {
        throw new ErrorHandler('Product not found', 404);
      }

      // Check stock availability for OUT transactions
      if (transaction_type === 'OUT' && product[0].current_stock < quantity) {
        throw new ErrorHandler(
          `Insufficient stock. Available: ${product[0].current_stock}, Requested: ${quantity}`,
          400
        );
      }

      const transactionData = {
        company_id: req.query.company_id,
        product_id,
        transaction_type,
        quantity,
        unit_price: unit_price || null,
        total_amount: total_amount || (unit_price ? unit_price * quantity : null),
        reference_type: reference_type?.trim() || null,
        reference_id: reference_id || null,
        supplier_id: supplier_id || null,
        client_id: client_id || null,
        transaction_date: Helpers.formatDate(transaction_date) || Helpers.formatDate(new Date()),
        notes: notes?.trim() || null,
        created_by: req.query.id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('inventory_transactions', transactionData);
      const [result] = await connection.execute(query, values);

      // Update product stock
      let newStock;
      if (transaction_type === 'IN') {
        newStock = product[0].current_stock + quantity;
      } else if (transaction_type === 'OUT') {
        newStock = product[0].current_stock - quantity;
      } else { // ADJUSTMENT
        newStock = quantity;
      }

      await connection.execute(
        'UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ?',
        [newStock, new Date(), product_id]
      );

      // Fetch created transaction
      const [transaction] = await connection.execute(
        `SELECT it.*, p.product_name, p.product_code
         FROM inventory_transactions it
         LEFT JOIN products p ON it.product_id = p.id
         WHERE it.id = ?`,
        [result.insertId]
      );

      await connection.commit();
      return ResponseHandler.created(
        res,
        { ...transaction[0], previous_stock: product[0].current_stock, new_stock: newStock },
        'Inventory transaction created successfully'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Inventory Transactions
  static async getTransactions(req, res) {
    try {
      const {
        page, limit, product_id, supplier_id, client_id,
        transaction_type, start_date, end_date
      } = req.query;
      
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['it.company_id = ?'];
      let queryParams = [req.query.company_id];

      // Filters
      if (product_id) {
        whereConditions.push('it.product_id = ?');
        queryParams.push(product_id);
      }

      if (supplier_id) {
        whereConditions.push('it.supplier_id = ?');
        queryParams.push(supplier_id);
      }

      if (client_id) {
        whereConditions.push('it.client_id = ?');
        queryParams.push(client_id);
      }

      if (transaction_type) {
        whereConditions.push('it.transaction_type = ?');
        queryParams.push(transaction_type);
      }

      if (start_date) {
        whereConditions.push('it.transaction_date >= ?');
        queryParams.push(Helpers.formatDate(start_date));
      }

      if (end_date) {
        whereConditions.push('it.transaction_date <= ?');
        queryParams.push(Helpers.formatDate(end_date));
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM inventory_transactions it WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch transactions
      const [transactions] = await db.execute(
        `SELECT it.*,
         p.product_name, p.product_code,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name
         FROM inventory_transactions it
         LEFT JOIN products p ON it.product_id = p.id
         LEFT JOIN suppliers s ON it.supplier_id = s.id
         LEFT JOIN clients c ON it.client_id = c.id
         WHERE ${whereClause}
         ORDER BY it.transaction_date DESC, it.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        transactions,
        { page: pageNum, limit: limitNum, total },
        'Inventory transactions retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = InventoryController;