const db = require('../config/database');
const { ResponseHandler, ErrorHandler, handleError, Helpers } = require('../utils/responseHandler');

class OrderController {
  // Create Order
  static async createOrder(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        order_type, supplier_id, client_id, order_date,
        expected_delivery_date, status, shipping_address,
        billing_address, notes, items
      } = req.body;

      // Validate required fields
      if (!order_type || !order_date || !status || !items || items.length === 0) {
        throw new ErrorHandler('Order type, date, status, and items are required', 400);
      }

      // Validate order type
      const validTypes = ['PURCHASE', 'SALES'];
      if (!validTypes.includes(order_type)) {
        throw new ErrorHandler(`Invalid order type. Must be one of: ${validTypes.join(', ')}`, 400);
      }

      // Validate status
      const validStatuses = ['DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
      if (!validStatuses.includes(status)) {
        throw new ErrorHandler(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
      }

      // Validate supplier/client based on order type
      if (order_type === 'PURCHASE' && !supplier_id) {
        throw new ErrorHandler('Supplier ID is required for purchase orders', 400);
      }

      if (order_type === 'SALES' && !client_id) {
        throw new ErrorHandler('Client ID is required for sales orders', 400);
      }

      // Verify supplier/client exists
      if (supplier_id) {
        const [supplier] = await connection.execute(
          'SELECT id FROM suppliers WHERE id = ? AND company_id = ?',
          [supplier_id, req.query.company_id]
        );
        if (supplier.length === 0) {
          throw new ErrorHandler('Supplier not found', 404);
        }
      }

      if (client_id) {
        const [client] = await connection.execute(
          'SELECT id FROM clients WHERE id = ? AND company_id = ?',
          [client_id, req.query.company_id]
        );
        if (client.length === 0) {
          throw new ErrorHandler('Client not found', 404);
        }
      }

      // Calculate order totals
      let subtotal = 0;
      let tax_amount = 0;
      const processedItems = [];

      for (const item of items) {
        if (!item.product_id || !item.quantity || !item.unit_price) {
          throw new ErrorHandler('Each item must have product_id, quantity, and unit_price', 400);
        }

        // Verify product exists
        const [product] = await connection.execute(
          'SELECT id, product_name, current_stock FROM products WHERE id = ? AND company_id = ?',
          [item.product_id, req.query.company_id]
        );

        if (product.length === 0) {
          throw new ErrorHandler(`Product with ID ${item.product_id} not found`, 404);
        }

        // For SALES orders, check stock availability
        if (order_type === 'SALES' && product[0].current_stock < item.quantity) {
          throw new ErrorHandler(
            `Insufficient stock for ${product[0].product_name}. Available: ${product[0].current_stock}, Requested: ${item.quantity}`,
            400
          );
        }

        const itemTotal = (item.quantity * item.unit_price) - (item.discount_amount || 0);
        const itemTax = itemTotal * ((item.tax_rate || 0) / 100);

        subtotal += itemTotal;
        tax_amount += itemTax;

        processedItems.push({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate || 0,
          discount_amount: item.discount_amount || 0,
          total_price: itemTotal + itemTax,
          notes: item.notes?.trim() || null
        });
      }

      const shipping_cost = req.body.shipping_cost || 0;
      const total_amount = subtotal + tax_amount + shipping_cost;

      // Generate unique order number
      const order_number = Helpers.generateUniqueCode(`${order_type.substring(0, 2)}ORD`);

      // Create order
      const orderData = {
        company_id: req.query.company_id,
        order_number,
        order_type,
        supplier_id: supplier_id || null,
        client_id: client_id || null,
        order_date: Helpers.formatDate(order_date),
        expected_delivery_date: expected_delivery_date ? Helpers.formatDate(expected_delivery_date) : null,
        status,
        subtotal,
        tax_amount,
        shipping_cost,
        total_amount,
        payment_status: 'UNPAID',
        shipping_address: shipping_address?.trim() || null,
        billing_address: billing_address?.trim() || null,
        notes: notes?.trim() || null,
        created_by: req.query.id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('orders', orderData);
      const [orderResult] = await connection.execute(query, values);
      const orderId = orderResult.insertId;

      // Create order items
      for (const item of processedItems) {
        const itemData = {
          ...item,
          order_id: orderId,
          created_at: new Date(),
          updated_at: new Date()
        };

        const { query: itemQuery, values: itemValues } = Helpers.buildInsertQuery('order_items', itemData);
        await connection.execute(itemQuery, itemValues);
      }

      // Fetch complete order with items
      const [order] = await connection.execute(
        `SELECT o.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name
         FROM orders o
         LEFT JOIN suppliers s ON o.supplier_id = s.id
         LEFT JOIN clients c ON o.client_id = c.id
         LEFT JOIN users u ON o.created_by = u.id
         WHERE o.id = ?`,
        [orderId]
      );

      const [orderItems] = await connection.execute(
        `SELECT oi.*, p.product_name, p.product_code
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [orderId]
      );

      await connection.commit();

      return ResponseHandler.created(
        res,
        { ...order[0], items: orderItems },
        'Order created successfully'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Orders
  static async getAllOrders(req, res) {
    try {
      const {
        page, limit, order_type, status, client_id,
        supplier_id, start_date, end_date
      } = req.query;
      
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['o.company_id = ?'];
      let queryParams = [req.query.company_id];

      // Filters
      if (order_type) {
        whereConditions.push('o.order_type = ?');
        queryParams.push(order_type);
      }

      if (status) {
        whereConditions.push('o.status = ?');
        queryParams.push(status);
      }

      if (client_id) {
        whereConditions.push('o.client_id = ?');
        queryParams.push(client_id);
      }

      if (supplier_id) {
        whereConditions.push('o.supplier_id = ?');
        queryParams.push(supplier_id);
      }

      if (start_date) {
        whereConditions.push('o.order_date >= ?');
        queryParams.push(Helpers.formatDate(start_date));
      }

      if (end_date) {
        whereConditions.push('o.order_date <= ?');
        queryParams.push(Helpers.formatDate(end_date));
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM orders o WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch orders
      const [orders] = await db.execute(
        `SELECT o.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
         (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
         FROM orders o
         LEFT JOIN suppliers s ON o.supplier_id = s.id
         LEFT JOIN clients c ON o.client_id = c.id
         LEFT JOIN users u ON o.created_by = u.id
         WHERE ${whereClause}
         ORDER BY o.order_date DESC, o.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        orders,
        { page: pageNum, limit: limitNum, total },
        'Orders retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Order Details
  static async getOrderById(req, res) {
    try {
      const orderId = Helpers.validateId(req.params.id, 'Order ID');

      const [order] = await db.execute(
        `SELECT o.*,
         s.supplier_name, s.email as supplier_email, s.phone as supplier_phone,
         CONCAT(c.first_name, ' ', c.last_name) as client_name,
         c.email as client_email, c.phone as client_phone,
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name
         FROM orders o
         LEFT JOIN suppliers s ON o.supplier_id = s.id
         LEFT JOIN clients c ON o.client_id = c.id
         LEFT JOIN users u ON o.created_by = u.id
         WHERE o.id = ? AND o.company_id = ?`,
        [orderId, req.query.company_id]
      );

      if (order.length === 0) {
        throw new ErrorHandler('Order not found', 404);
      }

      const [items] = await db.execute(
        `SELECT oi.*, p.product_name, p.product_code, p.unit_of_measure
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [orderId]
      );

      return ResponseHandler.success(
        res,
        { ...order[0], items },
        'Order retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Update Order
  static async updateOrder(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const orderId = Helpers.validateId(req.params.id, 'Order ID');

      // Check if order exists
      const [existingOrder] = await connection.execute(
        'SELECT id, status, order_type FROM orders WHERE id = ? AND company_id = ?',
        [orderId, req.query.company_id]
      );

      if (existingOrder.length === 0) {
        throw new ErrorHandler('Order not found', 404);
      }

      // Prevent updating delivered or cancelled orders
      if (['DELIVERED', 'CANCELLED'].includes(existingOrder[0].status)) {
        throw new ErrorHandler(`Cannot update ${existingOrder[0].status.toLowerCase()} orders`, 400);
      }

      const { items, ...orderUpdates } = req.body;

      // Recalculate totals if items are provided
      if (items && items.length > 0) {
        // Delete existing items
        await connection.execute(
          'DELETE FROM order_items WHERE order_id = ?',
          [orderId]
        );

        let subtotal = 0;
        let tax_amount = 0;

        for (const item of items) {
          if (!item.product_id || !item.quantity || !item.unit_price) {
            throw new ErrorHandler('Each item must have product_id, quantity, and unit_price', 400);
          }

          const itemTotal = (item.quantity * item.unit_price) - (item.discount_amount || 0);
          const itemTax = itemTotal * ((item.tax_rate || 0) / 100);

          subtotal += itemTotal;
          tax_amount += itemTax;

          const itemData = {
            order_id: orderId,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            tax_rate: item.tax_rate || 0,
            discount_amount: item.discount_amount || 0,
            total_price: itemTotal + itemTax,
            notes: item.notes?.trim() || null,
            created_at: new Date(),
            updated_at: new Date()
          };

          const { query, values } = Helpers.buildInsertQuery('order_items', itemData);
          await connection.execute(query, values);
        }

        const shipping_cost = orderUpdates.shipping_cost || 0;
        orderUpdates.subtotal = subtotal;
        orderUpdates.tax_amount = tax_amount;
        orderUpdates.total_amount = subtotal + tax_amount + shipping_cost;
      }

      const updateData = {
        ...Helpers.sanitizeInput(orderUpdates),
        updated_at: new Date()
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.order_number;
      delete updateData.created_at;
      delete updateData.created_by;

      if (Object.keys(updateData).length > 1) {
        const { query, values } = Helpers.buildUpdateQuery(
          'orders',
          updateData,
          'id = ? AND company_id = ?'
        );

        await connection.execute(query, [...values, orderId, req.query.company_id]);
      }

      // Fetch updated order
      const [updatedOrder] = await connection.execute(
        `SELECT o.*,
         s.supplier_name,
         CONCAT(c.first_name, ' ', c.last_name) as client_name
         FROM orders o
         LEFT JOIN suppliers s ON o.supplier_id = s.id
         LEFT JOIN clients c ON o.client_id = c.id
         WHERE o.id = ?`,
        [orderId]
      );

      const [orderItems] = await connection.execute(
        `SELECT oi.*, p.product_name, p.product_code
         FROM order_items oi
         LEFT JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = ?`,
        [orderId]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        { ...updatedOrder[0], items: orderItems },
        'Order updated successfully'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Update Order Status
  static async updateOrderStatus(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const orderId = Helpers.validateId(req.params.id, 'Order ID');
      const { status } = req.body;

      if (!status) {
        throw new ErrorHandler('Status is required', 400);
      }

      const validStatuses = ['DRAFT', 'PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'];
      if (!validStatuses.includes(status)) {
        throw new ErrorHandler(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
      }

      // Get order details
      const [order] = await connection.execute(
        'SELECT * FROM orders WHERE id = ? AND company_id = ?',
        [orderId, req.query.company_id]
      );

      if (order.length === 0) {
        throw new ErrorHandler('Order not found', 404);
      }

      // Update status
      const updateData = {
        status,
        updated_at: new Date()
      };

      // Set delivery date if status is DELIVERED
      if (status === 'DELIVERED') {
        updateData.actual_delivery_date = Helpers.formatDate(new Date());

        // Create inventory transactions for SALES orders
        if (order[0].order_type === 'SALES') {
          const [items] = await connection.execute(
            'SELECT * FROM order_items WHERE order_id = ?',
            [orderId]
          );

          for (const item of items) {
            await connection.execute(
              `INSERT INTO inventory_transactions 
               (company_id, product_id, transaction_type, quantity, unit_price, total_amount, 
                reference_type, reference_id, client_id, transaction_date, created_by, created_at, updated_at)
               VALUES (?, ?, 'OUT', ?, ?, ?, 'sales_order', ?, ?, ?, ?, ?, ?)`,
              [
                req.query.company_id, item.product_id, item.quantity, item.unit_price,
                item.total_price, orderId, order[0].client_id, new Date(),
                req.query.id, new Date(), new Date()
              ]
            );

            // Update product stock
            await connection.execute(
              'UPDATE products SET current_stock = current_stock - ?, updated_at = ? WHERE id = ?',
              [item.quantity, new Date(), item.product_id]
            );
          }
        }

        // Create inventory transactions for PURCHASE orders
        if (order[0].order_type === 'PURCHASE') {
          const [items] = await connection.execute(
            'SELECT * FROM order_items WHERE order_id = ?',
            [orderId]
          );

          for (const item of items) {
            await connection.execute(
              `INSERT INTO inventory_transactions 
               (company_id, product_id, transaction_type, quantity, unit_price, total_amount, 
                reference_type, reference_id, supplier_id, transaction_date, created_by, created_at, updated_at)
               VALUES (?, ?, 'IN', ?, ?, ?, 'purchase_order', ?, ?, ?, ?, ?, ?)`,
              [
                req.query.company_id, item.product_id, item.quantity, item.unit_price,
                item.total_price, orderId, order[0].supplier_id, new Date(),
                req.query.id, new Date(), new Date()
              ]
            );

            // Update product stock
            await connection.execute(
              'UPDATE products SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?',
              [item.quantity, new Date(), item.product_id]
            );
          }
        }
      }

      const { query, values } = Helpers.buildUpdateQuery(
        'orders',
        updateData,
        'id = ? AND company_id = ?'
      );

      await connection.execute(query, [...values, orderId, req.query.company_id]);

      // Fetch updated order
      const [updatedOrder] = await connection.execute(
        'SELECT * FROM orders WHERE id = ?',
        [orderId]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        updatedOrder[0],
        'Order status updated successfully'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Cancel Order
  static async cancelOrder(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const orderId = Helpers.validateId(req.params.id, 'Order ID');

      const [order] = await connection.execute(
        'SELECT status FROM orders WHERE id = ? AND company_id = ?',
        [orderId, req.query.company_id]
      );

      if (order.length === 0) {
        throw new ErrorHandler('Order not found', 404);
      }

      if (order[0].status === 'DELIVERED') {
        throw new ErrorHandler('Cannot cancel delivered orders', 400);
      }

      if (order[0].status === 'CANCELLED') {
        throw new ErrorHandler('Order is already cancelled', 400);
      }

      await connection.execute(
        'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?',
        ['CANCELLED', new Date(), orderId, req.query.company_id]
      );

      await connection.commit();

      return ResponseHandler.success(res, null, 'Order cancelled successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Order Statistics
  static async getOrderStatistics(req, res) {
    try {
      const { period = 'month' } = req.query;

      let dateFilter = '';
      switch (period) {
        case 'today':
          dateFilter = 'DATE(order_date) = CURDATE()';
          break;
        case 'week':
          dateFilter = 'order_date >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
          break;
        case 'month':
          dateFilter = 'order_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
          break;
        case 'year':
          dateFilter = 'order_date >= DATE_SUB(NOW(), INTERVAL 365 DAY)';
          break;
        default:
          dateFilter = '1=1';
      }

      const [stats] = await db.execute(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN order_type = 'SALES' THEN 1 END) as sales_orders,
          COUNT(CASE WHEN order_type = 'PURCHASE' THEN 1 END) as purchase_orders,
          COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_orders,
          COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed_orders,
          COUNT(CASE WHEN status = 'PROCESSING' THEN 1 END) as processing_orders,
          COUNT(CASE WHEN status = 'SHIPPED' THEN 1 END) as shipped_orders,
          COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) as delivered_orders,
          COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled_orders,
          COALESCE(SUM(CASE WHEN order_type = 'SALES' THEN total_amount ELSE 0 END), 0) as total_sales_amount,
          COALESCE(SUM(CASE WHEN order_type = 'PURCHASE' THEN total_amount ELSE 0 END), 0) as total_purchase_amount
        FROM orders
        WHERE company_id = ? AND ${dateFilter}
      `, [req.query.company_id]);

      return ResponseHandler.success(res, stats[0], 'Order statistics retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = OrderController;