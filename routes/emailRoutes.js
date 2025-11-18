const express = require('express');
const router = express.Router();
const EmailController = require('../controllers/emailController');
const { authenticateToken } = require('../middleware/auth');

router.post('/verify', EmailController.verifyEmail);
router.post('/send', authenticateToken, EmailController.sendEmail);
router.get('/', authenticateToken, EmailController.getEmailLogs);
router.get('/:id', authenticateToken, EmailController.getEmailById);
router.post('/:id/resend', authenticateToken, EmailController.resendEmail);

module.exports = router;