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
 *     summary: Universal Login with Role-Based User Type
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
 *               password:
 *                 type: string
 *               company_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Login successful
 *                 token:
 *                   type: string
 *                 refresh_token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     email:
 *                       type: string
 *                     userType:
 *                       type: string
 *                     role:
 *                       type: string
 *                     hasFullAccess:
 *                       type: boolean
 *                 expires_in:
 *                   type: string
 *                   example: 24h
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post("/login", loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password, company_id } = req.body;

    // ============ VALIDATION ============
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
        code: "MISSING_CREDENTIALS",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        message: "Invalid email format",
        code: "INVALID_EMAIL",
      });
    }

    let user = null;
    let userType = null;
    let userRole = null;
    let hasFullAccess = false;

    // ============ STEP 1: Check in OWNERS table ============
    const [owners] = await db.execute(
      "SELECT id, name, email, password_hash, created_at FROM owners WHERE email = ? AND is_active = 1",
      [email.toLowerCase().trim()]
    );

    if (owners.length > 0) {
      user = owners[0];
      userType = "owner";
      userRole = "Super Admin";
      hasFullAccess = true; // Owner always has full access
    } else {
      // ============ STEP 2: Check in USERS table ============

      // For users WITHOUT company_id (admin types)
      if (!company_id) {
        const [usersWithoutCompany] = await db.execute(
          `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, 
                  u.password_hash, u.is_active, u.created_at, u.last_login_at,
                  u.assigned_role_id,
                  c.name as company_name, c.is_frozen,
                  cr.role_key, cr.role_name
           FROM users u 
           JOIN companies c ON u.company_id = c.id 
           LEFT JOIN company_roles cr ON u.assigned_role_id = cr.id
           WHERE u.email = ? AND c.is_active = 1`,
          [email.toLowerCase().trim()]
        );

        if (usersWithoutCompany.length > 0) {
          user = usersWithoutCompany[0];

          // Check if company is frozen
          if (user.is_frozen) {
            return res.status(403).json({
              message: "Company is frozen. Please contact support.",
              code: "COMPANY_FROZEN",
            });
          }

          // Determine userType based on role
          if (user.role_key) {
            userType = user.role_key;
            userRole = user.role_name;
          } else {
            userType = "user";
            userRole = "User";
          }

          // Check permissions to determine hasFullAccess
          if (user.assigned_role_id) {
            const [permissionCount] = await db.execute(
              `SELECT COUNT(DISTINCT sp.id) as total_permissions,
                      COUNT(DISTINCT CASE WHEN sm.module_key IN ('users', 'roles', 'companies', 'settings') THEN sp.id END) as admin_permissions
               FROM role_permissions rp
               INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
               INNER JOIN system_modules sm ON sp.module_id = sm.id
               WHERE rp.company_role_id = ? AND sm.is_active = 1 AND sp.is_active = 1`,
              [user.assigned_role_id]
            );

            // User has full access if they have permissions for critical admin modules
            hasFullAccess = permissionCount[0].admin_permissions > 0;
          }
        }
      } else {
        // For users WITH company_id (regular users)
        if (isNaN(company_id) || company_id <= 0) {
          return res.status(400).json({
            error: "Invalid company ID",
            code: "INVALID_COMPANY_ID",
          });
        }

        // Verify company exists and is active
        const [companies] = await db.execute(
          "SELECT id, name, is_active, is_frozen FROM companies WHERE id = ?",
          [company_id]
        );

        if (companies.length === 0) {
          return res.status(401).json({
            error: "Invalid company",
            code: "COMPANY_NOT_FOUND",
          });
        }

        if (!companies[0].is_active) {
          return res.status(403).json({
            message: "Company is deactivated. Please contact support.",
            code: "COMPANY_DEACTIVATED",
          });
        }

        if (companies[0].is_frozen) {
          return res.status(403).json({
            message: "Company is frozen. Please contact support.",
            code: "COMPANY_FROZEN",
          });
        }

        // Get user with specific company
        const [users] = await db.execute(
          `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, 
                  u.password_hash, u.is_active, u.created_at, u.last_login_at,
                  u.assigned_role_id,
                  c.name as company_name,
                  cr.role_key, cr.role_name
           FROM users u 
           JOIN companies c ON u.company_id = c.id 
           LEFT JOIN company_roles cr ON u.assigned_role_id = cr.id
           WHERE u.email = ? AND u.company_id = ? AND c.is_active = 1`,
          [email.toLowerCase().trim(), company_id]
        );

        if (users.length > 0) {
          user = users[0];

          // Determine userType based on role
          if (user.role_key) {
            userType = user.role_key;
            userRole = user.role_name;
          } else {
            userType = "user";
            userRole = "User";
          }

          // Check if user is active
          if (!user.is_active) {
            return res.status(403).json({
              message:
                "Your account is deactivated. Please contact your administrator.",
              code: "USER_DEACTIVATED",
            });
          }

          // Check permissions to determine hasFullAccess
          if (user.assigned_role_id) {
            const [permissionCount] = await db.execute(
              `SELECT COUNT(DISTINCT sp.id) as total_permissions,
                      COUNT(DISTINCT CASE WHEN sm.module_key IN ('users', 'roles', 'companies', 'settings') THEN sp.id END) as admin_permissions
               FROM role_permissions rp
               INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
               INNER JOIN system_modules sm ON sp.module_id = sm.id
               WHERE rp.company_role_id = ? AND sm.is_active = 1 AND sp.is_active = 1`,
              [user.assigned_role_id]
            );

            // User has full access if they have permissions for critical admin modules
            hasFullAccess = permissionCount[0].admin_permissions > 0;
          }
        }
      }
    }

    // ============ STEP 3: User not found ============
    if (!user) {
      return res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // ============ STEP 4: Verify password ============
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      console.log(`Failed login attempt for email: ${email}, IP: ${req.ip}`);

      return res.status(401).json({
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      });
    }

    // ============ STEP 5: Security tracking ============
    const userAgent = req.get("User-Agent");
    const clientIP = req.ip || req.connection.remoteAddress;

    if (userType === "owner") {
      await db.execute(
        "UPDATE owners SET last_login_at = NOW(), last_login_ip = ?, last_user_agent = ? WHERE id = ?",
        [clientIP, userAgent, user.id]
      );
    } else {
      await db.execute(
        "UPDATE users SET last_login_at = NOW(), last_login_ip = ?, last_user_agent = ? WHERE id = ?",
        [clientIP, userAgent, user.id]
      );
    }

    // ============ STEP 6: Fetch User Permissions (Hierarchy) ============
    let permissions = [];

    if (userType === "owner") {
      // Owner gets ALL system permissions with full hierarchy
      const [allPermissions] = await db.execute(
        `SELECT 
          sm.id as module_id,
          sm.module_key,
          sm.module_name,
          sm.module_group,
          sm.icon,
          sm.sort_order,
          sp.id as permission_id,
          sp.permission_key,
          sp.permission_name,
          1 as can_grant
        FROM system_modules sm
        LEFT JOIN system_permissions sp ON sm.id = sp.module_id
        WHERE sm.is_active = 1 AND (sp.is_active = 1 OR sp.id IS NULL)
        ORDER BY sm.module_group, sm.sort_order, sm.module_key, sp.permission_key`
      );

      // Structure permissions hierarchically
      permissions = structurePermissions(allPermissions);
    } else if (user.assigned_role_id) {
      // Regular user - fetch their role-based permissions
      const [rolePermissions] = await db.execute(
        `SELECT 
          sm.id as module_id,
          sm.module_key,
          sm.module_name,
          sm.module_group,
          sm.icon,
          sm.sort_order,
          sp.id as permission_id,
          sp.permission_key,
          sp.permission_name,
          rp.can_grant
        FROM role_permissions rp
        INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
        INNER JOIN system_modules sm ON sp.module_id = sm.id
        WHERE rp.company_role_id = ? 
          AND sm.is_active = 1 
          AND sp.is_active = 1
        
        UNION
        
        SELECT 
          sm.id as module_id,
          sm.module_key,
          sm.module_name,
          sm.module_group,
          sm.icon,
          sm.sort_order,
          sp.id as permission_id,
          sp.permission_key,
          sp.permission_name,
          0 as can_grant
        FROM user_permission_overrides upo
        INNER JOIN system_permissions sp ON upo.system_permission_id = sp.id
        INNER JOIN system_modules sm ON sp.module_id = sm.id
        WHERE upo.user_id = ? 
          AND upo.is_granted = 1
          AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
          AND sm.is_active = 1 
          AND sp.is_active = 1
        
        ORDER BY module_group, sort_order, module_key, permission_key`,
        [user.assigned_role_id, user.id]
      );

      // Structure permissions hierarchically
      permissions = structurePermissions(rolePermissions);
    }

    // Helper function to structure permissions
    function structurePermissions(flatPermissions) {
      const grouped = {};

      flatPermissions.forEach((perm) => {
        const moduleKey = perm.module_key;

        if (!grouped[moduleKey]) {
          grouped[moduleKey] = {
            module_id: perm.module_id,
            module_key: perm.module_key,
            module_name: perm.module_name,
            module_group: perm.module_group,
            icon: perm.icon,
            sort_order: perm.sort_order,
            permissions: [],
          };
        }

        if (perm.permission_id) {
          grouped[moduleKey].permissions.push({
            permission_id: perm.permission_id,
            permission_key: perm.permission_key,
            permission_name: perm.permission_name,
            can_grant: !!perm.can_grant,
          });
        }
      });

      // Convert to array and group by module_group
      const moduleGroups = {};
      Object.values(grouped).forEach((module) => {
        const group = module.module_group || "OTHER";
        if (!moduleGroups[group]) {
          moduleGroups[group] = [];
        }
        moduleGroups[group].push(module);
      });

      // Sort modules within each group
      Object.keys(moduleGroups).forEach((group) => {
        moduleGroups[group].sort((a, b) => a.sort_order - b.sort_order);
      });

      return moduleGroups;
    }

    // ============ STEP 7: Create JWT token ============
    let tokenPayload = {
      id: user.id,
      email: user.email,
      userType,
      role: userRole,
      hasFullAccess,
      iat: Math.floor(Date.now() / 1000),
      ip: clientIP,
      userAgent: userAgent,
    };

    let responseUser = {
      id: user.id,
      email: user.email,
      userType,
      role: userRole,
      hasFullAccess,
      last_login_at: user.last_login_at,
      permissions, // Add complete permission hierarchy
    };

    if (userType === "owner") {
      tokenPayload.name = user.name;
      responseUser.name = user.name;
    } else {
      tokenPayload.companyId = user.company_id;
      tokenPayload.firstName = user.first_name;
      tokenPayload.lastName = user.last_name;
      tokenPayload.companyName = user.company_name;
      tokenPayload.roleId = user.assigned_role_id;
      tokenPayload.roleKey = user.role_key;

      responseUser.first_name = user.first_name;
      responseUser.last_name = user.last_name;
      responseUser.company_id = user.company_id;
      responseUser.company_name = user.company_name;
      responseUser.role_id = user.assigned_role_id;
      responseUser.role_key = user.role_key;
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "24h",
      issuer: userType === "owner" ? "system-owner" : user.company_name,
      audience: userType,
    });

    const refreshToken = jwt.sign(
      { id: user.id, userType },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log(
      `Successful login: ${email}, Type: ${userType}, Role: ${userRole}, HasFullAccess: ${hasFullAccess}, IP: ${clientIP}`
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
