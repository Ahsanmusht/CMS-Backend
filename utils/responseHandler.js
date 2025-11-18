class ResponseHandler {
  static success(res, data, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  static successWithPagination(res, data, pagination, message = 'Success') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination: {
        current_page: pagination.page,
        per_page: pagination.limit,
        total_items: pagination.total,
        total_pages: Math.ceil(pagination.total / pagination.limit),
        has_next: pagination.page < Math.ceil(pagination.total / pagination.limit),
        has_prev: pagination.page > 1
      },
      timestamp: new Date().toISOString()
    });
  }

  static created(res, data, message = 'Resource created successfully') {
    return res.status(201).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  static error(res, message = 'Error occurred', statusCode = 500, errors = null) {
    const response = {
      success: false,
      message,
      timestamp: new Date().toISOString()
    };

    if (errors) {
      response.errors = errors;
    }

    return res.status(statusCode).json(response);
  }
}
class ErrorHandler extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const handleError = (err, res) => {
  const { statusCode = 500, message } = err;

  if (err.code === 'ER_DUP_ENTRY') {
    return ResponseHandler.error(res, 'Duplicate entry. Record already exists.', 409);
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return ResponseHandler.error(res, 'Invalid reference. Related record not found.', 400);
  }
  if (err.code === 'ER_DATA_TOO_LONG') {
    return ResponseHandler.error(res, 'Data too long for field.', 400);
  }
  if (err.code === 'ER_BAD_NULL_ERROR') {
    return ResponseHandler.error(res, 'Required field cannot be null.', 400);
  }

  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    code: err.code,
    timestamp: new Date().toISOString()
  });

  return ResponseHandler.error(res, message || 'Internal server error', statusCode);
};

class Helpers {
  static validatePagination(page, limit) {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const offset = (pageNum - 1) * limitNum;
    return { page: pageNum, limit: limitNum, offset };
  }

  static validateId(id, fieldName = 'ID') {
    const numId = parseInt(id);
    if (isNaN(numId) || numId <= 0) {
      throw new ErrorHandler(`Invalid ${fieldName}. Must be a positive integer.`, 400);
    }
    return numId;
  }

  static sanitizeInput(data) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== null) {
        sanitized[key] = typeof value === 'string' ? value.trim() : value;
      }
    }
    return sanitized;
  }

  static buildUpdateQuery(tableName, data, whereClause) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    return {
      query: `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause}`,
      values
    };
  }

  static buildInsertQuery(tableName, data) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map(() => '?').join(', ');
    return {
      query: `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders})`,
      values
    };
  }

  static formatDate(date) {
    if (!date) return null;
    return new Date(date).toISOString().split('T')[0];
  }

  static validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static validatePhone(phone) {
    const phoneRegex = /^[\+]?[\d\s\-\(\)]{7,20}$/;
    return phoneRegex.test(phone);
  }

  static generateUniqueCode(prefix = 'CODE') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }
}

module.exports = { ResponseHandler, ErrorHandler, handleError, Helpers };