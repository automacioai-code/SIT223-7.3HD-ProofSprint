'use strict';

const jwt = require('jsonwebtoken');

const ISSUER = 'proofsprint';

function signToken(user, config) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: config.jwtTtl, issuer: ISSUER });
}

function requireAuth(config) {
  return (req, res, next) => {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    try {
      req.user = jwt.verify(token, config.jwtSecret, { issuer: ISSUER });
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { signToken, requireAuth };
