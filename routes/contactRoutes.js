const express = require('express');
const router = express.Router();
const ContactController = require('../controllers/contactController');
const { authenticateToken } = require('../middleware/auth');

// Public route - no authentication required
router.post('/inquiries', ContactController.createInquiry);

// Protected routes - authentication required
router.get('/inquiries', authenticateToken, ContactController.getAllInquiries);
router.get('/inquiries/statistics', authenticateToken, ContactController.getInquiryStatistics);
router.get('/inquiries/:id', authenticateToken, ContactController.getInquiryById);
router.patch('/inquiries/:id/status', authenticateToken, ContactController.updateInquiryStatus);
router.patch('/inquiries/:id/assign', authenticateToken, ContactController.assignInquiry);
router.post('/inquiries/:id/respond', authenticateToken, ContactController.respondToInquiry);

module.exports = router;