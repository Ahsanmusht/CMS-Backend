const express = require("express");
const db = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const Joi = require("joi");
const { validate } = require("../middleware/validation");
const { requirePermission } = require("../middleware/rbac");

const router = express.Router();

const policySchema = Joi.object({
  client_id: Joi.number().integer().required(),
  policy_type: Joi.string().max(100).required(),
  policy_number: Joi.string().max(100).required(),
  start_date: Joi.date().required(),
  end_date: Joi.date().required(),
  premium_amount: Joi.number().precision(2).min(0).required(),
  payment_frequency: Joi.string().max(20).required(),
  status: Joi.string().max(20).required(),
  coverage_details: Joi.object(),
  notes: Joi.string(),
});

/**
 * @swagger
 * /policies:
 *   get:
 *     summary: Get all policies
 *     tags: [Policies]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of policies
 */
router.get(
  "/",
  authenticateToken,
  requirePermission("policies", "view_policies"),
  async (req, res, next) => {
    try {
      const [policies] = await db.execute(
        `SELECT p.*, CONCAT(c.first_name, ' ', c.last_name) as client_name
       FROM policies p
       JOIN clients c ON p.client_id = c.id
       WHERE p.company_id = ?
       ORDER BY p.created_at DESC`,
        [req.user.company_id]
      );

      res.json({ policies });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /policies:
 *   post:
 *     summary: Create new policy
 *     tags: [Policies]
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
 *         description: Policy created successfully
 */
router.post(
  "/",
  authenticateToken,
  requirePermission("policies", "create_policy"),
  validate(policySchema),
  async (req, res, next) => {
    try {
      const policyData = {
        ...req.body,
        company_id: req.user.company_id,
        coverage_details: JSON.stringify(req.body.coverage_details || {}),
      };

      const fields = Object.keys(policyData);
      const values = Object.values(policyData);
      const placeholders = fields.map(() => "?").join(", ");

      const [result] = await db.execute(
        `INSERT INTO policies (${fields.join(", ")}) VALUES (${placeholders})`,
        values
      );

      res.status(201).json({
        message: "Policy created successfully",
        policy_id: result.insertId,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /policies/{id}:
 *   put:
 *     summary: Update policy
 *     tags: [Policies]
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
 *         description: Policy updated successfully
 */
router.put(
  "/:id",
  authenticateToken,
  requirePermission("policies", "edit_policy"),
  validate(policySchema),
  async (req, res, next) => {
    try {
      const updateData = {
        ...req.body,
        coverage_details: JSON.stringify(req.body.coverage_details || {}),
      };

      const fields = Object.keys(updateData);
      const values = Object.values(updateData);
      const setClause = fields.map((field) => `${field} = ?`).join(", ");

      const [result] = await db.execute(
        `UPDATE policies SET ${setClause} WHERE id = ? AND company_id = ?`,
        [...values, req.params.id, req.user.company_id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Policy not found" });
      }

      res.json({ message: "Policy updated successfully" });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /policies/{id}:
 *   delete:
 *     summary: Delete policy
 *     tags: [Policies]
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
 *         description: Policy deleted successfully
 */
router.delete(
  "/:id",
  authenticateToken,
  requirePermission("policies", "delete_policy"),
  async (req, res, next) => {
    try {
      const [result] = await db.execute(
        "DELETE FROM policies WHERE id = ? AND company_id = ?",
        [req.params.id, req.user.company_id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Policy not found" });
      }

      res.json({ message: "Policy deleted successfully" });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
