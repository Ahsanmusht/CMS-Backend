const express = require("express");
const router = express.Router();
const ContactController = require("../controllers/contactController");
const { authenticateToken } = require("../middleware/auth");
const { requirePermission } = require("../middleware/rbac");

// Public route - no authentication required
router.post("/inquiries", ContactController.createInquiry);

// Protected routes - authentication required
router.get(
  "/inquiries",
  authenticateToken,
  requirePermission("contact", "view_inquiries"),
  ContactController.getAllInquiries
);
router.get(
  "/inquiries/statistics",
  authenticateToken,
  requirePermission("contact", "view_statistics"),
  ContactController.getInquiryStatistics
);
router.get(
  "/inquiries/:id",
  authenticateToken,
  requirePermission("contact", "view_inquiries"),
  ContactController.getInquiryById
);
router.patch(
  "/inquiries/:id/status",
  authenticateToken,
  requirePermission("contact", "manage_status"),
  ContactController.updateInquiryStatus
);
router.patch(
  "/inquiries/:id/assign",
  authenticateToken,
  requirePermission("contact", "assign_inquiries"),
  ContactController.assignInquiry
);
router.post(
  "/inquiries/:id/respond",
  authenticateToken,
  requirePermission("contact", "respond_inquiries"),
  ContactController.respondToInquiry
);

module.exports = router;
