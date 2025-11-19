const db = require("../config/database");

/**
 * Middleware to check if user has specific permission
 * Usage: requirePermission('module_key', 'permission_key')
 */
const requirePermission = (moduleKey, permissionKey) => {
  return async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
          code: "UNAUTHORIZED",
        });
      }

      const userId = req.user.id;
      const userType = req.user.userType;

      // ✅ FIX 1: Owner ko bypass karo - owner has ALL permissions
      if (userType === "owner") {
        console.log(
          `✅ Owner access granted for ${moduleKey}.${permissionKey}`
        );
        return next(); // Owner ke liye seedha allow karo
      }

      // Regular user ke liye checks
      const companyId = req.user.company_id;

      // Check if company is frozen
      const [company] = await db.execute(
        "SELECT is_frozen FROM companies WHERE id = ?",
        [companyId]
      );

      if (company.length > 0 && company[0].is_frozen) {
        return res.status(403).json({
          success: false,
          message: "Company is currently frozen. All operations are suspended.",
          code: "COMPANY_FROZEN",
        });
      }

      // Check if user is active
      const [user] = await db.execute(
        "SELECT is_active FROM users WHERE id = ?",
        [userId]
      );

      if (user.length === 0 || !user[0].is_active) {
        return res.status(403).json({
          success: false,
          message: "User account is not active",
          code: "USER_INACTIVE",
        });
      }

      // Check permission from role
      const [rolePermission] = await db.execute(
        `SELECT COUNT(*) as has_permission
         FROM users u
         INNER JOIN company_roles cr ON u.assigned_role_id = cr.id
         INNER JOIN role_permissions rp ON cr.id = rp.company_role_id
         INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
         INNER JOIN system_modules sm ON sp.module_id = sm.id
         WHERE u.id = ? 
         AND sm.module_key = ? 
         AND sp.permission_key = ?
         AND u.is_active = 1 
         AND cr.is_active = 1 
         AND sm.is_active = 1 
         AND sp.is_active = 1`,
        [userId, moduleKey, permissionKey]
      );

      if (rolePermission[0].has_permission > 0) {
        return next();
      }

      // Check for user-specific override
      const [override] = await db.execute(
        `SELECT COUNT(*) as has_override
         FROM user_permission_overrides upo
         INNER JOIN system_permissions sp ON upo.system_permission_id = sp.id
         INNER JOIN system_modules sm ON sp.module_id = sm.id
         WHERE upo.user_id = ? 
         AND sm.module_key = ? 
         AND sp.permission_key = ?
         AND upo.is_granted = 1
         AND (upo.expires_at IS NULL OR upo.expires_at > NOW())`,
        [userId, moduleKey, permissionKey]
      );

      if (override[0].has_override > 0) {
        return next();
      }

      // Permission denied
      return res.status(403).json({
        success: false,
        message: `Access denied. You don't have permission to ${permissionKey} in ${moduleKey} module.`,
        code: "PERMISSION_DENIED",
        required_permission: {
          module: moduleKey,
          permission: permissionKey,
        },
      });
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({
        success: false,
        message: "Error checking permissions",
        code: "PERMISSION_CHECK_ERROR",
      });
    }
  };
};

/**
 * Middleware to check multiple permissions (OR logic)
 */
const requireAnyPermission = (...permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
          code: "UNAUTHORIZED",
        });
      }

      // ✅ FIX 2: Owner bypass
      if (req.user.userType === "owner") {
        return next();
      }

      const userId = req.user.id;

      for (const [moduleKey, permissionKey] of permissions) {
        // Check role permission
        const [rolePermission] = await db.execute(
          `SELECT COUNT(*) as has_permission
           FROM users u
           INNER JOIN company_roles cr ON u.assigned_role_id = cr.id
           INNER JOIN role_permissions rp ON cr.id = rp.company_role_id
           INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
           INNER JOIN system_modules sm ON sp.module_id = sm.id
           WHERE u.id = ? AND sm.module_key = ? AND sp.permission_key = ?
           AND u.is_active = 1 AND cr.is_active = 1`,
          [userId, moduleKey, permissionKey]
        );

        if (rolePermission[0].has_permission > 0) {
          return next();
        }

        // Check override
        const [override] = await db.execute(
          `SELECT COUNT(*) as has_override
           FROM user_permission_overrides upo
           INNER JOIN system_permissions sp ON upo.system_permission_id = sp.id
           INNER JOIN system_modules sm ON sp.module_id = sm.id
           WHERE upo.user_id = ? AND sm.module_key = ? AND sp.permission_key = ?
           AND upo.is_granted = 1 AND (upo.expires_at IS NULL OR upo.expires_at > NOW())`,
          [userId, moduleKey, permissionKey]
        );

        if (override[0].has_override > 0) {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message:
          "Access denied. You don't have any of the required permissions.",
        code: "PERMISSION_DENIED",
      });
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({
        success: false,
        message: "Error checking permissions",
        code: "PERMISSION_CHECK_ERROR",
      });
    }
  };
};

