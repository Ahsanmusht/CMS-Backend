const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const Joi = require('joi');
const { validate } = require('../middleware/validation');

const router = express.Router();

const workOrderSchema = Joi.object({
  service_id: Joi.number().integer().required(),
  client_id: Joi.number().integer().required(),
  assigned_to: Joi.number().integer(),
  scheduled_date: Joi.date().required(),
  scheduled_time: Joi.string().max(20),
  address: Joi.string(),
  status: Joi.string().max(20).required(),
  special_instructions: Joi.string()
});

/**
 * @swagger
 * /work-orders:
 *   get:
 *     summary: Get all work orders
 *     tags: [Work Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of work orders
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const [workOrders] = await db.execute(
      `SELECT w.*, 
              CONCAT(c.first_name, ' ', c.last_name) as client_name,
              s.name as service_name,
              sp.name as assigned_provider_name
       FROM work_orders w
       JOIN clients c ON w.client_id = c.id
       JOIN services s ON w.service_id = s.id
       LEFT JOIN service_providers sp ON w.assigned_to = sp.id
       WHERE w.company_id = ?
       ORDER BY w.scheduled_date DESC`,
      [req.user.company_id]
    );
    
    res.json({ workOrders });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /work-orders:
 *   post:
 *     summary: Create new work order
 *     tags: [Work Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Work order created successfully
 */
router.post('/', authenticateToken, validate(workOrderSchema), async (req, res, next) => {
  try {
    const workOrderData = { ...req.body, company_id: req.user.company_id };
    
    const fields = Object.keys(workOrderData);
    const values = Object.values(workOrderData);
    const placeholders = fields.map(() => '?').join(', ');
    
    const [result] = await db.execute(
      `INSERT INTO work_orders (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    
    res.status(201).json({
      message: 'Work order created successfully',
      work_order_id: result.insertId
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /work-orders/{id}:
 *   put:
 *     summary: Update work order
 *     tags: [Work Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Work order updated successfully
 */
router.put('/:id', authenticateToken, validate(workOrderSchema), async (req, res, next) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const [result] = await db.execute(
      `UPDATE work_orders SET ${setClause} WHERE id = ? AND company_id = ?`,
      [...values, req.params.id, req.user.company_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Work order not found' });
    }
    
    res.json({ message: 'Work order updated successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /work-orders/{id}:
 *   delete:
 *     summary: Delete work order
 *     tags: [Work Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Work order deleted successfully
 */
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const [result] = await db.execute(
      'DELETE FROM work_orders WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Work order not found' });
    }
    
    res.json({ message: 'Work order deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;