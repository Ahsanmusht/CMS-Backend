const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const Joi = require('joi');
const { validate } = require('../middleware/validation');

const router = express.Router();

// Validation schemas
const userSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  first_name: Joi.string().min(1).max(100).required(),
  last_name: Joi.string().min(1).max(100).required(),
  phone: Joi.string().max(20).allow(null, ''),
  profile_pic_url: Joi.string().uri().allow(null, '')
});

const updateUserSchema = Joi.object({
  email: Joi.string().email(),
  first_name: Joi.string().min(1).max(100),
  last_name: Joi.string().min(1).max(100),
  phone: Joi.string().max(20).allow(null, ''),
  profile_pic_url: Joi.string().uri().allow(null, ''),
  is_active: Joi.boolean()
});

const passwordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(6).required()
});

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users in company
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of users per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                 pagination:
 *                   type: object
 */
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let whereClause = 'WHERE u.company_id = ?';
    let queryParams = [req.user.company_id];

    if (search) {
      whereClause += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
      const searchTerm = `%${search}%`;
      queryParams.push(searchTerm, searchTerm, searchTerm);
    }

    // Get users with pagination
    const [users] = await db.execute(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.profile_pic_url, 
              u.last_login_at, u.is_active, u.created_at, u.updated_at
       FROM users u 
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...queryParams, limit, offset]
    );

    // Get total count for pagination
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM users u ${whereClause}`,
      queryParams
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        totalPages,
        totalUsers: total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
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
 *         description: User details
 *       404:
 *         description: User not found
 */
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    const [users] = await db.execute(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.profile_pic_url, 
              u.last_login_at, u.is_active, u.created_at, u.updated_at
       FROM users u 
       WHERE u.id = ? AND u.company_id = ?`,
      [userId, req.user.company_id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - first_name
 *               - last_name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               profile_pic_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 */
router.post('/', authenticateToken, validate(userSchema), async (req, res, next) => {
  try {
    const { email, password, first_name, last_name, phone, profile_pic_url } = req.body;

    // Check if email already exists in the company
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE email = ? AND company_id = ?',
      [email, req.user.company_id]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists in this company'
      });
    }

    // Hash password
    const saltRounds = 12;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert new user
    const [result] = await db.execute(
      `INSERT INTO users (company_id, email, password_hash, first_name, last_name, phone, profile_pic_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.company_id, email, password_hash, first_name, last_name, phone || null, profile_pic_url || null]
    );

    // Get the created user
    const [newUsers] = await db.execute(
      `SELECT id, email, first_name, last_name, phone, profile_pic_url, is_active, created_at
       FROM users WHERE id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: newUsers[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update user
 *     tags: [Users]
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
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               profile_pic_url:
 *                 type: string
 *                 format: uri
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       404:
 *         description: User not found
 *       409:
 *         description: Email already exists
 */
router.put('/:id', authenticateToken, validate(updateUserSchema), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const updates = req.body;

    // Check if user exists in the company
    const [existingUsers] = await db.execute(
      'SELECT id, email FROM users WHERE id = ? AND company_id = ?',
      [userId, req.user.company_id]
    );

    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If email is being updated, check for duplicates
    if (updates.email && updates.email !== existingUsers[0].email) {
      const [emailCheck] = await db.execute(
        'SELECT id FROM users WHERE email = ? AND company_id = ? AND id != ?',
        [updates.email, req.user.company_id, userId]
      );

      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Email already exists in this company'
        });
      }
    }

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      updateFields.push(`${key} = ?`);
      updateValues.push(updates[key]);
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(userId, req.user.company_id);

    await db.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ? AND company_id = ?`,
      updateValues
    );

    // Get updated user
    const [updatedUsers] = await db.execute(
      `SELECT id, email, first_name, last_name, phone, profile_pic_url, is_active, updated_at
       FROM users WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'User updated successfully',
      user: updatedUsers[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/{id}/password:
 *   put:
 *     summary: Update user password
 *     tags: [Users]
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
 *             type: object
 *             required:
 *               - current_password
 *               - new_password
 *             properties:
 *               current_password:
 *                 type: string
 *               new_password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Invalid current password
 *       404:
 *         description: User not found
 */
router.put('/:id/password', authenticateToken, validate(passwordSchema), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const { current_password, new_password } = req.body;

    // Check if user exists and get current password hash
    const [users] = await db.execute(
      'SELECT id, password_hash FROM users WHERE id = ? AND company_id = ?',
      [userId, req.user.company_id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(current_password, users[0].password_hash);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const saltRounds = 12;
    const new_password_hash = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await db.execute(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [new_password_hash, userId]
    );

    res.json({
      success: true,
      message: 'Password updated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete user (soft delete by setting is_active to false)
 *     tags: [Users]
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
 *         description: User deleted successfully
 *       404:
 *         description: User not found
 */
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    // Check if user exists
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE id = ? AND company_id = ?',
      [userId, req.user.company_id]
    );

    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Soft delete by setting is_active to false
    await db.execute(
      'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/{id}/activate:
 *   put:
 *     summary: Activate user
 *     tags: [Users]
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
 *         description: User activated successfully
 *       404:
 *         description: User not found
 */
router.put('/:id/activate', authenticateToken, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    // Check if user exists
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE id = ? AND company_id = ?',
      [userId, req.user.company_id]
    );

    if (existingUsers.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Activate user
    await db.execute(
      'UPDATE users SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [userId]
    );

    res.json({
      success: true,
      message: 'User activated successfully'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/profile:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 */
router.get('/profile', authenticateToken, async (req, res, next) => {
  try {
    const [users] = await db.execute(
      `SELECT id, email, first_name, last_name, phone, profile_pic_url, 
              last_login_at, created_at, updated_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /users/profile:
 *   put:
 *     summary: Update current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               profile_pic_url:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put('/profile', authenticateToken, validate(updateUserSchema), async (req, res, next) => {
  try {
    const updates = req.body;
    
    // Remove email from updates for profile update (security)
    delete updates.email;
    delete updates.is_active;

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];

    Object.keys(updates).forEach(key => {
      updateFields.push(`${key} = ?`);
      updateValues.push(updates[key]);
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(req.user.id);

    await db.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Get updated user
    const [updatedUsers] = await db.execute(
      `SELECT id, email, first_name, last_name, phone, profile_pic_url, updated_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUsers[0]
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;