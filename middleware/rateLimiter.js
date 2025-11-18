// // middleware/rateLimiter.js
// const rateLimit = require('express-rate-limit');

// // Helper to convert ms to readable format
// function formatDuration(ms) {
//   const minutes = Math.floor(ms / (60 * 1000)) % 60;
//   const hours = Math.floor(ms / (60 * 60 * 1000)) % 24;
//   const days = Math.floor(ms / (24 * 60 * 60 * 1000));

//   const parts = [];
//   if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
//   if (hours) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
//   if (minutes) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

//   return parts.join(', ') || 'a few moments';
// }

// // Main middleware generator
// const createRateLimiter = (windowMs, maxAttempts = 5) => {
//   const readableTime = formatDuration(windowMs);

//   return rateLimit({
//     windowMs,
//     max: maxAttempts,
//     handler: (req, res) => {
//     res.status(429).json({
//       message: `Too many requests. Please try again after ${readableTime}.`,
//       code: "RATE_LIMIT_EXCEEDED"
//     });
//   },
//     standardHeaders: true,
//     legacyHeaders: false,
//   });
// };

// module.exports = createRateLimiter;


// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Helper to convert ms to readable format
function formatDuration(ms) {
  const minutes = Math.floor(ms / (60 * 1000)) % 60;
  const hours = Math.floor(ms / (60 * 60 * 1000)) % 24;
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));

  const parts = [];
  if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  if (hours) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

  return parts.join(', ') || 'a few moments';
}

// Main middleware generator with improved configuration
const createRateLimiter = (windowMs, maxAttempts = 5) => {
  const readableTime = formatDuration(windowMs);

  return rateLimit({
    windowMs,
    max: maxAttempts,
    
    // Better key generator - combines IP with user agent for more accurate tracking
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
      return `${ip}`;
    },
    
    // Skip successful requests from rate limiting count
    skipSuccessfulRequests: true,
    
    // Skip failed requests only if they're server errors (not client errors like wrong password)
    skipFailedRequests: false,
    
    handler: (req, res) => {
      const resetTime = new Date(Date.now() + windowMs);
      res.status(429).json({
        message: `Too many failed login attempts. Please try again after ${readableTime}.`,
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil(windowMs / 1000), // seconds
        resetTime: resetTime.toISOString()
      });
    },
    
    standardHeaders: true,
    legacyHeaders: false,
    
    // Add headers to help with debugging
    onLimitReached: (req, res, options) => {
      console.log(`Rate limit reached for IP: ${req.ip}, Path: ${req.path}`);
    },
    
    // Store in memory for now (you can change to Redis later for production)
    store: undefined // uses default memory store
  });
};

// Login specific rate limiter with better configuration
const loginRateLimiter = createRateLimiter(1 * 60 * 1000, 5); // 10 minutes window, 5 attempts

module.exports = { createRateLimiter, loginRateLimiter };