/**
 * Middleware to check multiple permissions (AND logic)
 */
const requireAllPermissions = (...permissions) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
          code: "UNAUTHORIZED",
        });
      }

      // ✅ FIX 3: Owner bypass
      if (req.user.userType === "owner") {
        return next();
      }

      const userId = req.user.id;

      for (const [moduleKey, permissionKey] of permissions) {
        // Check role permission
        const [rolePermission] = await db.execute(
          `SELECT COUNT(*) as has_permission
           FROM users u
           INNER JOIN company_roles cr ON u.assigned_role_id = cr.id
           INNER JOIN role_permissions rp ON cr.id = rp.company_role_id
           INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
           INNER JOIN system_modules sm ON sp.module_id = sm.id
           WHERE u.id = ? AND sm.module_key = ? AND sp.permission_key = ?
           AND u.is_active = 1 AND cr.is_active = 1`,
          [userId, moduleKey, permissionKey]
        );

        let hasPermission = rolePermission[0].has_permission > 0;

        if (!hasPermission) {
          const [override] = await db.execute(
            `SELECT COUNT(*) as has_override
             FROM user_permission_overrides upo
             INNER JOIN system_permissions sp ON upo.system_permission_id = sp.id
             INNER JOIN system_modules sm ON sp.module_id = sm.id
             WHERE upo.user_id = ? AND sm.module_key = ? AND sp.permission_key = ?
             AND upo.is_granted = 1 AND (upo.expires_at IS NULL OR upo.expires_at > NOW())`,
            [userId, moduleKey, permissionKey]
          );

          hasPermission = override[0].has_override > 0;
        }

        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            message: `Access denied. Missing permission: ${permissionKey} in ${moduleKey}`,
            code: "PERMISSION_DENIED",
            missing_permission: {
              module: moduleKey,
              permission: permissionKey,
            },
          });
        }
      }

      return next();
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({
        success: false,
        message: "Error checking permissions",
        code: "PERMISSION_CHECK_ERROR",
      });
    }
  };
};

/**
 * Middleware to check if user is company owner
 */
const requireOwner = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "UNAUTHORIZED",
      });
    }

    // ✅ FIX 4: Direct owner check
    if (req.user.userType === "owner") {
      return next();
    }

    // Check if user is owner in database
    const [isOwner] = await db.execute(
      `SELECT COUNT(*) as is_owner 
       FROM companies c
       INNER JOIN users u ON c.owner_id = u.id
       WHERE u.id = ? AND c.id = ?`,
      [req.user.id, req.user.company_id]
    );

    if (isOwner[0].is_owner > 0) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Access denied. Owner privileges required.",
      code: "OWNER_REQUIRED",
    });
  } catch (error) {
    console.error("Owner check error:", error);
    return res.status(500).json({
      success: false,
      message: "Error checking owner status",
      code: "OWNER_CHECK_ERROR",
    });
  }
};

/**
 * Helper function to get user permissions
 */
const attachUserPermissions = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return next();
    }

    // ✅ FIX 5: Owner gets all permissions
    if (req.user.userType === "owner") {
      req.userPermissions = ["*.*"]; // Wildcard for all permissions
      return next();
    }

    const [permissions] = await db.execute(
      `SELECT DISTINCT sm.module_key, sp.permission_key
       FROM users u
       INNER JOIN company_roles cr ON u.assigned_role_id = cr.id
       INNER JOIN role_permissions rp ON cr.id = rp.company_role_id
       INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
       INNER JOIN system_modules sm ON sp.module_id = sm.id
       WHERE u.id = ? AND u.is_active = 1 AND cr.is_active = 1
       
       UNION
       
       SELECT DISTINCT sm.module_key, sp.permission_key
       FROM user_permission_overrides upo
       INNER JOIN system_permissions sp ON upo.system_permission_id = sp.id
       INNER JOIN system_modules sm ON sp.module_id = sm.id
       WHERE upo.user_id = ? AND upo.is_granted = 1
       AND (upo.expires_at IS NULL OR upo.expires_at > NOW())`,
      [req.user.id, req.user.id]
    );

    req.userPermissions = permissions.map(
      (p) => `${p.module_key}.${p.permission_key}`
    );

    next();
  } catch (error) {
    console.error("Error attaching permissions:", error);
    next();
  }
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireOwner,
  attachUserPermissions,
};
