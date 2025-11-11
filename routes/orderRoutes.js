const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const {
  createOrder,
  getUserOrders,
  getOrderById,
  updateOrderStatus,
  getAllOrders
} = require('../controllers/orderController');

const {
  getTransactions,
  getTransactionById,
  processPayment,
  processRefund
} = require('../controllers/transactionController');

// User routes
router.post('/', verifyToken, createOrder);
router.get('/', verifyToken, getUserOrders);
router.get('/:id', verifyToken, getOrderById);
router.post('/:id/pay', verifyToken, processPayment);

// Admin routes
router.get('/admin/orders', verifyToken, checkRole(['admin']), getAllOrders);
router.put('/:id/status', verifyToken, checkRole(['admin']), updateOrderStatus);

// Transaction routes
router.get('/transactions/all', verifyToken, checkRole(['admin']), getTransactions);
router.get('/transactions/:id', verifyToken, getTransactionById);
router.post('/transactions/:id/refund', verifyToken, checkRole(['admin']), processRefund);

module.exports = router;
