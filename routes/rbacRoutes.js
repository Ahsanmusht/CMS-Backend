const express = require('express');
const router = express.Router();
const RBACController = require('../controllers/rbacController');
const { authenticateToken } = require('../middleware/auth');

// All RBAC routes require authentication
router.use(authenticateToken);

// ========== ROLE MANAGEMENT ==========
/**
 * @swagger
 * /rbac/roles:
 *   get:
 *     summary: Get all roles for company with optional permission details
 *     tags: [RBAC - Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: include_permissions
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of roles
 */
router.get('/roles', RBACController.getAllRoles);

/**
 * @swagger
 * /rbac/roles/{id}:
 *   get:
 *     summary: Get single role with complete details
 *     tags: [RBAC - Roles]
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
 *         description: Role details
 */
router.get('/roles/:id', RBACController.getRoleById);

/**
 * @swagger
 * /rbac/roles:
 *   post:
 *     summary: Create new role with permissions
 *     tags: [RBAC - Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: company_id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the company in which the role is being created
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the logged-in user creating the role
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role_key
 *               - role_name
 *             properties:
 *               role_key:
 *                 type: string
 *               role_name:
 *                 type: string
 *               is_system_role:
 *                 type: integer
 *               description:
 *                 type: string
 *               parent_role_id:
 *                 type: integer
 *               hierarchy_level:
 *                 type: integer
 *               permission_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       201:
 *         description: Role created successfully
 */
router.post('/roles', RBACController.createRole);

/**
 * @swagger
 * /rbac/roles/{id}:
 *   put:
 *     summary: Update role details
 *     tags: [RBAC - Roles]
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
 *         description: Role updated successfully
 */
router.put('/roles/:id', RBACController.updateRole);

/**
 * @swagger
 * /rbac/roles/{id}:
 *   delete:
 *     summary: Delete role (with safety checks)
 *     tags: [RBAC - Roles]
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
 *         description: Role deleted successfully
 */
router.delete('/roles/:id', RBACController.deleteRole);

/**
 * @swagger
 * /rbac/roles/{id}/clone:
 *   post:
 *     summary: Clone role with all permissions
 *     tags: [RBAC - Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: Role cloned successfully
 */
router.post('/roles/:id/clone', RBACController.cloneRole);

// ========== PERMISSION MANAGEMENT ==========
/**
 * @swagger
 * /rbac/permissions/available:
 *   get:
 *     summary: Get all available system permissions
 *     tags: [RBAC - Permissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: grouped
 *         schema:
 *           type: boolean
 *         description: Group permissions by module_group
 *     responses:
 *       200:
 *         description: Available permissions
 */
router.get('/permissions/available', RBACController.getAvailablePermissions);

/**
 * @swagger
 * /rbac/roles/{id}/permissions:
 *   post:
 *     summary: Assign permissions to role (bulk)
 *     tags: [RBAC - Permissions]
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
 *               - permission_ids
 *             properties:
 *               permission_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               can_grant:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Permissions assigned successfully
 */
router.post('/roles/:id/permissions', RBACController.assignPermissionsToRole);

/**
 * @swagger
 * /rbac/roles/{id}/permissions:
 *   delete:
 *     summary: Revoke permissions from role (bulk)
 *     tags: [RBAC - Permissions]
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
 *               - permission_ids
 *             properties:
 *               permission_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Permissions revoked successfully
 */
router.delete('/roles/:id/permissions', RBACController.revokePermissionsFromRole);

// ========== USER ROLE ASSIGNMENT ==========
/**
 * @swagger
 * /rbac/users/{id}/role:
 *   post:
 *     summary: Assign role to user
 *     tags: [RBAC - User Roles]
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
 *               - role_id
 *             properties:
 *               role_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Role assigned to user
 */
router.post('/users/:id/role', RBACController.assignRoleToUser);

/**
 * @swagger
 * /rbac/users/{id}/role:
 *   delete:
 *     summary: Revoke role from user
 *     tags: [RBAC - User Roles]
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
 *         description: Role revoked from user
 */
router.delete('/users/:id/role', RBACController.revokeRoleFromUser);

/**
 * @swagger
 * /rbac/users/{id}/permissions:
 *   get:
 *     summary: Get user's complete permission set
 *     tags: [RBAC - User Roles]
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
 *         description: User permissions
 */
router.get('/users/:id/permissions', RBACController.getUserPermissions);

/**
 * @swagger
 * /rbac/permissions/check:
 *   get:
 *     summary: Check if user has specific permission
 *     tags: [RBAC - Permissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: module_key
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: permission_key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Permission check result
 */
router.get('/permissions/check', RBACController.checkPermission);

// ========== PERMISSION OVERRIDES ==========
/**
 * @swagger
 * /rbac/users/{id}/permissions/override:
 *   post:
 *     summary: Grant temporary permission override to user
 *     tags: [RBAC - Permission Overrides]
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
 *               - permission_id
 *             properties:
 *               permission_id:
 *                 type: integer
 *               expires_at:
 *                 type: string
 *                 format: date-time
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Permission override granted
 */
router.post('/users/:id/permissions/override', RBACController.grantPermissionOverride);

/**
 * @swagger
 * /rbac/users/{id}/permissions/override:
 *   delete:
 *     summary: Revoke permission override from user
 *     tags: [RBAC - Permission Overrides]
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
 *               - permission_id
 *             properties:
 *               permission_id:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Permission override revoked
 */
router.delete('/users/:id/permissions/override', RBACController.revokePermissionOverride);

// ========== AUDIT & REPORTING ==========
/**
 * @swagger
 * /rbac/audit:
 *   get:
 *     summary: Get permission audit logs
 *     tags: [RBAC - Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: action_type
 *         schema:
 *           type: string
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: role_id
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Audit logs
 */
router.get('/audit', RBACController.getAuditLogs);

/**
 * @swagger
 * /rbac/roles/hierarchy:
 *   get:
 *     summary: Get role hierarchy tree
 *     tags: [RBAC - Roles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Role hierarchy
 */
router.get('/roles/hierarchy', RBACController.getRoleHierarchy);

/**
 * @swagger
 * /rbac/roles/compare:
 *   get:
 *     summary: Compare permissions between multiple roles
 *     tags: [RBAC - Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role_ids
 *         required: true
 *         schema:
 *           type: string
 *         description: Comma-separated role IDs
 *     responses:
 *       200:
 *         description: Role comparison
 */
router.get('/roles/compare', RBACController.compareRoles);

module.exports = router;