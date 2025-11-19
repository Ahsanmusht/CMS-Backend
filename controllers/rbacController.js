const db = require("../config/database");
const {
  ResponseHandler,
  ErrorHandler,
  handleError,
  Helpers,
} = require("../utils/responseHandler");

class RBACController {
  // ========== ROLE MANAGEMENT ==========

  static isOwner(req) {
    return req.user && req.user.userType === "owner";
  }

  /**
   * Get all roles for a company with full permission details
   */
  static async getAllRoles(req, res) {
    try {
      const { page, limit, search, include_permissions } = req.query;
      const {
        page: pageNum,
        limit: limitNum,
        offset,
      } = Helpers.validatePagination(page, limit);

      let whereConditions = ["cr.company_id = ?"];
      let queryParams = [req.query.company_id];

      if (search && search.trim()) {
        whereConditions.push("(cr.role_name LIKE ? OR cr.role_key LIKE ?)");
        const searchTerm = `%${search.trim()}%`;
        queryParams.push(searchTerm, searchTerm);
      }

      const whereClause = whereConditions.join(" AND ");

      // Count total roles
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM company_roles cr WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch roles
      const [roles] = await db.execute(
        `SELECT cr.*, 
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
         (SELECT COUNT(*) FROM users WHERE assigned_role_id = cr.id) as user_count,
         (SELECT COUNT(*) FROM role_permissions WHERE company_role_id = cr.id) as permission_count
         FROM company_roles cr
         LEFT JOIN users u ON cr.created_by = u.id
         WHERE ${whereClause}
         ORDER BY cr.hierarchy_level DESC, cr.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      // Optionally include permissions for each role
      if (include_permissions === "true") {
        for (let role of roles) {
          const [permissions] = await db.execute(
            `SELECT rp.*, sm.module_key, sm.module_name, sm.module_group,
             sp.permission_key, sp.permission_name, sp.description
             FROM role_permissions rp
             INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
             INNER JOIN system_modules sm ON sp.module_id = sm.id
             WHERE rp.company_role_id = ?
             ORDER BY sm.module_group, sm.module_key, sp.permission_key`,
            [role.id]
          );
          role.permissions = permissions;
        }
      }

      return ResponseHandler.successWithPagination(
        res,
        roles,
        { page: pageNum, limit: limitNum, total },
        "Roles retrieved successfully"
      );
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Get single role with complete details
   */
  static async getRoleById(req, res) {
    try {
      const roleId = Helpers.validateId(req.params.id, "Role ID");

      const [role] = await db.execute(
        `SELECT cr.*, 
         CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
         pr.role_name as parent_role_name,
         (SELECT COUNT(*) FROM users WHERE assigned_role_id = cr.id) as user_count
         FROM company_roles cr
         LEFT JOIN users u ON cr.created_by = u.id
         LEFT JOIN company_roles pr ON cr.parent_role_id = pr.id
         WHERE cr.id = ? AND cr.company_id = ?`,
        [roleId, req.query.company_id]
      );

      if (role.length === 0) {
        throw new ErrorHandler("Role not found", 404);
      }

      // Get permissions
      const [permissions] = await db.execute(
        `SELECT rp.*, sm.module_key, sm.module_name, sm.module_group,
         sp.permission_key, sp.permission_name, sp.description,
         CONCAT(u.first_name, ' ', u.last_name) as granted_by_name
         FROM role_permissions rp
         INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
         INNER JOIN system_modules sm ON sp.module_id = sm.id
         LEFT JOIN users u ON rp.granted_by = u.id
         WHERE rp.company_role_id = ?
         ORDER BY sm.module_group, sm.module_key, sp.permission_key`,
        [roleId]
      );

      // Get users with this role
      const [users] = await db.execute(
        `SELECT id, email, first_name, last_name, is_active, role_assigned_at
         FROM users 
         WHERE assigned_role_id = ? AND company_id = ?
         ORDER BY role_assigned_at DESC`,
        [roleId, req.query.company_id]
      );

      return ResponseHandler.success(
        res,
        {
          ...role[0],
          permissions,
          users,
        },
        "Role details retrieved successfully"
      );
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Create new role with permissions (cPanel-style)
   */
  static async createRole(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const {
        role_key,
        role_name,
        description,
        parent_role_id,
        hierarchy_level,
        permission_ids,
        is_system_role,
      } = req.body;

      // Validate required fields
      if (!role_key || !role_name) {
        throw new ErrorHandler("Role key and name are required", 400);
      }

      // Check for duplicate role key
      const [existingRole] = await connection.execute(
        "SELECT id FROM company_roles WHERE role_key = ? AND company_id = ?",
        [role_key.trim(), req.query.company_id]
      );

      if (existingRole.length > 0) {
        throw new ErrorHandler("Role key already exists", 409);
      }

      // Verify user has permission to create roles
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "roles",
          "manage_roles"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to create roles",
            403
          );
        }
      }

      // Create role
      const roleData = {
        company_id: req.query.company_id,
        role_key: role_key.trim().toLowerCase(),
        role_name: role_name.trim(),
        description: description?.trim() || null,
        parent_role_id: parent_role_id || null,
        hierarchy_level: hierarchy_level || 0,
        is_system_role: is_system_role || 0,
        created_by: req.query.id,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { query, values } = Helpers.buildInsertQuery(
        "company_roles",
        roleData
      );
      const [result] = await connection.execute(query, values);
      const newRoleId = result.insertId;

      // Assign permissions if provided
      if (
        permission_ids &&
        Array.isArray(permission_ids) &&
        permission_ids.length > 0
      ) {
        for (const permissionId of permission_ids) {
          // Verify user can grant this permission
          const canGrant =
            RBACController.isOwner(req) ||
            (await RBACController.checkUserCanGrantPermission(
              connection,
              req.query.id,
              permissionId,
              req.query.company_id
            ));

          if (canGrant) {
            await connection.execute(
              `INSERT INTO role_permissions (company_role_id, system_permission_id, can_grant, granted_by, granted_at)
               VALUES (?, ?, 0, ?, NOW())`,
              [newRoleId, permissionId, req.query.id]
            );
          }
        }
      }

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_role_id, performed_by, new_value, created_at)
         VALUES (?, 'ROLE_CREATED', ?, ?, ?, NOW())`,
        [
          req.query.company_id,
          newRoleId,
          req.query.id,
          JSON.stringify({
            role_name,
            role_key,
            permission_count: permission_ids?.length || 0,
          }),
        ]
      );

      await connection.commit();

      // Fetch created role
      const [newRole] = await connection.execute(
        `SELECT cr.*, 
         (SELECT COUNT(*) FROM role_permissions WHERE company_role_id = cr.id) as permission_count
         FROM company_roles cr WHERE cr.id = ?`,
        [newRoleId]
      );

      return ResponseHandler.created(
        res,
        newRole[0],
        "Role created successfully"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  /**
   * Update role (name, description, hierarchy)
   */
  static async updateRole(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const roleId = Helpers.validateId(req.params.id, "Role ID");

      // Check if role exists
      const [existingRole] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
        [roleId, req.query.company_id]
      );

      if (existingRole.length === 0) {
        throw new ErrorHandler("Role not found", 404);
      }

      // Prevent updating system roles
      if (existingRole[0].is_system_role === 1) {
        throw new ErrorHandler("Cannot modify system roles", 403);
      }

      // Verify permission
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "roles",
          "manage_roles"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to update roles",
            403
          );
        }
      }

