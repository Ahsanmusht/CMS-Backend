const db = require('../config/database');

const validateProfileToken = async (req, res, next) => {
  const connection = await db.getConnection();

  try {
    const { token } = req.query || req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Check token validity
    const [tokens] = await connection.execute(
      `SELECT t.*, u.id as user_id, u.email, u.first_name, u.last_name, u.phone, u.company_id, u.is_active
       FROM user_profile_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token = ? AND t.is_used = 0 AND t.expires_at > NOW()`,
      [token]
    );

    if (tokens.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid or expired token',
        expired: true 
      });
    }

    const tokenData = tokens[0];

    // Check if user is already active
    if (tokenData.is_active === 1) {
      return res.status(400).json({ 
        error: 'Profile already completed',
        already_completed: true 
      });
    }

    // Attach user data to request
    req.user = tokenData;
    req.token = token;

    next();

  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Token validation failed' });
  } finally {
    connection.release();
  }
};

module.exports = {validateProfileToken};