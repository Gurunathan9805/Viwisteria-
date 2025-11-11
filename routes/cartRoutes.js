const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart
} = require('../controllers/cartController');

// All routes are protected with JWT authentication
router.use(verifyToken);

// GET /api/cart - Get user's cart
router.get('/', getCart);

// POST /api/cart/items - Add item to cart
router.post('/items', addToCart);

// PUT /api/cart/items/:itemId - Update cart item quantity
router.put('/items/:itemId', updateCartItem);

// DELETE /api/cart/items/:itemId - Remove item from cart
router.delete('/items/:itemId', removeFromCart);

// DELETE /api/cart - Clear cart
router.delete('/', clearCart);

module.exports = router;
