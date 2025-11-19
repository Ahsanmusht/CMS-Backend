const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/database");
const {
  validate,
  schemas,
  validatePasswordDetailed,
} = require("../middleware/validation");
const { validateProfileToken } = require("../middleware/profileToken");
const { loginRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

/**
 * @swagger
 * /auth/register-owner:
 *   post:
 *     summary: Register a new business owner
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: Owner registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 */
router.post(
  "/register-owner",
  validate(schemas.owner),
  async (req, res, next) => {
    try {
      const { name, email, password } = req.body;

      // Check if email already exists in either table
      const [existingOwners] = await db.execute(
        "SELECT id FROM owners WHERE email = ?",
        [email]
      );
      const [existingUsers] = await db.execute(
        "SELECT id FROM users WHERE email = ?",
        [email]
      );

      if (existingOwners.length > 0 || existingUsers.length > 0) {
        return res.status(409).json({ error: "Email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 12);

      const [result] = await db.execute(
        "INSERT INTO owners (name, email, password_hash) VALUES (?, ?, ?)",
        [name, email, hashedPassword]
      );

      const token = jwt.sign(
        {
          id: result.insertId,
          email,
          userType: "owner",
          name,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN }
      );

      res.status(201).json({
        message: "Owner registered successfully",
        token,
        user: {
          id: result.insertId,
          name,
          email,
          userType: "owner",
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @swagger
 * /auth/register-user:
 *   post:
 *     summary: Register a new company user with advanced security
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               last_name:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               company_id:
 *                 type: integer
 *                 minimum: 1
 *               phone:
 *                 type: string
 *                 description: Optional phone number
 *             required:
 *               - first_name
 *               - last_name
 *               - email
 *               - password
 *               - company_id
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or invalid data
 *       409:
 *         description: Email already exists in this company
 *       403:
 *         description: Company is not active or registration not allowed
 */
router.post(
  "/register-user",
  validate(schemas.user),
  async (req, res, next) => {
    try {
      const { first_name, last_name, email, password, company_id, phone } =
        req.body;

      // Comprehensive input validation
      if (!first_name || !last_name || !email || !password || !company_id) {
        return res.status(400).json({
          message: "All required fields must be provided",
          code: "MISSING_REQUIRED_FIELDS",
          required_fields: [
            "first_name",
            "last_name",
            "email",
            "password",
            "company_id",
          ],
        });
      }

      // Name validation
      if (first_name.trim().length < 2 || first_name.trim().length > 50) {
        return res.status(400).json({
          message: "First name must be between 2 and 50 characters",
          code: "INVALID_FIRST_NAME",
        });
      }

      if (last_name.trim().length < 2 || last_name.trim().length > 50) {
        return res.status(400).json({
          message: "Last name must be between 2 and 50 characters",
          code: "INVALID_LAST_NAME",
        });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          message: "Invalid email format",
          code: "INVALID_EMAIL_FORMAT",
        });
      }

      // Password strength validation
      const validation = validatePasswordDetailed(password);
      if (!validation.valid) {
        return res.status(400).json({
          message: validation.message,
          code: "INVALID_PASSWORD",
          details: validation.errors,
        });
      }

      // Company ID validation
      if (isNaN(company_id) || company_id <= 0) {
        return res.status(400).json({
          error: "Invalid company ID",
          code: "INVALID_COMPANY_ID",
        });
      }

      // Phone validation (if provided)
      if (phone) {
        const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
        if (!phoneRegex.test(phone)) {
          return res.status(400).json({
            message: "Invalid phone number format",
            code: "INVALID_PHONE",
          });
        }
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedFirstName = first_name.trim();
      const normalizedLastName = last_name.trim();

      // Start transaction for data consistency
      await db.execute("START TRANSACTION");

      try {
        // First verify company exists and is active
        const [companies] = await db.execute(
          "SELECT id, name, is_active, allow_user_registration, max_users FROM companies WHERE id = ?",
          [company_id]
        );

        if (!companies.length) {
          await db.execute("ROLLBACK");
          return res.status(400).json({
            error: "Company not found",
            code: "COMPANY_NOT_FOUND",
          });
        }

        const company = companies[0];

        // Check if company is active
        if (!company.is_active) {
          await db.execute("ROLLBACK");
          return res.status(403).json({
            message: "Company is not active. Registration is not allowed.",
            code: "COMPANY_INACTIVE",
          });
        }

        // Check if company allows user registration
        if (!company.allow_user_registration) {
          await db.execute("ROLLBACK");
          return res.status(403).json({
            message:
              "User registration is not allowed for this company. Contact your administrator.",
            code: "REGISTRATION_DISABLED",
          });
        }

        // Check company user limit
        if (company.max_users) {
          const [userCount] = await db.execute(
            "SELECT COUNT(*) as count FROM users WHERE company_id = ? AND is_active = 1",
            [company_id]
          );

          if (
            company.max_users !== null &&
            userCount[0].count >= company.max_users
          ) {
            await db.execute("ROLLBACK");
            return res.status(403).json({
              message:
                "Company has reached maximum user limit. Contact your administrator.",
              code: "USER_LIMIT_EXCEEDED",
            });
          }
        }

        // Check if email already exists globally (across all companies and owners)
        const [existingOwners] = await db.execute(
          "SELECT id, email FROM owners WHERE email = ?",
          [normalizedEmail]
        );

        if (existingOwners.length > 0) {
          await db.execute("ROLLBACK");
          return res.status(409).json({
            message: "This email is already registered.", //(as an owner account) yai is liyai nh kia security reasons
            code: "EMAIL_EXISTS_OWNER",
          });
        }

        // Check if email exists in the SAME company (this should not be allowed)
        const [existingUsersInCompany] = await db.execute(
          "SELECT id, email, company_id FROM users WHERE email = ? AND company_id = ?",
          [normalizedEmail, company_id]
        );

        if (existingUsersInCompany.length > 0) {
          await db.execute("ROLLBACK");
          return res.status(409).json({
            message: "Email already exists in this company",
            code: "EMAIL_EXISTS_IN_COMPANY",
          });
        }

        // Check if email exists in OTHER companies (this is allowed but log for monitoring)
        // const [existingUsersInOtherCompanies] = await db.execute(
        //   'SELECT id, email, company_id FROM users WHERE email = ? AND company_id != ?',
        //   [normalizedEmail, company_id]
        // );

        // if (existingUsersInOtherCompanies.length > 0) {
        //   // Log this for security monitoring
        //   console.log(`Email ${normalizedEmail} already exists in other companies but allowing registration for company ${company_id}`);
        // }

        // Check for phone number duplicates within the same company (if phone provided)
        if (phone) {
          const [existingPhone] = await db.execute(
            "SELECT id FROM users WHERE phone = ? AND company_id = ?",
            [phone.trim(), company_id]
          );

          if (existingPhone.length > 0) {
            await db.execute("ROLLBACK");
            return res.status(409).json({
              message: "Phone number already exists in this company",
              code: "PHONE_EXISTS_IN_COMPANY",
            });
          }
        }

        // Hash password with high security
        const hashedPassword = await bcrypt.hash(password, 12);

        // Get client information for security tracking
        const clientIP = req.ip || req.connection.remoteAddress;
        const userAgent = req.get("User-Agent");

        // Insert new user
        const [result] = await db.execute(
          `INSERT INTO users (
          first_name, last_name, email, password_hash, company_id, 
          phone, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
          [
            normalizedFirstName,
            normalizedLastName,
            normalizedEmail,
            hashedPassword,
            company_id,
            phone ? phone.trim() : null,
          ]
        );

        // Commit transaction
        await db.execute("COMMIT");

        // Create JWT token with comprehensive payload
        const tokenPayload = {
          id: result.insertId,
          email: normalizedEmail,
          userType: "user",
          companyId: company_id,
          firstName: normalizedFirstName,
          lastName: normalizedLastName,
          companyName: company.name,
          iat: Math.floor(Date.now() / 1000),
          ip: clientIP,
          userAgent: userAgent,
        };

        const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
          expiresIn: process.env.JWT_EXPIRES_IN || "24h",
          issuer: company.name,
          audience: "user",
        });

        // Create refresh token
        const refreshToken = jwt.sign(
          { id: result.insertId, userType: "user" },
          process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );

        // Prepare response user object
        const responseUser = {
          id: result.insertId,
          first_name: normalizedFirstName,
          last_name: normalizedLastName,
          email: normalizedEmail,
          company_id: company_id,
          company_name: company.name,
          phone: phone || null,
          userType: "user",
          is_active: true,
          created_at: new Date().toISOString(),
        };

        // Log successful registration
        console.log(
          `New user registered: ${normalizedEmail} for company ${company_id} (${company.name}) from IP: ${clientIP}`
        );

        // Send welcome email (implement this based on your email service)
        // await sendWelcomeEmail(normalizedEmail, normalizedFirstName, company.name);

        res.status(201).json({
          message: "User registered successfully",
          token,
          refresh_token: refreshToken,
          user: responseUser,
          expires_in: process.env.JWT_EXPIRES_IN || "24h",
        });
      } catch (transactionError) {
        // Rollback transaction on any error
        await db.execute("ROLLBACK");
        throw transactionError;
      }
    } catch (error) {
      // Log error for debugging
      console.error("Registration error:", error);

      // Don't expose internal errors
      if (error.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          message: "Email or phone number already exists",
          code: "DUPLICATE_ENTRY",
        });
      }

      res.status(500).json({
        message: "Registration failed. Please try again.",
        code: "REGISTRATION_ERROR",
      });
    }
  }
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Secure universal login for both owners and users with company validation
 *     tags: [Authentication]
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
 *               password:
 *                 type: string
 *               company_id:
 *                 type: integer
 *                 description: Required for user login, optional for owner login
 *             required:
 *               - email
 *               - password
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Missing required fields
 *       401:
 *         description: Invalid credentials or unauthorized access
 *       403:
 *         description: Account deactivated
 */
router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password, company_id } = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
        code: "MISSING_CREDENTIALS",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: "Invalid email format",
        code: "INVALID_EMAIL",
      });
    }

    let user = null;
    let userType = null;

    // First check in owners table (owners don't need company_id)
    const [owners] = await db.execute(
      "SELECT id, name, email, password_hash, created_at FROM owners WHERE email = ? AND is_active = 1",
      [email.toLowerCase().trim()]
    );

    if (owners.length > 0) {
      user = owners[0];
      userType = "owner";
    } else {
      // For users, company_id is mandatory
      if (!company_id) {
        return res.status(400).json({
          message: "Company ID is required for user login",
          code: "MISSING_COMPANY_ID",
        });
      }

      // Validate company_id is a number
      if (isNaN(company_id) || company_id <= 0) {
        return res.status(400).json({
          error: "Invalid company ID",
          code: "INVALID_COMPANY_ID",
        });
      }

      // First verify company exists and is active
      const [companies] = await db.execute(
        "SELECT id, name, is_active FROM companies WHERE id = ?",
        [company_id]
      );

      if (companies.length === 0) {
        return res.status(401).json({
          error: "Invalid company",
          code: "COMPANY_NOT_FOUND",
        });
      }

      const company = companies[0];
      if (!company.is_active) {
        return res.status(403).json({
          message: "Company is deactivated. Please contact support.",
          code: "COMPANY_DEACTIVATED",
        });
      }

      // Now check user with specific company_id constraint
      const [users] = await db.execute(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, 
                u.password_hash, u.is_active, u.created_at, u.last_login_at,
                c.name as company_name
         FROM users u 
         JOIN companies c ON u.company_id = c.id 
         WHERE u.email = ? AND u.company_id = ? AND c.is_active = 1`,
        [email.toLowerCase().trim(), company_id]
      );

      if (users.length > 0) {
        user = users[0];
        userType = "user";

        // Check if user is active
        if (!user.is_active) {
          return res.status(403).json({
            message:
              "Your account is deactivated. Please contact your administrator.",
            code: "USER_DEACTIVATED",
          });
        }
      }
    }

    // If no user found
    if (!user) {
      // Don't reveal which part failed for security
      return res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Verify password with timing attack protection
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      // Log failed attempt for security monitoring
      console.log(
        `Failed login attempt for email: ${email}, IP: ${
          req.ip
        }, UserAgent: ${req.get("User-Agent")}`
      );

      return res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // Additional security: Check for suspicious login patterns
    const userAgent = req.get("User-Agent");
    const clientIP = req.ip || req.connection.remoteAddress;

    // Update last login and security info for users
    if (userType === "user") {
      await db.execute(
        "UPDATE users SET last_login_at = NOW(), last_login_ip = ?, last_user_agent = ? WHERE id = ?",
        [clientIP, userAgent, user.id]
      );
    } else {
      // Update for owners too
      await db.execute(
        "UPDATE owners SET last_login_at = NOW(), last_login_ip = ?, last_user_agent = ? WHERE id = ?",
        [clientIP, userAgent, user.id]
      );
    }

    // Create JWT token with comprehensive payload
    let tokenPayload = {
      id: user.id,
      email: user.email,
      userType,
      iat: Math.floor(Date.now() / 1000),
      // Add client info for token validation
      ip: clientIP,
      userAgent: userAgent,
    };

    let responseUser = {
      id: user.id,
      email: user.email,
      userType,
      last_login_at: user.last_login_at,
    };

    if (userType === "owner") {
      tokenPayload.name = user.name;
      responseUser.name = user.name;
    } else {
      tokenPayload.companyId = user.company_id;
      tokenPayload.firstName = user.first_name;
      tokenPayload.lastName = user.last_name;
      tokenPayload.companyName = user.company_name;

      responseUser.first_name = user.first_name;
      responseUser.last_name = user.last_name;
      responseUser.company_id = user.company_id;
      responseUser.company_name = user.company_name;
    }

    // Create token with shorter expiry for better security
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "24h",
      issuer: userType === "owner" ? "system-owner" : user.company_name,
      audience: userType,
    });

    // Create refresh token for better UX
    const refreshToken = jwt.sign(
      { id: user.id, userType },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Log successful login for security monitoring
    console.log(
      `Successful login: ${email}, Type: ${userType}, IP: ${clientIP}`
    );

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    });

    res.json({
      message: "Login successful",
      token,
      refresh_token: refreshToken,
      user: responseUser,
      expires_in: process.env.JWT_EXPIRES_IN || "24h",
    });
  } catch (error) {
    // Log error for debugging but don't expose details
    console.error("Login error:", error);

    res.status(500).json({
      error: "An error occurred during login. Please try again.",
      code: "SERVER_ERROR",
    });
  }
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/me", async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = null;

    if (decoded.userType === "owner") {
      const [owners] = await db.execute(
        "SELECT id, name, email FROM owners WHERE id = ?",
        [decoded.id]
      );

      if (owners.length > 0) {
        user = {
          ...owners[0],
          userType: "owner",
        };
      }
    } else {
      const [users] = await db.execute(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, u.is_active,
                c.name as company_name
         FROM users u 
         JOIN companies c ON u.company_id = c.id 
         WHERE u.id = ? AND u.is_active = 1`,
        [decoded.id]
      );

      if (users.length > 0) {
        user = {
          ...users[0],
          userType: "user",
        };
      }
    }

    if (!user) {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    res.json({ user });
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    next(error);
  }
});

router.get("/complete-profile", validateProfileToken, async (req, res) => {
  try {
    const user = req.user;

    res.status(200).json({
      message: "Token valid",
      user: {
        id: user.user_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        company_id: user.company_id,
        token_expires_at: user.expires_at,
      },
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "Failed to fetch user data" });
  }
});

// Complete user profile
router.post("/complete-profile", validateProfileToken, async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { password, confirm_password, first_name, last_name } = req.body;

    const user = req.user;
    const token = req.token;

    // Validate required fields
    if (!password || password.length < 6) {
      return res.status(400).json({
        error: "Password is required and must be at least 6 characters",
      });
    }

    if (password !== confirm_password) {
      return res.status(400).json({ error: "Passwords do not match" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user profile
    const updateData = {
      password: hashedPassword,
      first_name: first_name || user.first_name,
      last_name: last_name || user.last_name,
      is_active: 1, // Activate user
      updated_at: new Date(),
    };

    await connection.execute(
      `UPDATE users SET 
       password_hash = ?, first_name = ?, last_name = ?, 
        is_active = ?, updated_at = ?
       WHERE id = ?`,
      [
        updateData.password,
        updateData.first_name,
        updateData.last_name,
        updateData.is_active,
        updateData.updated_at,
        user.user_id,
      ]
    );

    // Mark token as used
    await connection.execute(
      "UPDATE user_profile_tokens SET is_used = 1, updated_at = NOW() WHERE token = ?",
      [token]
    );

    await connection.commit();

    res.status(200).json({
      message: "Profile completed successfully",
      user: {
        id: user.user_id,
        email: user.email,
        first_name: updateData.first_name,
        last_name: updateData.last_name,
        phone: updateData.phone,
        is_active: true,
      },
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error completing profile:", error);
    res.status(500).json({ error: "Failed to complete profile" });
  } finally {
    connection.release();
  }
});

// Check token status (for frontend to show appropriate messages)
router.get("/check-token/:token", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { token } = req.params;

    const [tokens] = await connection.execute(
      `SELECT t.expires_at, t.is_used, u.is_active, u.email
       FROM user_profile_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token = ?`,
      [token]
    );

    if (tokens.length === 0) {
      return res.status(404).json({
        error: "Token not found",
        status: "invalid",
      });
    }

    const tokenData = tokens[0];
    const now = new Date();
    const expiresAt = new Date(tokenData.expires_at);

    if (tokenData.is_used === 1) {
      return res.status(400).json({
        error: "Token already used",
        status: "used",
      });
    }

    if (expiresAt < now) {
      return res.status(400).json({
        error: "Token expired",
        status: "expired",
        expired_at: tokenData.expires_at,
      });
    }

    if (tokenData.is_active === 1) {
      return res.status(400).json({
        error: "Profile already completed",
        status: "completed",
      });
    }

    res.status(200).json({
      message: "Token is valid",
      status: "valid",
      expires_at: tokenData.expires_at,
      email: tokenData.email,
    });
  } catch (error) {
    console.error("Error checking token:", error);
    res.status(500).json({ error: "Failed to check token" });
  } finally {
    connection.release();
  }
});

// Cleanup expired tokens (optional cron job endpoint)
router.delete("/cleanup-expired-tokens", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const [result] = await connection.execute(
      "DELETE FROM user_profile_tokens WHERE expires_at < NOW() AND is_used = 0"
    );

    res.status(200).json({
      message: "Expired tokens cleaned up",
      deleted_count: result.affectedRows,
    });
  } catch (error) {
    console.error("Error cleaning up tokens:", error);
    res.status(500).json({ error: "Failed to cleanup tokens" });
  } finally {
    connection.release();
  }
});

module.exports = router;
