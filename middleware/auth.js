const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user still exists and is active
    let user = null;
    
    if (decoded.userType === 'owner') {
      const [owners] = await db.execute(
        'SELECT id, name, email FROM owners WHERE id = ?',
        [decoded.id]
      );
      
      if (owners.length > 0) {
        user = {
          ...owners[0],
          userType: 'owner'
        };
      }
    } else if (decoded.userType === 'user') {
      const [users] = await db.execute(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.company_id, u.is_active,
                c.name as company_name
         FROM users u 
         JOIN companies c ON u.company_id = c.id 
         WHERE u.id = ? AND u.is_active = 1`,
        [decoded.id]
      );
      
      if (users.length > 0) {
        user = {
          ...users[0],
          userType: 'user'
        };
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

const authenticateOwner = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if it's an owner token
    if (decoded.userType !== 'owner') {
      return res.status(403).json({ error: 'Access denied. Owner privileges required.' });
    }
    
    // Verify owner still exists
    const [owners] = await db.execute(
      'SELECT id, name, email FROM owners WHERE id = ?',
      [decoded.id]
    );

    if (!owners.length) {
      return res.status(401).json({ error: 'Owner not found' });
    }

    req.owner = owners[0]; // For backward compatibility
    req.user = { ...owners[0], userType: 'owner' }; // Standard format
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = { authenticateToken, authenticateOwner };