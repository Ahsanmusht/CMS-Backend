const express = require("express");
const router = express.Router();
const EmailController = require("../controllers/emailController");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

router.post(
  "/verify",
  requirePermission("emails", "verify_email"),
  EmailController.verifyEmail
);
router.post(
  "/send",
  authenticateToken,
  requirePermission("emails", "send_email"),
  EmailController.sendEmail
);
router.get(
  "/",
  authenticateToken,
  requirePermission("emails", "view_emails"),
  EmailController.getEmailLogs
);
router.get(
  "/:id",
  authenticateToken,
  requirePermission("emails", "view_emails"),
  EmailController.getEmailById
);
router.post(
  "/:id/resend",
  authenticateToken,
  requirePermission("emails", "resend_email"),
  EmailController.resendEmail
);

module.exports = router;
