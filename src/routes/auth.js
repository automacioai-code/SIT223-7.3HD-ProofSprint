'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const { signToken, requireAuth } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

function validateRegistration({ email, password, name }) {
  if (!EMAIL.test(String(email || ''))) return 'A valid email is required';
  if (String(password || '').length < 8) return 'Password must be at least 8 characters';
  if (String(name || '').trim().length > 80) return 'Name must be 80 characters or fewer';
  return null;
}

function authRoutes({ config, store, metrics }) {
  const router = express.Router();
  router.use(['/register', '/login'], rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authRateLimit, standardHeaders: 'draft-7', legacyHeaders: false }));

  router.post('/register', async (req, res, next) => {
    try {
      const problem = validateRegistration(req.body);
      if (problem) throw httpError(400, problem);
      const email = req.body.email.toLowerCase();
      if (store.findOne('users', (u) => u.email === email)) throw httpError(409, 'An account with this email already exists');
      const passwordHash = await bcrypt.hash(req.body.password, config.bcryptRounds);
      const user = store.insert('users', { email, name: String(req.body.name || '').trim() || email.split('@')[0], passwordHash });
      metrics.usersRegistered.inc();
      res.status(201).json({ token: signToken(user, config), user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = String(req.body.email || '').toLowerCase();
      const user = store.findOne('users', (u) => u.email === email);
      const valid = user && (await bcrypt.compare(String(req.body.password || ''), user.passwordHash));
      if (!valid) throw httpError(401, 'Invalid email or password');
      res.json({ token: signToken(user, config), user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth(config), (req, res, next) => {
    const user = store.findOne('users', (u) => u.id === req.user.sub);
    return user ? res.json({ user: publicUser(user) }) : next(httpError(404, 'User not found'));
  });

  return router;
}

module.exports = { authRoutes, validateRegistration };
