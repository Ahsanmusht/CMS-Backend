const db = require('../config/database');
const { ResponseHandler, ErrorHandler, handleError, Helpers } = require('../utils/responseHandler');

class ProductController {
  // Create Product
  static async createProduct(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        product_code, product_name, description, category,
        unit_of_measure, unit_price, reorder_level, current_stock
      } = req.body;

      // Validate required fields
      if (!product_name || !product_name.trim()) {
        throw new ErrorHandler('Product name is required', 400);
      }

      if (!product_code || !product_code.trim()) {
        throw new ErrorHandler('Product code is required', 400);
      }

      // Check for duplicate product code
      const [existingProduct] = await connection.execute(
        'SELECT id FROM products WHERE product_code = ? AND company_id = ?',
        [product_code.trim(), req.query.company_id]
      );

      if (existingProduct.length > 0) {
        throw new ErrorHandler('Product code already exists', 409);
      }

      const productData = {
        company_id: req.query.company_id,
        product_code: product_code.trim().toUpperCase(),
        product_name: product_name.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        unit_of_measure: unit_of_measure?.trim() || null,
        unit_price: unit_price || null,
        reorder_level: reorder_level || null,
        current_stock: current_stock || 0,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('products', productData);
      const [result] = await connection.execute(query, values);

      // Fetch created product
      const [product] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [result.insertId]
      );

