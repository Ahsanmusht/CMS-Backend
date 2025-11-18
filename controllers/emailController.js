const db = require('../config/database');
const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const { ResponseHandler, ErrorHandler, handleError, Helpers } = require('../utils/responseHandler');

class EmailController {
  // Verify Email Address
  static async verifyEmail(req, res) {
    const connection = await db.getConnection();
    
    try {
      const { email } = req.body;

      if (!email || !email.trim()) {
        throw new ErrorHandler('Email address is required', 400);
      }

      const cleanEmail = email.trim().toLowerCase();

      // Format validation
      if (!Helpers.validateEmail(cleanEmail)) {
        return ResponseHandler.success(res, {
          email: cleanEmail,
          is_valid: false,
          verification_method: 'FORMAT_CHECK',
          details: {
            format_valid: false,
            mx_records_found: false,
            smtp_check: 'not_performed'
          }
        }, 'Invalid email format');
      }

      // Extract domain
      const domain = cleanEmail.split('@')[1];

      let mxRecordsFound = false;
      try {
        const mxRecords = await dns.resolveMx(domain);
        mxRecordsFound = mxRecords && mxRecords.length > 0;
      } catch (error) {
        console.log('MX lookup failed:', error.message);
      }

      const isValid = mxRecordsFound;

      // Log verification result
      await connection.execute(
        `INSERT INTO email_verification_log 
         (email, is_valid, verification_method, verification_result, verified_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          cleanEmail,
          isValid ? 1 : 0,
          'MX_RECORD',
          JSON.stringify({
            format_valid: true,
            mx_records_found: mxRecordsFound
          }),
          new Date()
        ]
      );

      return ResponseHandler.success(res, {
        email: cleanEmail,
        is_valid: isValid,
        verification_method: 'MX_RECORD',
        details: {
          format_valid: true,
          mx_records_found: mxRecordsFound,
          smtp_check: 'not_performed'
        }
      }, 'Email verification completed');

    } catch (error) {
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Send Email
  static async sendEmail(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const {
        to_emails, cc_emails, bcc_emails, subject, body,
        attachments, related_entity_type, related_entity_id
      } = req.body;

      // Validate required fields
      if (!to_emails || !subject || !body) {
        throw new ErrorHandler('Recipients, subject, and body are required', 400);
      }

      // Ensure to_emails is an array
      let recipients = Array.isArray(to_emails) ? to_emails : [to_emails];
      recipients = recipients.filter(email => email && email.trim());

      if (recipients.length === 0) {
        throw new ErrorHandler('At least one recipient is required', 400);
      }

      // Validate all email addresses
      for (const email of recipients) {
        if (!Helpers.validateEmail(email)) {
          throw new ErrorHandler(`Invalid email address: ${email}`, 400);
        }
      }

      // Get company SMTP configuration
      const [companyConfig] = await connection.execute(
        'SELECT smtp_host, smtp_port, smtp_user, smtp_pass FROM companies WHERE id = ?',
        [req.query.company_id]
      );

      if (companyConfig.length === 0 || !companyConfig[0].smtp_host) {
        throw new ErrorHandler('Company SMTP configuration not found', 400);
      }

      const smtpConfig = {
        host: companyConfig[0].smtp_host,
        port: companyConfig[0].smtp_port || 587,
        secure: companyConfig[0].smtp_port === 465,
        auth: {
          user: companyConfig[0].smtp_user,
          pass: companyConfig[0].smtp_pass
        }
      };

      // Create email log
      const emailLogData = {
        company_id: req.query.company_id,
        email_type: 'SENT',
        from_email: smtpConfig.auth.user,
        to_emails: JSON.stringify(recipients),
        cc_emails: cc_emails ? JSON.stringify(Array.isArray(cc_emails) ? cc_emails : [cc_emails]) : null,
        bcc_emails: bcc_emails ? JSON.stringify(Array.isArray(bcc_emails) ? bcc_emails : [bcc_emails]) : null,
        subject: subject.trim(),
        body: body.trim(),
        attachments: attachments ? JSON.stringify(attachments) : null,
        status: 'PENDING',
        related_entity_type: related_entity_type?.trim() || null,
        related_entity_id: related_entity_id || null,
        sent_by: req.query.id,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('email_logs', emailLogData);
      const [logResult] = await connection.execute(query, values);
      const emailLogId = logResult.insertId;

      // Send email asynchronously
      setImmediate(async () => {
        try {
          const transporter = nodemailer.createTransport(smtpConfig);

          const mailOptions = {
            from: smtpConfig.auth.user,
            to: recipients.join(','),
            cc: cc_emails ? (Array.isArray(cc_emails) ? cc_emails.join(',') : cc_emails) : undefined,
            bcc: bcc_emails ? (Array.isArray(bcc_emails) ? bcc_emails.join(',') : bcc_emails) : undefined,
            subject: subject.trim(),
            html: body.trim(),
            attachments: attachments || []
          };

          await transporter.sendMail(mailOptions);

          // Update email log status to SENT
          await connection.execute(
            'UPDATE email_logs SET status = ?, updated_at = ? WHERE id = ?',
            ['SENT', new Date(), emailLogId]
          );

          console.log(`Email sent successfully: ${emailLogId}`);
        } catch (error) {
          console.error('Email sending failed:', error);

          // Update email log with error
          await connection.execute(
            'UPDATE email_logs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
            ['FAILED', error.message, new Date(), emailLogId]
          );
        }
      });

      await connection.commit();

      return ResponseHandler.created(
        res,
        { email_log_id: emailLogId },
        'Email queued for sending'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Email Logs
  static async getEmailLogs(req, res) {
    try {
      const {
        page, limit, email_type, status, start_date, end_date,
        related_entity_type, related_entity_id
      } = req.query;
      
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['company_id = ?'];
      let queryParams = [req.query.company_id];

      // Filters
      if (email_type) {
        whereConditions.push('email_type = ?');
        queryParams.push(email_type);
      }

      if (status) {
        whereConditions.push('status = ?');
        queryParams.push(status);
      }

      if (related_entity_type) {
        whereConditions.push('related_entity_type = ?');
        queryParams.push(related_entity_type);
      }

      if (related_entity_id) {
        whereConditions.push('related_entity_id = ?');
        queryParams.push(related_entity_id);
      }

      if (start_date) {
        whereConditions.push('DATE(created_at) >= ?');
        queryParams.push(Helpers.formatDate(start_date));
      }

      if (end_date) {
        whereConditions.push('DATE(created_at) <= ?');
        queryParams.push(Helpers.formatDate(end_date));
      }

      const whereClause = whereConditions.join(' AND ');

      // Count total
      const [countResult] = await db.execute(
        `SELECT COUNT(*) as total FROM email_logs WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch email logs
      const [emails] = await db.execute(
        `SELECT el.*,
         CONCAT(u.first_name, ' ', u.last_name) as sent_by_name
         FROM email_logs el
         LEFT JOIN users u ON el.sent_by = u.id
         WHERE ${whereClause}
         ORDER BY el.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        emails,
        { page: pageNum, limit: limitNum, total },
        'Email logs retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Email Details
  static async getEmailById(req, res) {
    try {
      const emailId = Helpers.validateId(req.params.id, 'Email ID');

      const [email] = await db.execute(
        `SELECT el.*,
         CONCAT(u.first_name, ' ', u.last_name) as sent_by_name,
         u.email as sent_by_email
         FROM email_logs el
         LEFT JOIN users u ON el.sent_by = u.id
         WHERE el.id = ? AND el.company_id = ?`,
        [emailId, req.query.company_id]
      );

      if (email.length === 0) {
        throw new ErrorHandler('Email not found', 404);
      }

      return ResponseHandler.success(res, email[0], 'Email retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Resend Email
  static async resendEmail(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const emailId = Helpers.validateId(req.params.id, 'Email ID');

      // Get email details
      const [email] = await connection.execute(
        'SELECT * FROM email_logs WHERE id = ? AND company_id = ?',
        [emailId, req.query.company_id]
      );

      if (email.length === 0) {
        throw new ErrorHandler('Email not found', 404);
      }

      if (email[0].status === 'SENT') {
        throw new ErrorHandler('Email was already sent successfully', 400);
      }

      // Get company SMTP configuration
      const [companyConfig] = await connection.execute(
        'SELECT smtp_host, smtp_port, smtp_user, smtp_pass FROM companies WHERE id = ?',
        [req.query.company_id]
      );

      if (companyConfig.length === 0 || !companyConfig[0].smtp_host) {
        throw new ErrorHandler('Company SMTP configuration not found', 400);
      }

      const smtpConfig = {
        host: companyConfig[0].smtp_host,
        port: companyConfig[0].smtp_port || 587,
        secure: companyConfig[0].smtp_port === 465,
        auth: {
          user: companyConfig[0].smtp_user,
          pass: companyConfig[0].smtp_pass
        }
      };

      // Update status to PENDING
      await connection.execute(
        'UPDATE email_logs SET status = ?, error_message = NULL, updated_at = ? WHERE id = ?',
        ['PENDING', new Date(), emailId]
      );

      // Resend email asynchronously
      setImmediate(async () => {
        try {
          const transporter = nodemailer.createTransport(smtpConfig);

          const toEmails = JSON.parse(email[0].to_emails);
          const ccEmails = email[0].cc_emails ? JSON.parse(email[0].cc_emails) : null;
          const bccEmails = email[0].bcc_emails ? JSON.parse(email[0].bcc_emails) : null;
          const attachments = email[0].attachments ? JSON.parse(email[0].attachments) : [];

          const mailOptions = {
            from: email[0].from_email,
            to: toEmails.join(','),
            cc: ccEmails ? ccEmails.join(',') : undefined,
            bcc: bccEmails ? bccEmails.join(',') : undefined,
            subject: email[0].subject,
            html: email[0].body,
            attachments
          };

          await transporter.sendMail(mailOptions);

          await connection.execute(
            'UPDATE email_logs SET status = ?, updated_at = ? WHERE id = ?',
            ['SENT', new Date(), emailId]
          );

          console.log(`Email resent successfully: ${emailId}`);
        } catch (error) {
          console.error('Email resending failed:', error);

          await connection.execute(
            'UPDATE email_logs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
            ['FAILED', error.message, new Date(), emailId]
          );
        }
      });

      await connection.commit();

      return ResponseHandler.success(res, null, 'Email queued for resending');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }
}

module.exports = EmailController;
