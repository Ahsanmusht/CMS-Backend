class ContactController {
  // Create Contact Inquiry
  static async createInquiry(req, res) {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();

      const { name, email, phone, subject, message, source } = req.body;

      // Validate required fields
      if (!name || !email || !subject || !message) {
        throw new ErrorHandler('Name, email, subject, and message are required', 400);
      }

      // Validate email
      if (!Helpers.validateEmail(email)) {
        throw new ErrorHandler('Invalid email format', 400);
      }

      // Get company_id from request or use default
      const company_id = req.body.company_id || req.query?.company_id || 1;

      const inquiryData = {
        company_id,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        subject: subject.trim(),
        message: message.trim(),
        source: source?.trim() || 'WEBSITE',
        status: 'NEW',
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent'] || null,
        created_at: new Date(),
        updated_at: new Date()
      };

      const { query, values } = Helpers.buildInsertQuery('contact_inquiries', inquiryData);
      const [result] = await connection.execute(query, values);

      // Fetch created inquiry
      const [inquiry] = await connection.execute(
        'SELECT * FROM contact_inquiries WHERE id = ?',
        [result.insertId]
      );

      // Send auto-reply email asynchronously
      setImmediate(async () => {
        try {
          // Get company email config
          const [companyConfig] = await connection.execute(
            'SELECT smtp_host, smtp_port, smtp_user, smtp_pass, to_emails FROM companies WHERE id = ?',
            [company_id]
          );

          if (companyConfig.length > 0 && companyConfig[0].smtp_host) {
            const smtpConfig = {
              host: companyConfig[0].smtp_host,
              port: companyConfig[0].smtp_port || 587,
              secure: companyConfig[0].smtp_port === 465,
              auth: {
                user: companyConfig[0].smtp_user,
                pass: companyConfig[0].smtp_pass
              }
            };

            const transporter = nodemailer.createTransporter(smtpConfig);

            // Send auto-reply to inquirer
            await transporter.sendMail({
              from: smtpConfig.auth.user,
              to: email,
              subject: `We received your inquiry: ${subject}`,
              html: `
                <h2>Thank you for contacting us!</h2>
                <p>Dear ${name},</p>
                <p>We have received your inquiry and will get back to you as soon as possible.</p>
                <p><strong>Your message:</strong></p>
                <p>${message}</p>
                <br>
                <p>Best regards,<br>Support Team</p>
              `
            });

            // Send notification to company
            const companyEmails = JSON.parse(companyConfig[0].to_emails || '[]');
            if (companyEmails.length > 0) {
              await transporter.sendMail({
                from: smtpConfig.auth.user,
                to: companyEmails.join(','),
                subject: `New Contact Inquiry: ${subject}`,
                html: `
                  <h2>New Contact Inquiry Received</h2>
                  <p><strong>From:</strong> ${name} (${email})</p>
                  <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
                  <p><strong>Subject:</strong> ${subject}</p>
                  <p><strong>Message:</strong></p>
                  <p>${message}</p>
                  <br>
                  <p><strong>Source:</strong> ${source || 'WEBSITE'}</p>
                  <p><strong>IP Address:</strong> ${inquiryData.ip_address}</p>
                `
              });
            }
          }
        } catch (error) {
          console.error('Failed to send contact inquiry emails:', error);
        }
      });

      await connection.commit();

      return ResponseHandler.created(
        res,
        inquiry[0],
        'Contact inquiry submitted successfully. We will get back to you soon.'
      );

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get All Inquiries
  static async getAllInquiries(req, res) {
    try {
      const { page, limit, status, assigned_to, start_date, end_date } = req.query;
      const { page: pageNum, limit: limitNum, offset } = Helpers.validatePagination(page, limit);

      let whereConditions = ['company_id = ?'];
      let queryParams = [req.query.company_id];

      // Filters
      if (status) {
        whereConditions.push('status = ?');
        queryParams.push(status);
      }

      if (assigned_to) {
        whereConditions.push('assigned_to = ?');
        queryParams.push(assigned_to);
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
        `SELECT COUNT(*) as total FROM contact_inquiries WHERE ${whereClause}`,
        queryParams
      );
      const total = countResult[0].total;

      // Fetch inquiries
      const [inquiries] = await db.execute(
        `SELECT ci.*,
         CONCAT(u1.first_name, ' ', u1.last_name) as assigned_to_name,
         CONCAT(u2.first_name, ' ', u2.last_name) as responded_by_name
         FROM contact_inquiries ci
         LEFT JOIN users u1 ON ci.assigned_to = u1.id
         LEFT JOIN users u2 ON ci.responded_by = u2.id
         WHERE ${whereClause}
         ORDER BY ci.created_at DESC
         LIMIT ? OFFSET ?`,
        [...queryParams, limitNum, offset]
      );

      return ResponseHandler.successWithPagination(
        res,
        inquiries,
        { page: pageNum, limit: limitNum, total },
        'Contact inquiries retrieved successfully'
      );

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Get Inquiry Details
  static async getInquiryById(req, res) {
    try {
      const inquiryId = Helpers.validateId(req.params.id, 'Inquiry ID');

      const [inquiry] = await db.execute(
        `SELECT ci.*,
         CONCAT(u1.first_name, ' ', u1.last_name) as assigned_to_name,
         CONCAT(u2.first_name, ' ', u2.last_name) as responded_by_name
         FROM contact_inquiries ci
         LEFT JOIN users u1 ON ci.assigned_to = u1.id
         LEFT JOIN users u2 ON ci.responded_by = u2.id
         WHERE ci.id = ? AND ci.company_id = ?`,
        [inquiryId, req.query.company_id]
      );

      if (inquiry.length === 0) {
        throw new ErrorHandler('Inquiry not found', 404);
      }

      return ResponseHandler.success(res, inquiry[0], 'Inquiry retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }

  // Update Inquiry Status
  static async updateInquiryStatus(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const inquiryId = Helpers.validateId(req.params.id, 'Inquiry ID');
      const { status } = req.body;

      if (!status) {
        throw new ErrorHandler('Status is required', 400);
      }

      const validStatuses = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
      if (!validStatuses.includes(status)) {
        throw new ErrorHandler(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
      }

      const [existingInquiry] = await connection.execute(
        'SELECT id FROM contact_inquiries WHERE id = ? AND company_id = ?',
        [inquiryId, req.query.company_id]
      );

      if (existingInquiry.length === 0) {
        throw new ErrorHandler('Inquiry not found', 404);
      }

      await connection.execute(
        'UPDATE contact_inquiries SET status = ?, updated_at = ? WHERE id = ? AND company_id = ?',
        [status, new Date(), inquiryId, req.query.company_id]
      );

      await connection.commit();

      return ResponseHandler.success(res, null, 'Inquiry status updated successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Assign Inquiry
  static async assignInquiry(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const inquiryId = Helpers.validateId(req.params.id, 'Inquiry ID');
      const { assigned_to } = req.body;

      if (!assigned_to) {
        throw new ErrorHandler('User ID is required', 400);
      }

      // Verify user exists
      const [user] = await connection.execute(
        'SELECT id FROM users WHERE id = ? AND company_id = ?',
        [assigned_to, req.query.company_id]
      );

      if (user.length === 0) {
        throw new ErrorHandler('User not found', 404);
      }

      const [existingInquiry] = await connection.execute(
        'SELECT id, status FROM contact_inquiries WHERE id = ? AND company_id = ?',
        [inquiryId, req.query.company_id]
      );

      if (existingInquiry.length === 0) {
        throw new ErrorHandler('Inquiry not found', 404);
      }

      // Update status to IN_PROGRESS if NEW
      const newStatus = existingInquiry[0].status === 'NEW' ? 'IN_PROGRESS' : existingInquiry[0].status;

      await connection.execute(
        'UPDATE contact_inquiries SET assigned_to = ?, status = ?, updated_at = ? WHERE id = ? AND company_id = ?',
        [assigned_to, newStatus, new Date(), inquiryId, req.query.company_id]
      );

      await connection.commit();

      return ResponseHandler.success(res, null, 'Inquiry assigned successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Respond to Inquiry
  static async respondToInquiry(req, res) {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const inquiryId = Helpers.validateId(req.params.id, 'Inquiry ID');
      const { response, send_email } = req.body;

      if (!response || !response.trim()) {
        throw new ErrorHandler('Response is required', 400);
      }

      // Get inquiry details
      const [inquiry] = await connection.execute(
        'SELECT * FROM contact_inquiries WHERE id = ? AND company_id = ?',
        [inquiryId, req.query.company_id]
      );

      if (inquiry.length === 0) {
        throw new ErrorHandler('Inquiry not found', 404);
      }

      // Update inquiry
      await connection.execute(
        `UPDATE contact_inquiries 
         SET response = ?, status = 'RESOLVED', responded_at = ?, responded_by = ?, updated_at = ?
         WHERE id = ? AND company_id = ?`,
        [response.trim(), new Date(), req.query.id, new Date(), inquiryId, req.query.company_id]
      );

      // Send email if requested
      if (send_email === true || send_email === 'true') {
        setImmediate(async () => {
          try {
            const [companyConfig] = await connection.execute(
              'SELECT smtp_host, smtp_port, smtp_user, smtp_pass FROM companies WHERE id = ?',
              [req.query.company_id]
            );

            if (companyConfig.length > 0 && companyConfig[0].smtp_host) {
              const smtpConfig = {
                host: companyConfig[0].smtp_host,
                port: companyConfig[0].smtp_port || 587,
                secure: companyConfig[0].smtp_port === 465,
                auth: {
                  user: companyConfig[0].smtp_user,
                  pass: companyConfig[0].smtp_pass
                }
              };

              const transporter = nodemailer.createTransporter(smtpConfig);

              await transporter.sendMail({
                from: smtpConfig.auth.user,
                to: inquiry[0].email,
                subject: `Re: ${inquiry[0].subject}`,
                html: `
                  <h2>Response to Your Inquiry</h2>
                  <p>Dear ${inquiry[0].name},</p>
                  <p>${response}</p>
                  <br>
                  <p><strong>Your original message:</strong></p>
                  <p>${inquiry[0].message}</p>
                  <br>
                  <p>Best regards,<br>Support Team</p>
                `
              });
            }
          } catch (error) {
            console.error('Failed to send response email:', error);
          }
        });
      }

      await connection.commit();

      return ResponseHandler.success(res, null, 'Response sent successfully');

    } catch (error) {
      await connection.rollback();
      return handleError(error, res);
    } finally {
      connection.release();
    }
  }

  // Get Inquiry Statistics
  static async getInquiryStatistics(req, res) {
    try {
      const [stats] = await db.execute(`
        SELECT 
          COUNT(*) as total_inquiries,
          COUNT(CASE WHEN status = 'NEW' THEN 1 END) as new_inquiries,
          COUNT(CASE WHEN status = 'IN_PROGRESS' THEN 1 END) as in_progress_inquiries,
          COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) as resolved_inquiries,
          COUNT(CASE WHEN status = 'CLOSED' THEN 1 END) as closed_inquiries,
          COUNT(CASE WHEN source = 'WEBSITE' THEN 1 END) as website_inquiries,
          COUNT(CASE WHEN source = 'EMAIL' THEN 1 END) as email_inquiries,
          COUNT(CASE WHEN source = 'PHONE' THEN 1 END) as phone_inquiries
        FROM contact_inquiries
        WHERE company_id = ?
      `, [req.query.company_id]);

      return ResponseHandler.success(res, stats[0], 'Inquiry statistics retrieved successfully');

    } catch (error) {
      return handleError(error, res);
    }
  }
}

module.exports = ContactController;