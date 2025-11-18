const express = require('express');
const db = require('../config/database');
const { authenticateOwner } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

const router = express.Router();

/**
 * @swagger
 * /companies:
 *   get:
 *     summary: Get all companies for owner
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of companies
 */
router.get('/', authenticateOwner, async (req, res, next) => {
  try {
    const [companies] = await db.execute(
      'SELECT * FROM companies WHERE owner_id = ? AND is_active = 1',
      [req.owner.id]
    );
    
    res.json({ companies });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /companies:
 *   post:
 *     summary: Create new company
 *     tags: [Companies]
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
 *         description: Company created successfully
 */
router.post('/', authenticateOwner, validate(schemas.company), async (req, res, next) => {
  try {
    const companyData = { ...req.body, owner_id: req.owner.id };
    
    const fields = Object.keys(companyData);
    const values = Object.values(companyData);
    const placeholders = fields.map(() => '?').join(', ');
    
    const [result] = await db.execute(
      `INSERT INTO companies (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    );
    
    const [newCompany] = await db.execute(
      'SELECT * FROM companies WHERE id = ?',
      [result.insertId]
    );
    
    res.status(201).json({
      message: 'Company created successfully',
      company: newCompany[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /companies/{id}:
 *   put:
 *     summary: Update company
 *     tags: [Companies]
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
 *         description: Company updated successfully
 */
router.put('/:id', authenticateOwner, validate(schemas.company), async (req, res, next) => {
  try {
    const fields = Object.keys(req.body);
    const values = Object.values(req.body);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    
    const [result] = await db.execute(
      `UPDATE companies SET ${setClause} WHERE id = ? AND owner_id = ?`,
      [...values, req.params.id, req.owner.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json({ message: 'Company updated successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /companies/{id}:
 *   delete:
 *     summary: Delete company (soft delete)
 *     tags: [Companies]
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
 *         description: Company deleted successfully
 */
router.delete('/:id', authenticateOwner, async (req, res, next) => {
  try {
    const [result] = await db.execute(
      'UPDATE companies SET is_active = 0 WHERE id = ? AND owner_id = ?',
      [req.params.id, req.owner.id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;