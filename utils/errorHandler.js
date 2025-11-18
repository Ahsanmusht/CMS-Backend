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

  // Database specific errors
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