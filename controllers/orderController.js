const pool = require("../config/db");
const { v4: uuidv4 } = require("uuid");

// @desc    Create a new order
// @route   POST /api/orders
// @access  Private
const createOrder = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get user ID from the authenticated user
    const userId = req.user.id;
    const { items, shippingInfo, paymentMethod } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    console.log(items);
    // Verify all products exist before proceeding
    for (const item of items) {
      const [product] = await connection.query(
        "SELECT id FROM products WHERE id = ?",
        [item.id]
      );
      if (!product.length) {
        return res
          .status(400)
          .json({ message: `Product with ID ${item.id} not found` });
      }
    }

    // 1. Create order
    const orderNumber = `ORD-${Date.now()}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;
    const totalAmount = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // First insert the order
    const [orderResult] = await connection.query(
      "INSERT INTO orders (user_id, order_number, total_amount, shipping_name, shipping_email, shipping_address, shipping_city, shipping_zip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        userId,
        orderNumber,
        totalAmount,
        shippingInfo.name,
        shippingInfo.email,
        shippingInfo.address,
        shippingInfo.city,
        shippingInfo.zip,
      ]
    );

    if (!orderResult.insertId) {
      throw new Error("Failed to create order");
    }

    const orderId = orderResult.insertId;

    // 2. Add order items
    for (const item of items) {
      await connection.query(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [orderId, item.id, item.quantity, item.price]
      );

      // Update product stock
      await connection.query(
        "UPDATE products SET stock = stock - ? WHERE id = ?",
        [item.quantity, item.id]
      );
    }

    // 3. Create transaction record
    const transactionId = `TXN-${Date.now()}-${Math.floor(
      1000 + Math.random() * 9000
    )}`;

    await connection.query(
      "INSERT INTO transactions (order_id, transaction_id, amount, payment_method, status, payment_details) VALUES (?, ?, ?, ?, ?, ?)",
      [
        orderId,
        transactionId,
        totalAmount,
        paymentMethod,
        "completed", // You might want to make this dynamic based on payment gateway response
        JSON.stringify({
          payment_method: paymentMethod,
          // Add any additional payment details here
        }),
      ]
    );

    // 4. Add initial status to order history
    await connection.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES (?, ?, ?)",
      [orderId, "pending", "Order created and payment received"]
    );

    // 5. Get the user's cart ID and clear the cart
    const [cart] = await connection.query(
      "SELECT id FROM carts WHERE user_id = ?",
      [userId]
    );

    if (cart.length > 0) {
      await connection.query(
        "DELETE FROM cart_items WHERE cart_id = ?",
        [cart[0].id]
      );
    }

    await connection.commit();

    res.status(201).json({
      success: true,
      orderId,
      orderNumber,
      transactionId,
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Get all orders for a user
// @route   GET /api/orders
// @access  Private
const getUserOrders = async (req, res, next) => {
  try {
    const [orders] = await pool.query(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );

    // Get order items for each order
    for (const order of orders) {
      const [items] = await pool.query(
        `SELECT oi.*, p.name, p.image_url as imageUrl 
         FROM order_items oi 
         JOIN products p ON oi.product_id = p.id 
         WHERE oi.order_id = ?`,
        [order.id]
      );
      order.items = items;

      // Get latest status
      const [status] = await pool.query(
        "SELECT status FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
        [order.id]
      );
      order.currentStatus = status[0]?.status || "pending";
    }

    res.json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = async (req, res, next) => {
  try {
    const [order] = await pool.query(
      "SELECT * FROM orders WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );

    if (order.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Get order items
    const [items] = await pool.query(
      `SELECT oi.*, p.name, p.image_url as imageUrl, p.category 
       FROM order_items oi 
       JOIN products p ON oi.product_id = p.id 
       WHERE oi.order_id = ?`,
      [req.params.id]
    );

    // Get status history
    const [statusHistory] = await pool.query(
      "SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at",
      [req.params.id]
    );

    // Get transaction details
    const [transaction] = await pool.query(
      "SELECT * FROM transactions WHERE order_id = ?",
      [req.params.id]
    );

    const orderDetails = {
      ...order[0],
      items,
      statusHistory,
      transaction: transaction[0] || null,
    };

    res.json({
      success: true,
      data: orderDetails,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update order status (Admin only)
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
const updateOrderStatus = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const { status, notes } = req.body;

    // Check if order exists
    const [order] = await connection.query(
      "SELECT * FROM orders WHERE id = ?",
      [req.params.id]
    );

    if (order.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update order status
    await connection.query(
      "UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [status, req.params.id]
    );

    // Add to status history
    await connection.query(
      "INSERT INTO order_status_history (order_id, status, notes) VALUES (?, ?, ?)",
      [req.params.id, status, notes || `Status updated to ${status}`]
    );

    // If order is cancelled, return stock
    if (status === "cancelled") {
      const [items] = await connection.query(
        "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
        [req.params.id]
      );

      for (const item of items) {
        await connection.query(
          "UPDATE products SET stock = stock + ? WHERE id = ?",
          [item.quantity, item.product_id]
        );
      }
    }

    await connection.commit();

    res.json({
      success: true,
      message: "Order status updated successfully",
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Get all orders (Admin only)
// @route   GET /api/orders/all
// @access  Private/Admin
const getAllOrders = async (req, res, next) => {
  try {
    // Fetch all orders
    const [orders] = await pool.query(
      `SELECT o.*, u.name as user_name, u.email as user_email 
       FROM orders o
       JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );

    // Get order items and status for each order
    for (const order of orders) {
      // Get order items
      const [items] = await pool.query(
        `SELECT oi.*, p.name, p.image_url as imageUrl 
         FROM order_items oi 
         JOIN products p ON oi.product_id = p.id 
         WHERE oi.order_id = ?`,
        [order.id]
      );
      order.items = items;

      // Get latest status
      const [status] = await pool.query(
        "SELECT status FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
        [order.id]
      );
      order.status = status[0]?.status || "pending";
    }

    res.json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all orders for admin users
// @route   GET /api/admin/orders
// @access  Private/Admin
const getAdminOrders = async (req, res, next) => {
  try {
    // Fetch all orders
    const [orders] = await pool.query(
      `SELECT o.*, u.name as user_name, u.email as user_email 
       FROM orders o
       JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );

    // Get order items and status for each order
    for (const order of orders) {
      // Get order items
      const [items] = await pool.query(
        `SELECT oi.*, p.name, p.image_url as imageUrl 
         FROM order_items oi 
         JOIN products p ON oi.product_id = p.id 
         WHERE oi.order_id = ?`,
        [order.id]
      );
      order.items = items;

      // Get latest status
      const [status] = await pool.query(
        "SELECT status FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC LIMIT 1",
        [order.id]
      );
      order.status = status[0]?.status || "pending";
    }

    res.json({
      success: true,
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getUserOrders,
  getOrderById,
  updateOrderStatus,
  getAllOrders,
  getAdminOrders,
};
