const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Client:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         first_name:
 *           type: string
 *         last_name:
 *           type: string
 *         email:
 *           type: string
 *         phone:
 *           type: string
 *         address:
 *           type: string
 *         city:
 *           type: string
 *         state:
 *           type: string
 *         postal_code:
 *           type: string
 *         country:
 *           type: string
 *         client_since:
 *           type: string
 *           format: date
 *         notes:
 *           type: string
 *         is_active:
 *           type: boolean
 */

/**
 * @swagger
 * /clients:
 *   get:
 *     summary: Get all clients for company
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of clients
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT id, first_name, last_name, email, phone, city, state, 
             client_since, is_active, created_at
      FROM clients 
      WHERE company_id = ?
    `;
    
    const params = [req.user.company_id];
    
    if (search) {
      query += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    const [clients] = await db.execute(query, params);
    
    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM clients WHERE company_id = ?';
    const countParams = [req.user.company_id];
    
    if (search) {
      countQuery += ` AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    const [countResult] = await db.execute(countQuery, countParams);
    const total = countResult[0].total;
    
    res.json({
      clients,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /clients/{id}:
 *   get:
 *     summary: Get client by ID
 *     tags: [Clients]
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
 *         description: Client details
 *       404:
 *         description: Client not found
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const [clients] = await db.execute(
      'SELECT * FROM clients WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    
    if (!clients.length) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json(clients[0]);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /clients:
 *   post:
 *     summary: Create new client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Client'
 *     responses:
 *       201:
 *         description: Client created successfully
 */
router.post('/', authenticateToken, validate(schemas.client), async (req, res, next) => {
  try {
    const clientData = { ...req.body, company_id: req.user.company_id };
    
    const fields = Object.keys(clientData);
    const values = Object.values(clientData);
    const placeholders = fields.map(() => '?').join(', ');
    
    const [result] = await db.execute(
      `INSERT INTO clients (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    
    const [newClient] = await db.execute(
      'SELECT * FROM clients WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      message: 'Client created successfully',
      client: newClient[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /clients/{id}:
 *   put:
 *     summary: Update client
 *     tags: [Clients]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Client'
 *     responses:
 *       200:
 *         description: Client updated successfully
 */
router.put('/:id', authenticateToken, validate(schemas.client), async (req, res, next) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const [result] = await db.execute(
      `UPDATE clients SET ${setClause} WHERE id = ? AND company_id = ?`,
      [...values, req.params.id, req.user.company_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    const [updatedClient] = await db.execute(
      'SELECT * FROM clients WHERE id = ?',
      [req.params.id]
    );
    
    res.json({
      message: 'Client updated successfully',
      client: updatedClient[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /clients/{id}:
 *   delete:
 *     summary: Delete client (soft delete)
 *     tags: [Clients]
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
 *         description: Client deleted successfully
 */
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const [result] = await db.execute(
      'UPDATE clients SET is_active = 0 WHERE id = ? AND company_id = ?',
      [req.params.id, req.user.company_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;