      const updateData = {
        ...Helpers.sanitizeInput(req.body),
        updated_at: new Date(),
      };

      // Remove fields that shouldn't be updated
      delete updateData.id;
      delete updateData.company_id;
      delete updateData.role_key; // Role key shouldn't change
      delete updateData.created_by;
      delete updateData.created_at;
      delete updateData.is_system_role;

      if (Object.keys(updateData).length <= 1) {
        throw new ErrorHandler("No valid fields to update", 400);
      }

      const { query, values } = Helpers.buildUpdateQuery(
        "company_roles",
        updateData,
        "id = ? AND company_id = ?"
      );

      await connection.execute(query, [
        ...values,
        roleId,
        req.query.company_id,
      ]);

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_role_id, performed_by, old_value, new_value, created_at)
         VALUES (?, 'ROLE_UPDATED', ?, ?, ?, ?, NOW())`,
        [
          req.query.company_id,
          roleId,
          req.query.id,
          JSON.stringify(existingRole[0]),
          JSON.stringify(updateData),
        ]
      );

      await connection.commit();

      // Fetch updated role
      const [updatedRole] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ?",
        [roleId]
      );

      return ResponseHandler.success(
        res,
        updatedRole[0],
        "Role updated successfully"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  /**
   * Delete role (with safety checks)
   */
  static async deleteRole(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const roleId = Helpers.validateId(req.params.id, "Role ID");

      // Check if role exists
      const [role] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
        [roleId, req.query.company_id]
      );

      if (role.length === 0) {
        throw new ErrorHandler("Role not found", 404);
      }

      // Prevent deleting system roles
      if (role[0].is_system_role === 1) {
        throw new ErrorHandler("Cannot delete system roles", 403);
      }

      // Check if any users have this role
      const [usersWithRole] = await connection.execute(
        "SELECT COUNT(*) as count FROM users WHERE assigned_role_id = ?",
        [roleId]
      );

      if (usersWithRole[0].count > 0) {
        throw new ErrorHandler(
          `Cannot delete role. ${usersWithRole[0].count} user(s) are assigned to this role. Please reassign them first.`,
          400
        );
      }

      // Verify permission
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "roles",
          "manage_roles"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to delete roles",
            403
          );
        }
      }

      // Delete role permissions first
      await connection.execute(
        "DELETE FROM role_permissions WHERE company_role_id = ?",
        [roleId]
      );

      // Delete role
      await connection.execute(
        "DELETE FROM company_roles WHERE id = ? AND company_id = ?",
        [roleId, req.query.company_id]
      );

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_role_id, performed_by, old_value, created_at)
         VALUES (?, 'ROLE_DELETED', ?, ?, ?, NOW())`,
        [req.query.company_id, roleId, req.query.id, JSON.stringify(role[0])]
      );

      await connection.commit();

      return ResponseHandler.success(res, null, "Role deleted successfully");
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // ========== PERMISSION MANAGEMENT ==========

  /**
   * Get all available system modules and permissions (for UI)
   */
  static async getAvailablePermissions(req, res) {
    try {
      const { grouped } = req.query;

      if (grouped === "true") {
        // Get modules grouped by module_group
        const [modules] = await db.execute(
          `SELECT sm.*, 
           (SELECT COUNT(*) FROM system_permissions WHERE module_id = sm.id AND is_active = 1) as permission_count
           FROM system_modules sm
           WHERE sm.is_active = 1
           ORDER BY sm.module_group, sm.sort_order, sm.module_name`
        );

        // Get permissions for each module
        const moduleMap = {};
        for (const module of modules) {
          if (!moduleMap[module.module_group]) {
            moduleMap[module.module_group] = [];
          }

          const [permissions] = await db.execute(
            `SELECT * FROM system_permissions 
             WHERE module_id = ? AND is_active = 1
             ORDER BY permission_key`,
            [module.id]
          );

          moduleMap[module.module_group].push({
            ...module,
            permissions,
          });
        }

        return ResponseHandler.success(
          res,
          moduleMap,
          "Grouped permissions retrieved successfully"
        );
      } else {
        // Flat list of all modules and permissions
        const [modules] = await db.execute(
          `SELECT sm.*, sp.id as permission_id, sp.permission_key, sp.permission_name, sp.description
           FROM system_modules sm
           INNER JOIN system_permissions sp ON sm.id = sp.module_id
           WHERE sm.is_active = 1 AND sp.is_active = 1
           ORDER BY sm.module_group, sm.sort_order, sm.module_name, sp.permission_key`
        );

        return ResponseHandler.success(
          res,
          modules,
          "Permissions retrieved successfully"
        );
      }
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Assign permissions to role (bulk operation)
   */
  static async assignPermissionsToRole(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const roleId = Helpers.validateId(req.params.id, "Role ID");
      const { permission_ids, can_grant } = req.body;

      if (
        !permission_ids ||
        !Array.isArray(permission_ids) ||
        permission_ids.length === 0
      ) {
        throw new ErrorHandler("Permission IDs are required", 400);
      }

      // Verify role exists
      const [role] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
        [roleId, req.query.company_id]
      );

      if (role.length === 0) {
        throw new ErrorHandler("Role not found", 404);
      }

      // Verify user has permission to assign permissions
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "roles",
          "assign_permissions"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to assign permissions",
            403
          );
        }
      }
      let assignedCount = 0;
      let skippedCount = 0;

      for (const permissionId of permission_ids) {
        // Check if user can grant this permission
        const canGrantPermission =
          RBACController.isOwner(req) ||
          (await RBACController.checkUserCanGrantPermission(
            connection,
            req.query.id,
            permissionId,
            req.query.company_id
          ));

        if (!canGrantPermission) {
          skippedCount++;
          continue;
        }

        // Check if permission already exists
        const [existing] = await connection.execute(
          "SELECT id FROM role_permissions WHERE company_role_id = ? AND system_permission_id = ?",
          [roleId, permissionId]
        );

        if (existing.length === 0) {
          await connection.execute(
            `INSERT INTO role_permissions (company_role_id, system_permission_id, can_grant, granted_by, granted_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [roleId, permissionId, can_grant || 0, req.query.id]
          );
          assignedCount++;
        }
      }

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_role_id, performed_by, new_value, created_at)
         VALUES (?, 'PERMISSION_GRANTED', ?, ?, ?, NOW())`,
        [
          req.query.company_id,
          roleId,
          req.query.id,
          JSON.stringify({
            assigned: assignedCount,
            skipped: skippedCount,
            total: permission_ids.length,
          }),
        ]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        {
          assigned: assignedCount,
          skipped: skippedCount,
          total: permission_ids.length,
        },
        `Permissions assigned successfully. ${assignedCount} assigned, ${skippedCount} skipped.`
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  /**
   * Revoke permissions from role (bulk operation)
   */
  static async revokePermissionsFromRole(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const roleId = Helpers.validateId(req.params.id, "Role ID");
      const { permission_ids } = req.body;

      if (
        !permission_ids ||
        !Array.isArray(permission_ids) ||
        permission_ids.length === 0
      ) {
        throw new ErrorHandler("Permission IDs are required", 400);
      }

      // Verify role exists
      const [role] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
        [roleId, req.query.company_id]
      );

      if (role.length === 0) {
        throw new ErrorHandler("Role not found", 404);
      }

      // Verify user has permission
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "roles",
          "assign_permissions"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to revoke permissions",
            403
          );
        }
      }

      // Delete permissions
      const placeholders = permission_ids.map(() => "?").join(",");
      const [result] = await connection.execute(
        `DELETE FROM role_permissions 
         WHERE company_role_id = ? AND system_permission_id IN (${placeholders})`,
        [roleId, ...permission_ids]
      );

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_role_id, performed_by, old_value, created_at)
         VALUES (?, 'PERMISSION_REVOKED', ?, ?, ?, NOW())`,
        [
          req.query.company_id,
          roleId,
          req.query.id,
          JSON.stringify({
            revoked_count: result.affectedRows,
            permission_ids,
          }),
        ]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        { revoked: result.affectedRows },
        `${result.affectedRows} permission(s) revoked successfully`
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // ========== USER ROLE ASSIGNMENT ==========

  /**
   * Assign role to user
   */
  static async assignRoleToUser(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const userId = Helpers.validateId(req.params.id, "User ID");
      const { role_id } = req.body;

      if (!role_id) {
        throw new ErrorHandler("Role ID is required", 400);
      }

      // Verify user exists
      const [user] = await connection.execute(
        "SELECT * FROM users WHERE id = ? AND company_id = ?",
        [userId, req.query.company_id]
      );

      if (user.length === 0) {
        throw new ErrorHandler("User not found", 404);
      }

      // Verify role exists
      const [role] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
        [role_id, req.query.company_id]
      );

      if (role.length === 0) {
        throw new ErrorHandler("Role not found", 404);
      }

      // Verify permission to assign roles
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "users",
          "assign_roles"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to assign roles",
            403
          );
        }
      }

      // Update user role
      await connection.execute(
        `UPDATE users 
         SET assigned_role_id = ?, role_assigned_at = NOW(), role_assigned_by = ?, updated_at = NOW()
         WHERE id = ? AND company_id = ?`,
        [role_id, req.query.id, userId, req.query.company_id]
      );

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_user_id, target_role_id, performed_by, created_at)
         VALUES (?, 'USER_ROLE_ASSIGNED', ?, ?, ?, NOW())`,
        [req.query.company_id, userId, role_id, req.query.id]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        { user_id: userId, role_id, role_name: role[0].role_name },
        "Role assigned to user successfully"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  /**
   * Revoke role from user
   */
  static async revokeRoleFromUser(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const userId = Helpers.validateId(req.params.id, "User ID");

      // Verify user exists
      const [user] = await connection.execute(
        "SELECT * FROM users WHERE id = ? AND company_id = ?",
        [userId, req.query.company_id]
      );

      if (user.length === 0) {
        throw new ErrorHandler("User not found", 404);
      }

      // Verify permission
      if (!RBACController.isOwner(req)) {
        const hasPermission = await RBACController.checkUserPermission(
          connection,
          req.query.id,
          "users",
          "assign_roles"
        );

        if (!hasPermission) {
          throw new ErrorHandler(
            "You do not have permission to revoke roles",
            403
          );
        }
      }

      // Revoke role
      await connection.execute(
        `UPDATE users 
         SET assigned_role_id = NULL, role_assigned_at = NULL, role_assigned_by = NULL, updated_at = NOW()
         WHERE id = ? AND company_id = ?`,
        [userId, req.query.company_id]
      );

      // Audit log
      await connection.execute(
        `INSERT INTO permission_audit_log (company_id, action_type, target_user_id, performed_by, old_value, created_at)
         VALUES (?, 'USER_ROLE_REVOKED', ?, ?, ?, NOW())`,
        [
          req.query.company_id,
          userId,
          req.query.id,
          JSON.stringify({ old_role_id: user[0].assigned_role_id }),
        ]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        null,
        "Role revoked from user successfully"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // ========== PERMISSION CHECKING (HELPER METHODS) ==========

  /**
   * Check if user has specific permission
   */
  static async checkUserPermission(
    connection,
    userId,
    moduleKey,
    permissionKey
  ) {
    if (userType === "owner") {
      return true;
    }
    const [result] = await connection.execute(
      `SELECT COUNT(*) as has_permission
       FROM users u
       INNER JOIN company_roles cr ON u.assigned_role_id = cr.id
       INNER JOIN role_permissions rp ON cr.id = rp.company_role_id
       INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
       INNER JOIN system_modules sm ON sp.module_id = sm.id
       WHERE u.id = ? AND sm.module_key = ? AND sp.permission_key = ?
       AND u.is_active = 1 AND cr.is_active = 1 AND sm.is_active = 1 AND sp.is_active = 1`,
      [userId, moduleKey, permissionKey]
    );

    return result[0].has_permission > 0;
  }

  /**
   * Check if user can grant a specific permission
   */
  static async checkUserCanGrantPermission(
    connection,
    userId,
    permissionId,
    companyId
  ) {
    if (userType === "owner") {
      return true;
    }
    // Check if user is owner
    const [isOwner] = await connection.execute(
      `SELECT COUNT(*) as is_owner 
       FROM companies c
       INNER JOIN users u ON c.owner_id = u.id
       WHERE u.id = ? AND c.id = ?`,
      [userId, companyId]
    );

    if (isOwner[0].is_owner > 0) {
      return true;
    }

    // Check if user has the permission with can_grant = 1
    const [canGrant] = await connection.execute(
      `SELECT COUNT(*) as can_grant
       FROM users u
       INNER JOIN company_roles cr ON u.assigned_role_id = cr.id
       INNER JOIN role_permissions rp ON cr.id = rp.company_role_id
       WHERE u.id = ? AND rp.system_permission_id = ? AND rp.can_grant = 1
       AND u.is_active = 1 AND cr.is_active = 1`,
      [userId, permissionId]
    );

    return canGrant[0].can_grant > 0;
  }

  /**
   * Get user's complete permission set
   */
  static async getUserPermissions(req, res) {
    try {
      const userId = req.params.id
        ? Helpers.validateId(req.params.id, "User ID")
        : req.query.id;

      const [user] = await db.execute(
        `SELECT u.*, cr.role_name, cr.role_key
         FROM users u
         LEFT JOIN company_roles cr ON u.assigned_role_id = cr.id
         WHERE u.id = ? AND u.company_id = ?`,
        [userId, req.query.company_id]
      );

      if (user.length === 0) {
        throw new ErrorHandler("User not found", 404);
      }

      // Get role-based permissions
      const [permissions] = await db.execute(
        `SELECT DISTINCT
         sm.module_key, sm.module_name, sm.module_group, sm.icon,
         sp.permission_key, sp.permission_name, sp.description,
         rp.can_grant,
         'ROLE' as source
         FROM role_permissions rp
         INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
         INNER JOIN system_modules sm ON sp.module_id = sm.id
         WHERE rp.company_role_id = ? AND sm.is_active = 1 AND sp.is_active = 1
         ORDER BY sm.module_group, sm.sort_order, sp.permission_key`,
        [user[0].assigned_role_id || 0]
      );

      // Get user-specific overrides
      const [overrides] = await db.execute(
        `SELECT DISTINCT
         sm.module_key, sm.module_name, sm.module_group, sm.icon,
         sp.permission_key, sp.permission_name, sp.description,
         upo.is_granted,
         'OVERRIDE' as source
         FROM user_permission_overrides upo
         INNER JOIN system_permissions sp ON upo.system_permission_id = sp.id
         INNER JOIN system_modules sm ON sp.module_id = sm.id
         WHERE upo.user_id = ? AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
         AND sm.is_active = 1 AND sp.is_active = 1
         ORDER BY sm.module_group, sm.sort_order, sp.permission_key`,
        [userId]
      );

      // Group permissions by module
      const groupedPermissions = {};

      [...permissions, ...overrides].forEach((perm) => {
        if (!groupedPermissions[perm.module_group]) {
          groupedPermissions[perm.module_group] = {};
        }

        if (!groupedPermissions[perm.module_group][perm.module_key]) {
          groupedPermissions[perm.module_group][perm.module_key] = {
            module_name: perm.module_name,
            module_icon: perm.icon,
            permissions: [],
          };
        }

        groupedPermissions[perm.module_group][perm.module_key].permissions.push(
          {
            permission_key: perm.permission_key,
            permission_name: perm.permission_name,
            description: perm.description,
            can_grant: perm.can_grant || 0,
            source: perm.source,
          }
        );
      });

      return ResponseHandler.success(
        res,
        {
          user: {
            id: user[0].id,
            email: user[0].email,
            name: `${user[0].first_name} ${user[0].last_name}`,
            role: user[0].role_name,
            role_key: user[0].role_key,
          },
          permissions: groupedPermissions,
          total_permissions: permissions.length + overrides.length,
        },
        "User permissions retrieved successfully"
      );
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Check specific permission for user (endpoint for frontend)
   */
  static async checkPermission(req, res) {
    const connection = await db.getConnection();

    try {
      const { module_key, permission_key } = req.query;

      if (!module_key || !permission_key) {
        throw new ErrorHandler(
          "Module key and permission key are required",
          400
        );
      }

      const hasPermission = await RBACController.checkUserPermission(
        connection,
        req.query.id,
        module_key,
        permission_key
      );

      return ResponseHandler.success(
        res,
        {
          has_permission: hasPermission,
          module_key,
          permission_key,
        },
        hasPermission ? "Permission granted" : "Permission denied"
      );
    } catch (error) {
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // ========== PERMISSION OVERRIDES ==========

  /**
   * Grant temporary permission to user (override)
   */
  static async grantPermissionOverride(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const userId = Helpers.validateId(req.params.id, "User ID");
      const { permission_id, expires_at, reason } = req.body;

      if (!permission_id) {
        throw new ErrorHandler("Permission ID is required", 400);
      }

      // Verify user exists
      const [user] = await connection.execute(
        "SELECT * FROM users WHERE id = ? AND company_id = ?",
        [userId, req.query.company_id]
      );

      if (user.length === 0) {
        throw new ErrorHandler("User not found", 404);
      }

      // Verify permission exists
      const [permission] = await connection.execute(
        "SELECT * FROM system_permissions WHERE id = ?",
        [permission_id]
      );

      if (permission.length === 0) {
        throw new ErrorHandler("Permission not found", 404);
      }

      // Verify user can grant this override
      if (!RBACController.isOwner(req)) {
        const canGrant = await RBACController.checkUserCanGrantPermission(
          connection,
          req.query.id,
          permission_id,
          req.query.company_id
        );

        if (!canGrant) {
          throw new ErrorHandler(
            "You do not have permission to grant this override",
            403
          );
        }
      }

      // Check if override already exists
      const [existing] = await connection.execute(
        "SELECT id FROM user_permission_overrides WHERE user_id = ? AND system_permission_id = ?",
        [userId, permission_id]
      );

      if (existing.length > 0) {
        // Update existing override
        await connection.execute(
          `UPDATE user_permission_overrides 
           SET is_granted = 1, expires_at = ?, override_reason = ?, overridden_by = ?
           WHERE id = ?`,
          [
            expires_at || null,
            reason?.trim() || null,
            req.query.id,
            existing[0].id,
          ]
        );
      } else {
        // Create new override
        await connection.execute(
          `INSERT INTO user_permission_overrides 
           (user_id, system_permission_id, is_granted, override_reason, overridden_by, expires_at, created_at)
           VALUES (?, ?, 1, ?, ?, ?, NOW())`,
          [
            userId,
            permission_id,
            reason?.trim() || null,
            req.query.id,
            expires_at || null,
          ]
        );
      }

      await connection.commit();

      return ResponseHandler.success(
        res,
        { user_id: userId, permission_id, expires_at },
        "Permission override granted successfully"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  /**
   * Revoke permission override from user
   */
  static async revokePermissionOverride(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const userId = Helpers.validateId(req.params.id, "User ID");
      const { permission_id } = req.body;

      if (!permission_id) {
        throw new ErrorHandler("Permission ID is required", 400);
      }

      // Delete override
      const [result] = await connection.execute(
        "DELETE FROM user_permission_overrides WHERE user_id = ? AND system_permission_id = ?",
        [userId, permission_id]
      );

      await connection.commit();

      return ResponseHandler.success(
        res,
        { revoked: result.affectedRows },
        result.affectedRows > 0
          ? "Permission override revoked successfully"
          : "No override found"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // ========== AUDIT & REPORTING ==========

  /**
   * Get permission audit logs
   */
  static async getAuditLogs(req, res) {
    try {
      const {
        page,
        limit,
        action_type,
        user_id,
        role_id,
        start_date,
        end_date,
      } = req.query;
      const {
        page: pageNum,
        limit: limitNum,
        offset,
      } = Helpers.validatePagination(page, limit);

      let whereConditions = ["company_id = ?"];
      let queryParams = [req.query.company_id];

      if (action_type) {
        whereConditions.push("action_type = ?");
        queryParams.push(action_type);
      }

      if (user_id) {
        whereConditions.push("target_user_id = ?");
        queryParams.push(user_id);
      }

      if (role_id) {
        whereConditions.push("target_role_id = ?");
        queryParams.push(role_id);
      }

      if (start_date) {
        whereConditions.push("DATE(created_at) >= ?");
        queryParams.push(Helpers.formatDate(start_date));
      }

      if (end_date) {
        whereConditions.push("DATE(created_at) <= ?");
        queryParams.push(Helpers.formatDate(end_date));
      }

      const whereClause = whereConditions.join(" AND ");

      // Count total
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM permission_audit_log WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch logs
      const [logs] = await db.execute(
        `SELECT pal.*,
         CONCAT(u.first_name, ' ', u.last_name) as performed_by_name,
         cr.role_name as target_role_name,
         CONCAT(tu.first_name, ' ', tu.last_name) as target_user_name
         FROM permission_audit_log pal
         LEFT JOIN users u ON pal.performed_by = u.id
         LEFT JOIN company_roles cr ON pal.target_role_id = cr.id
         LEFT JOIN users tu ON pal.target_user_id = tu.id
         WHERE ${whereClause}
         ORDER BY pal.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        logs,
        { page: pageNum, limit: limitNum, total },
        "Audit logs retrieved successfully"
      );
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Get role hierarchy (for visualization)
   */
  static async getRoleHierarchy(req, res) {
    try {
      const companyId = Helpers.validateId(req.params.company_id, "Company ID");
      console.log(companyId);
      console.log(typeof companyId);
      const [roles] = await db.execute(
        `SELECT cr.*,
         pr.role_name as parent_role_name,
         (SELECT COUNT(*) FROM users WHERE assigned_role_id = cr.id) as user_count,
         (SELECT COUNT(*) FROM role_permissions WHERE company_role_id = cr.id) as permission_count
         FROM company_roles cr
         LEFT JOIN company_roles pr ON cr.parent_role_id = pr.id
         WHERE cr.company_id = ? AND cr.is_active = 1
         ORDER BY cr.hierarchy_level DESC, cr.created_at DESC`,
        [companyId]
      );

      // Build hierarchy tree
      const buildTree = (parentId = null) => {
        return roles
          .filter((role) => role.parent_role_id === parentId)
          .map((role) => ({
            ...role,
            children: buildTree(role.id),
          }));
      };

      const hierarchy = buildTree();

      return ResponseHandler.success(
        res,
        hierarchy,
        "Role hierarchy retrieved successfully"
      );
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Get role comparison (compare permissions between roles)
   */
  static async compareRoles(req, res) {
    try {
      const { role_ids } = req.query;

      if (!role_ids) {
        throw new ErrorHandler("Role IDs are required (comma-separated)", 400);
      }

      const roleIdArray = role_ids.split(",").map((id) => parseInt(id.trim()));

      if (roleIdArray.length < 2) {
        throw new ErrorHandler(
          "At least 2 roles are required for comparison",
          400
        );
      }

      const comparison = {};

      for (const roleId of roleIdArray) {
        const [role] = await db.execute(
          "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
          [roleId, req.query.company_id]
        );

        if (role.length === 0) {
          continue;
        }

        const [permissions] = await db.execute(
          `SELECT sp.id, sm.module_key, sm.module_name, sp.permission_key, sp.permission_name, rp.can_grant
           FROM role_permissions rp
           INNER JOIN system_permissions sp ON rp.system_permission_id = sp.id
           INNER JOIN system_modules sm ON sp.module_id = sm.id
           WHERE rp.company_role_id = ?
           ORDER BY sm.module_key, sp.permission_key`,
          [roleId]
        );

        comparison[roleId] = {
          role_name: role[0].role_name,
          role_key: role[0].role_key,
          permissions: permissions,
        };
      }

      return ResponseHandler.success(
        res,
        comparison,
        "Role comparison completed"
      );
    } catch (error) {
      return handleError(error, res);
    }
  }

  /**
   * Clone role (copy permissions from one role to another)
   */
  static async cloneRole(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const sourceRoleId = Helpers.validateId(req.params.id, "Source Role ID");
      const { new_role_key, new_role_name, include_can_grant } = req.body;

      if (!new_role_key || !new_role_name) {
        throw new ErrorHandler("New role key and name are required", 400);
      }

      // Verify source role exists
      const [sourceRole] = await connection.execute(
        "SELECT * FROM company_roles WHERE id = ? AND company_id = ?",
        [sourceRoleId, req.query.company_id]
      );

      if (sourceRole.length === 0) {
        throw new ErrorHandler("Source role not found", 404);
      }

      // Check for duplicate role key
      const [existing] = await connection.execute(
        "SELECT id FROM company_roles WHERE role_key = ? AND company_id = ?",
        [new_role_key.trim(), req.query.company_id]
      );

      if (existing.length > 0) {
        throw new ErrorHandler("Role key already exists", 409);
      }

      // Create new role
      const newRoleData = {
        company_id: req.query.company_id,
        role_key: new_role_key.trim().toLowerCase(),
        role_name: new_role_name.trim(),
        description: `Cloned from ${sourceRole[0].role_name}`,
        hierarchy_level: sourceRole[0].hierarchy_level,
        created_by: req.query.id,
        is_active: 1,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const { query, values } = Helpers.buildInsertQuery(
        "company_roles",
        newRoleData
      );
      const [result] = await connection.execute(query, values);
      const newRoleId = result.insertId;

      // Copy permissions
      await connection.execute(
        `INSERT INTO role_permissions (company_role_id, system_permission_id, can_grant, granted_by, granted_at)
         SELECT ?, system_permission_id, ${
           include_can_grant ? "can_grant" : "0"
         }, ?, NOW()
         FROM role_permissions
         WHERE company_role_id = ?`,
        [newRoleId, req.query.id, sourceRoleId]
      );

      await connection.commit();

      return ResponseHandler.created(
        res,
        { id: newRoleId, role_name: new_role_name, role_key: new_role_key },
        "Role cloned successfully"
      );
    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }
}

module.exports = RBACController;
