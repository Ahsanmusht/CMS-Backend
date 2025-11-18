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