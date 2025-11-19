const express = require("express");
const db = require("../config/database");
const { authenticateOwner } = require("../middleware/auth");
const { validate, schemas } = require("../middleware/validation");

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
router.get("/", authenticateOwner, async (req, res, next) => {
  try {
    const [companies] = await db.execute(
      "SELECT * FROM companies WHERE owner_id = ? AND is_active = 1",
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
 *     summary: Create a new company
 *     description: Allows an authenticated owner to create a new company.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Eyecon Consultant"
 *               business_type:
 *                 type: string
 *                 example: "Software"
 *               description:
 *                 type: string
 *                 example: "POS & business software provider"
 *               industry:
 *                 type: string
 *                 example: "IT"
 *               website_url:
 *                 type: string
 *                 example: "https://eyeconconsultant.com"
 *               logo_url:
 *                 type: string
 *                 example: "https://example.com/logo.png"
 *               is_frozen:
 *                 type: integer
 *                 example: 0
 *               frozen_at:
 *                 type: string
 *                 format: date-time
 *                 example: null
 *               frozen_by:
 *                 type: integer
 *                 example: null
 *               freeze_reason:
 *                 type: string
 *                 example: null
 *               smtp_host:
 *                 type: string
 *                 example: "smtp.gmail.com"
 *               smtp_port:
 *                 type: integer
 *                 example: 587
 *               smtp_user:
 *                 type: string
 *                 example: "support@eyecon.com"
 *               smtp_pass:
 *                 type: string
 *                 example: "123456"
 *               to_emails:
 *                 type: string
 *                 example: "admin@test.com,info@test.com"
 *               allow_user_registration:
 *                 type: integer
 *                 example: 1
 *               max_users:
 *                 type: integer
 *                 example: 50
 *             required:
 *               - name
 *     responses:
 *       201:
 *         description: Company created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Company created successfully
 *                 company:
 *                   type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized (Owner token missing or invalid)
 *       500:
 *         description: Server error
 */

router.post(
  "/",
  authenticateOwner,
  // validate(schemas.company),
  async (req, res, next) => {
    try {
      const companyData = { ...req.body, owner_id: req.owner.id };

       if (companyData.to_emails) {
        if (Array.isArray(companyData.to_emails)) {
          companyData.to_emails = JSON.stringify(companyData.to_emails);
        } else if (typeof companyData.to_emails === "string") {
          const emailsArray = companyData.to_emails
            .split(",")
            .map(e => e.trim())
            .filter(Boolean);
          companyData.to_emails = JSON.stringify(emailsArray);
        }
      } else {
        companyData.to_emails = null; 
      }

      const fields = Object.keys(companyData);
      const values = Object.values(companyData);
      const placeholders = fields.map(() => "?").join(", ");

      const [result] = await db.execute(
        `INSERT INTO companies (${fields.join(", ")}) VALUES (${placeholders})`,
        values
      );

      const [newCompany] = await db.execute(
        "SELECT * FROM companies WHERE id = ?",
        [result.insertId]
      );

      res.status(201).json({
        message: "Company created successfully",
        company: newCompany[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /companies/{id}:
 *   put:
 *     summary: Update an existing company
 *     description: Allows an authenticated owner to update one of their companies.
 *     tags: [Companies]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the company to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Eyecon Consultant"
 *               business_type:
 *                 type: string
 *                 example: "Software"
 *               description:
 *                 type: string
 *                 example: "POS & business software provider"
 *               industry:
 *                 type: string
 *                 example: "IT"
 *               website_url:
 *                 type: string
 *                 example: "https://eyeconconsultant.com"
 *               logo_url:
 *                 type: string
 *                 example: "https://example.com/logo.png"
 *               is_frozen:
 *                 type: integer
 *                 example: 0
 *               frozen_at:
 *                 type: string
 *                 format: date-time
 *                 example: null
 *               frozen_by:
 *                 type: integer
 *                 example: null
 *               freeze_reason:
 *                 type: string
 *                 example: null
 *               smtp_host:
 *                 type: string
 *                 example: "smtp.gmail.com"
 *               smtp_port:
 *                 type: integer
 *                 example: 587
 *               smtp_user:
 *                 type: string
 *                 example: "support@eyecon.com"
 *               smtp_pass:
 *                 type: string
 *                 example: "123456"
 *               to_emails:
 *                 type: string
 *                 example: "admin@test.com,info@test.com"
 *               allow_user_registration:
 *                 type: integer
 *                 example: 1
 *               max_users:
 *                 type: integer
 *                 example: 50
 *     responses:
 *       200:
 *         description: Company updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Company updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized (Owner token missing or invalid)
 *       404:
 *         description: Company not found
 *       500:
 *         description: Server error
 */
router.put(
  "/:id",
  authenticateOwner,
  // validate(schemas.company),
  async (req, res, next) => {
    try {
      const companyData = { ...req.body };

      if (companyData.to_emails) {
        if (Array.isArray(companyData.to_emails)) {
          companyData.to_emails = JSON.stringify(companyData.to_emails);
        } else if (typeof companyData.to_emails === "string") {
          const emailsArray = companyData.to_emails
            .split(",")
            .map(e => e.trim())
            .filter(Boolean);
          companyData.to_emails = JSON.stringify(emailsArray);
        }
      }

      const fields = Object.keys(companyData);
      const values = Object.values(companyData);
      const setClause = fields.map((field) => `${field} = ?`).join(", ");

      const [result] = await db.execute(
        `UPDATE companies SET ${setClause} WHERE id = ? AND owner_id = ?`,
        [...values, req.params.id, req.owner.id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Company not found" });
      }

      res.json({ message: "Company updated successfully" });
    } catch (error) {
      next(error);
    }
  }
);

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
router.delete("/:id", authenticateOwner, async (req, res, next) => {
  try {
    const [result] = await db.execute(
      "UPDATE companies SET is_active = 0 WHERE id = ? AND owner_id = ?",
      [req.params.id, req.owner.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json({ message: "Company deleted successfully" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
