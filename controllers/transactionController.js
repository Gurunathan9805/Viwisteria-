const pool = require('../config/db');

// @desc    Get all transactions (Admin only)
// @route   GET /api/transactions
// @access  Private/Admin
const getTransactions = async (req, res, next) => {
  try {
    const [transactions] = await pool.query(
      `SELECT t.*, o.order_number, u.name as user_name, u.email as user_email 
       FROM transactions t
       JOIN orders o ON t.order_id = o.id
       JOIN users u ON o.user_id = u.id
       ORDER BY t.created_at DESC`
    );
    
    res.json({
      success: true,
      count: transactions.length,
      data: transactions
    });
    
  } catch (error) {
    next(error);
  }
};

// @desc    Get transaction by ID
// @route   GET /api/transactions/:id
// @access  Private
const getTransactionById = async (req, res, next) => {
  try {
    const [transaction] = await pool.query(
      `SELECT t.*, o.order_number, o.total_amount, u.name as user_name, u.email as user_email 
       FROM transactions t
       JOIN orders o ON t.order_id = o.id
       JOIN users u ON o.user_id = u.id
       WHERE t.id = ?`,
      [req.params.id]
    );
    
    if (transaction.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify user has access to this transaction (either admin or the owner)
    if (req.user.role !== 'admin' && transaction[0].user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this transaction'
      });
    }
    
    // Get order details
    const [order] = await pool.query(
      'SELECT * FROM orders WHERE id = ?',
      [transaction[0].order_id]
    );
    
    // Get order items
    const [items] = await pool.query(
      `SELECT oi.*, p.name, p.image_url as imageUrl 
       FROM order_items oi 
       JOIN products p ON oi.product_id = p.id 
       WHERE oi.order_id = ?`,
      [transaction[0].order_id]
    );
    
    const transactionDetails = {
      ...transaction[0],
      order: order[0],
      items
    };
    
    res.json({
      success: true,
      data: transactionDetails
    });
    
  } catch (error) {
    next(error);
  }
};

// @desc    Process payment
// @route   POST /api/transactions/process-payment
// @access  Private
const processPayment = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { orderId, paymentMethod, paymentDetails } = req.body;
    const userId = req.user.id;
    
    // Verify order exists and belongs to user
    const [order] = await connection.query(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    
    if (order.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // Check if payment already exists
    const [existingPayment] = await connection.query(
      'SELECT * FROM transactions WHERE order_id = ?',
      [orderId]
    );
    
    if (existingPayment.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Payment already processed for this order'
      });
    }
    
    // Create transaction record
    const transactionId = `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    
    await connection.query(
      'INSERT INTO transactions (order_id, transaction_id, amount, payment_method, status, payment_details) VALUES (?, ?, ?, ?, ?, ?)',
      [
        orderId,
        transactionId,
        order[0].total_amount,
        paymentMethod,
        'completed', // In a real app, this would be set based on payment gateway response
        JSON.stringify(paymentDetails || { payment_method: paymentMethod })
      ]
    );
    
    // Update order status
    await connection.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      ['processing', orderId]
    );
    
    // Add to status history
    await connection.query(
      'INSERT INTO order_status_history (order_id, status, notes) VALUES (?, ?, ?)',
      [orderId, 'processing', 'Payment received and order is being processed']
    );
    
    await connection.commit();
    
    res.status(201).json({
      success: true,
      message: 'Payment processed successfully',
      transactionId
    });
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Refund a transaction
// @route   POST /api/transactions/:id/refund
// @access  Private/Admin
const processRefund = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const { amount, reason } = req.body;
    
    // Get transaction details
    const [transaction] = await connection.query(
      'SELECT * FROM transactions WHERE id = ?',
      [req.params.id]
    );
    
    if (transaction.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Check if already refunded
    if (transaction[0].status === 'refunded') {
      return res.status(400).json({
        success: false,
        message: 'This transaction has already been refunded'
      });
    }
    
    // Update transaction status
    await connection.query(
      'UPDATE transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['refunded', req.params.id]
    );
    
    // Update order status
    await connection.query(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['refunded', transaction[0].order_id]
    );
    
    // Add to status history
    await connection.query(
      'INSERT INTO order_status_history (order_id, status, notes) VALUES (?, ?, ?)',
      [transaction[0].order_id, 'refunded', `Refund processed: ${reason || 'No reason provided'}. Amount: ${amount || 'Full amount'}`]
    );
    
    // Return stock if needed
    const [items] = await connection.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
      [transaction[0].order_id]
    );
    
    for (const item of items) {
      await connection.query(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [item.quantity, item.product_id]
      );
    }
    
    await connection.commit();
    
    res.json({
      success: true,
      message: 'Refund processed successfully'
    });
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

module.exports = {
  getTransactions,
  getTransactionById,
  processPayment,
  processRefund
};
