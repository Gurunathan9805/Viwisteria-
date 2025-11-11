const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const { uploadImage } = require('../config/cloudinary');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
} = require('../controllers/productController');

// Public routes - no authentication required
router.get('/', getProducts);
router.get('/:id', getProductById);

// Apply authentication and admin check to all other routes
router.use(verifyToken);
router.use(checkRole(['admin']));

// Protected routes - require authentication and admin role
router.post('/', uploadImage, createProduct);
router.put('/:id', uploadImage, updateProduct);
router.delete('/:id', deleteProduct);

module.exports = router;
