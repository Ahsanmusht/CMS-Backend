const express = require("express");
const db = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const Joi = require("joi");
const { validate } = require("../middleware/validation");
const { requirePermission } = require("../middleware/rbac");

const router = express.Router();

const paymentSchema = Joi.object({
  client_id: Joi.number().integer().required(),
  amount: Joi.number().precision(2).min(0).required(),
  payment_method: Joi.string().max(50).required(),
  payment_date: Joi.date().required(),
  transaction_id: Joi.string().max(100),
  payment_for_type: Joi.string().max(50).required(),
  payment_for_id: Joi.number().integer().required(),
  notes: Joi.string(),
});

/**
 * @swagger
 * /payments:
 *   get:
 *     summary: Get all payments
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of payments
 */
router.get(
  "/",
  authenticateToken,
  requirePermission("payments", "view_payments"),
  async (req, res, next) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      const [payments] = await db.execute(
        `SELECT p.*, CONCAT(c.first_name, ' ', c.last_name) as client_name
       FROM payments p
       JOIN clients c ON p.client_id = c.id
       WHERE p.company_id = ?
       ORDER BY p.payment_date DESC
       LIMIT ? OFFSET ?`,
        [req.user.company_id, parseInt(limit), parseInt(offset)]
      );

      res.json({ payments });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /payments:
 *   post:
 *     summary: Create new payment
 *     tags: [Payments]
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
 *         description: Payment created successfully
 */
router.post(
  "/",
  authenticateToken,
  requirePermission("payments", "create_payment"),
  validate(paymentSchema),
  async (req, res, next) => {
    try {
      const paymentData = { ...req.body, company_id: req.user.company_id };

      const fields = Object.keys(paymentData);
      const values = Object.values(paymentData);
      const placeholders = fields.map(() => "?").join(", ");

      const [result] = await db.execute(
        `INSERT INTO payments (${fields.join(", ")}) VALUES (${placeholders})`,
        values
      );

      res.status(201).json({
        message: "Payment created successfully",
        payment_id: result.insertId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /payments/{id}:
 *   put:
 *     summary: Update payment
 *     tags: [Payments]
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
 *         description: Payment updated successfully
 */
router.put(
  "/:id",
  authenticateToken,
  requirePermission("payments", "edit_payment"),
  validate(paymentSchema),
  async (req, res, next) => {
    try {
      const fields = Object.keys(req.body);
      const values = Object.values(req.body);
      const setClause = fields.map((field) => `${field} = ?`).join(", ");

      const [result] = await db.execute(
        `UPDATE payments SET ${setClause} WHERE id = ? AND company_id = ?`,
        [...values, req.params.id, req.user.company_id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Payment not found" });
      }

      res.json({ message: "Payment updated successfully" });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /payments/{id}:
 *   delete:
 *     summary: Delete payment
 *     tags: [Payments]
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
 *         description: Payment deleted successfully
 */
router.delete(
  "/:id",
  authenticateToken,
  requirePermission("payments", "delete_payment"),
  async (req, res, next) => {
    try {
      const [result] = await db.execute(
        "DELETE FROM payments WHERE id = ? AND company_id = ?",
        [req.params.id, req.user.company_id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Payment not found" });
      }

      res.json({ message: "Payment deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
