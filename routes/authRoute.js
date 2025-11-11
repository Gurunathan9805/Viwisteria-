const express = require('express');
const router = express.Router();
const { 
  register,
  login,
  getProfile,
  updateProfile,
  refreshToken,
  logout,
  getRoles,
} = require('../controllers/auth');
const { verifyToken } = require('../middleware/auth');

// Auth routes
router.post('/register', register);
router.post('/login', login);

// Token routes
router.post('/refresh-token', refreshToken);
router.post('/logout', verifyToken, logout);

// User routes
router.get('/profile', verifyToken,  getProfile);
router.put('/profile', verifyToken, updateProfile);

// Role routes (protected)
router.get('/roles', verifyToken, getRoles);

module.exports = router;
