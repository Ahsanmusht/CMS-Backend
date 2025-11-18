const Joi = require('joi');

const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }
    next();
  };
};

// Common validation schemas
const schemas = {
  owner: Joi.object({
    name: Joi.string().min(2).max(255).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
  }),

   user: Joi.object({
    first_name: Joi.string()
      .min(2)
      .max(50)
      .required()
      .messages({
        'string.empty': 'First name is required',
        'string.min': 'First name must be at least 2 characters long',
        'string.max': 'First name must not exceed 50 characters'
      }),
    last_name: Joi.string()
      .min(2)
      .max(50)
      .required()
      .messages({
        'string.empty': 'Last name is required',
        'string.min': 'Last name must be at least 2 characters long',
        'string.max': 'Last name must not exceed 50 characters'
      }),
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.empty': 'Email is required'
      }),
    phone: Joi.string()
      .pattern(/^\+?[0-9]{10,15}$/) // Allows international format
      .required()
      .messages({
        'string.pattern.base': 'Please provide a valid phone number',
        'string.empty': 'Phone number is required'
      }),
    password: Joi.string()
      .min(8)
      .required()
      .messages({
        'string.min': 'Password must be at least 8 characters long',
         'string.empty': 'Password is required'
      }),
    company_id: Joi.number()
      .integer()
      .positive()
      .required()
      .messages({
        'number.base': 'Company ID must be a number',
        'number.integer': 'Company ID must be an integer',
        'number.positive': 'Company ID must be positive',
        'any.required': 'Company ID is required'
      })
  }),

  // Login validation
  login: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.empty': 'Email is required'
      }),
    password: Joi.string()
      .required()
      .messages({
        'string.empty': 'Password is required'
      })
  }),
  company: Joi.object({
    name: Joi.string()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.empty': 'Company name is required',
        'string.min': 'Company name must be at least 2 characters long',
        'string.max': 'Company name must not exceed 100 characters'
      }),
    email: Joi.string()
      .email()
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.empty': 'Company email is required'
      }),
    phone: Joi.string()
      .min(10)
      .max(20)
      .pattern(/^[\+]?[1-9][\d]{0,15}$/)
      .required()
      .messages({
        'string.empty': 'Phone number is required',
        'string.min': 'Phone number must be at least 10 characters long',
        'string.max': 'Phone number must not exceed 20 characters',
        'string.pattern.base': 'Please provide a valid phone number'
      }),
    address: Joi.string()
      .min(10)
      .max(500)
      .required()
      .messages({
        'string.empty': 'Address is required',
        'string.min': 'Address must be at least 10 characters long',
        'string.max': 'Address must not exceed 500 characters'
      }),
    website: Joi.string()
      .uri()
      .optional()
      .allow('')
      .messages({
        'string.uri': 'Please provide a valid website URL'
      }),
    description: Joi.string()
      .max(1000)
      .optional()
      .allow('')
      .messages({
        'string.max': 'Description must not exceed 1000 characters'
      }),
    industry: Joi.string()
      .max(100)
      .optional()
      .allow('')
      .messages({
        'string.max': 'Industry must not exceed 100 characters'
      }),
    employee_count: Joi.number()
      .integer()
      .min(1)
      .max(100000)
      .optional()
      .messages({
        'number.base': 'Employee count must be a number',
        'number.integer': 'Employee count must be an integer',
        'number.min': 'Employee count must be at least 1',
        'number.max': 'Employee count must not exceed 100,000'
      })
  }),

  client: Joi.object({
    first_name: Joi.string().min(1).max(100).required(),
    last_name: Joi.string().min(1).max(100).required(),
    email: Joi.string().email(),
    phone: Joi.string().max(20),
    address: Joi.string(),
    city: Joi.string().max(100),
    state: Joi.string().max(100),
    postal_code: Joi.string().max(20),
    country: Joi.string().max(100),
    client_since: Joi.date(),
    notes: Joi.string()
  }),

  service: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string(),
    base_price: Joi.number().precision(2).min(0),
    duration_minutes: Joi.number().integer().min(1),
    category_id: Joi.number().integer()
  }),

  appointment: Joi.object({
    service_id: Joi.number().integer().required(),
    // service_variant_id: Joi.number().integer(),
    service_variant_id: Joi.allow(null),
    // client_id: Joi.number().integer().required(),
    // provider_id: Joi.number().integer(),
    // user_id: Joi.number().integer(),
    user_id: Joi.allow(null),
    company_id: Joi.number().integer(),
    date: Joi.date().required(),
    status: Joi.string().valid('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled').required(),
    notes: Joi.string(),
    name: Joi.string(),
    email: Joi.string(),
    phone: Joi.string()
  })
};

function validatePasswordDetailed(password) {
    const errors = [];
    
    // Check minimum length
    if (password.length < 8) {
        errors.push("Password must be at least 8 characters long");
    }
    
    // Check for lowercase
    if (!/[a-z]/.test(password)) {
        errors.push("Password must contain at least one lowercase letter (a-z)");
    }
    
    // Check for uppercase
    if (!/[A-Z]/.test(password)) {
        errors.push("Password must contain at least one uppercase letter (A-Z)");
    }
    
    // Check for number
    if (!/\d/.test(password)) {
        errors.push("Password must contain at least one number (0-9)");
    }
    
    // Check for allowed special characters
    const allowedSpecialChars = "@$!%*?&";
    const hasAllowedSpecialChar = /[@$!%*?&]/.test(password);
    
    if (!hasAllowedSpecialChar) {
        errors.push(`Password must contain at least one of these special characters: ${allowedSpecialChars}`);
    }
    
    // Check for invalid characters
    const validPattern = /^[A-Za-z\d@$!%*?&]+$/;
    if (!validPattern.test(password)) {
        const invalidChars = password.split('').filter(char => 
            !/[A-Za-z\d@$!%*?&]/.test(char)
        );
        const uniqueInvalidChars = [...new Set(invalidChars)];
        errors.push(`Invalid characters found: ${uniqueInvalidChars.join(', ')}. Only letters, numbers, and ${allowedSpecialChars} are allowed`);
    }
    
    return {
        valid: errors.length === 0,
        errors: errors,
        message: errors.length > 0 ? errors.join('. ') : 'Password is valid'
    };
}

module.exports = { validate, schemas, validatePasswordDetailed };