      await connection.commit();
      return ResponseHandler.created(res, product[0], 'Product created successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Products
  static async getAllProducts(req, res) {
    try {
      const { page, limit, search, category, low_stock } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['company_id = ?'];
      let queryParams = [req.query.company_id];

      // Search filter
      if (search && search.trim()) {
        whereConditions.push('(product_name LIKE ? OR product_code LIKE ?)');
        const searchTerm = `%${search.trim()}%`;
        queryParams.push(searchTerm, searchTerm);
      }

      // Category filter
      if (category && category.trim()) {
        whereConditions.push('category = ?');
        queryParams.push(category.trim());
      }

      // Low stock filter
      if (low_stock === 'true' || low_stock === '1') {
        whereConditions.push('current_stock <= reorder_level');
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total records
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM products WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch products
      const [products] = await db.execute(
        `SELECT * FROM products WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        products,
        { page: pageNum, limit: limitNum, total },
        'Products retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Product Details
  static async getProductById(req, res) {
    try {
      const productId = Helpers.validateId(req.params.id, 'Product ID');

      const [product] = await db.execute(
        `SELECT p.*,
         (SELECT COUNT(*) FROM inventory_transactions WHERE product_id = p.id) as total_transactions,
         (SELECT SUM(quantity) FROM inventory_transactions WHERE product_id = p.id AND transaction_type = 'IN') as total_in,
         (SELECT SUM(quantity) FROM inventory_transactions WHERE product_id = p.id AND transaction_type = 'OUT') as total_out
         FROM products p
         WHERE p.id = ? AND p.company_id = ?`,
        [productId, req.query.company_id]
      );

      if (product.length === 0) {
        throw new ErrorHandler('Product not found', 404);
      }

      return ResponseHandler.success(res, product[0], 'Product retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Update Product
  static async updateProduct(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const productId = Helpers.validateId(req.params.id, 'Product ID');

      // Check if product exists
      const [existingProduct] = await connection.execute(
        'SELECT id, product_code FROM products WHERE id = ? AND company_id = ?',
        [productId, req.query.company_id]
      );

      if (existingProduct.length === 0) {
        throw new ErrorHandler('Product not found', 404);
      }

      // Check for duplicate product code if being changed
      if (req.body.product_code && req.body.product_code !== existingProduct[0].product_code) {
        const [duplicate] = await connection.execute(
          'SELECT id FROM products WHERE product_code = ? AND company_id = ? AND id != ?',
          [req.body.product_code.trim(), req.query.company_id, productId]
        );

        if (duplicate.length > 0) {
          throw new ErrorHandler('Product code already exists', 409);
        }
      }

      const updateData = {
        ...Helpers.sanitizeInput(req.body),
        updated_at: new Date()
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.created_at;
      delete updateData.current_stock; // Stock should only be updated via inventory transactions

      if (Object.keys(updateData).length <= 1) {
        throw new ErrorHandler('No valid fields to update', 400);
      }

      const { query, values } = Helpers.buildUpdateQuery(
        'products',
        updateData,
        'id = ? AND company_id = ?'
      );

      await connection.execute(query, [...values, productId, req.query.company_id]);

      // Fetch updated product
      const [updatedProduct] = await connection.execute(
        'SELECT * FROM products WHERE id = ?',
        [productId]
      );

      await connection.commit();
      return ResponseHandler.success(res, updatedProduct[0], 'Product updated successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Delete Product
  static async deleteProduct(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const productId = Helpers.validateId(req.params.id, 'Product ID');

      // Check if product exists
      const [existingProduct] = await connection.execute(
        'SELECT id FROM products WHERE id = ? AND company_id = ?',
        [productId, req.query.company_id]
      );

      if (existingProduct.length === 0) {
        throw new ErrorHandler('Product not found', 404);
      }

      // Check if product has active orders
      const [activeOrders] = await connection.execute(
        `SELECT COUNT(*) as count FROM order_items oi
         JOIN orders o ON oi.order_id = o.id
         WHERE oi.product_id = ? AND o.status NOT IN ('CANCELLED', 'DELIVERED')`,
        [productId]
      );

      if (activeOrders[0].count > 0) {
        throw new ErrorHandler(
          'Cannot delete product with active orders. Please complete or cancel them first.',
          400
        );
      }

      // Soft delete
      await connection.execute(
        'UPDATE products SET is_active = 0, updated_at = ? WHERE id = ? AND company_id = ?',
        [new Date(), productId, req.query.company_id]
      );

      await connection.commit();
      return ResponseHandler.success(res, null, 'Product deleted successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Product Stock History
  static async getProductStockHistory(req, res) {
    try {
      const productId = Helpers.validateId(req.params.id, 'Product ID');
      const { page, limit } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      // Verify product exists
      const [product] = await db.execute(
        'SELECT id FROM products WHERE id = ? AND company_id = ?',
        [productId, req.query.company_id]
      );

      if (product.length === 0) {
        throw new ErrorHandler('Product not found', 404);
      }

      // Count total transactions
      const [countResult] = await db.execute(
        'SELECT COUNT(*) as total FROM inventory_transactions WHERE product_id = ? AND company_id = ?',
        [productId, req.query.company_id]
      );
      const total = countResult[0].total;

      // Fetch stock history
      const [history] = await db.execute(
        `SELECT it.*, 
         s.supplier_name,
         c.first_name as client_first_name,
         c.last_name as client_last_name,
         u.first_name as created_by_first_name,
         u.last_name as created_by_last_name
         FROM inventory_transactions it
         LEFT JOIN suppliers s ON it.supplier_id = s.id
         LEFT JOIN clients c ON it.client_id = c.id
         LEFT JOIN users u ON it.created_by = u.id
         WHERE it.product_id = ? AND it.company_id = ?
         ORDER BY it.transaction_date DESC, it.created_at DESC
         LIMIT ? OFFSET ?`,
        [productId, req.query.company_id, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        history,
        { page: pageNum, limit: limitNum, total },
        'Product stock history retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Low Stock Products
  static async getLowStockProducts(req, res) {
    try {
      const [products] = await db.execute(
        `SELECT * FROM products 
         WHERE company_id = ? 
         AND is_active = 1 
         AND current_stock <= reorder_level
         ORDER BY current_stock ASC`,
        [req.query.company_id]
      );

      return ResponseHandler.success(
        res,
        products,
        `Found ${products.length} products with low stock`
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Inventory Report
  static async getInventoryReport(req, res) {
    try {
      const [report] = await db.execute(
        `SELECT 
          COUNT(*) as total_products,
          SUM(current_stock) as total_stock_units,
          SUM(current_stock * unit_price) as total_inventory_value,
          COUNT(CASE WHEN current_stock <= reorder_level THEN 1 END) as low_stock_products,
          COUNT(CASE WHEN current_stock = 0 THEN 1 END) as out_of_stock_products
         FROM products
         WHERE company_id = ? AND is_active = 1`,
        [req.query.company_id]
      );

      return ResponseHandler.success(res, report[0], 'Inventory report generated successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = ProductController;
