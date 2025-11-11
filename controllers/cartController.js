const pool = require('../config/db');

// @desc    Get or create user's cart
// @route   GET /api/cart
// @access  Private
const getCart = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.id;
    
    // Find or create cart for user
    let [carts] = await connection.query(
      'SELECT * FROM carts WHERE user_id = ?',
      [userId]
    );
    
    let cart = carts[0];
    
    if (!cart) {
      // Create new cart if it doesn't exist
      const [result] = await connection.query(
        'INSERT INTO carts (user_id) VALUES (?)',
        [userId]
      );
      cart = { id: result.insertId, user_id: userId };
    }
    
    // Get cart items with product details
    const [items] = await connection.query(
      `SELECT ci.*, p.name, p.price, p.image_url as imageUrl, p.stock 
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = ?`,
      [cart.id]
    );
    
    // Calculate total
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    await connection.commit();
    
    res.json({
      success: true,
      data: {
        id: cart.id,
        userId: cart.user_id,
        items,
        total: parseFloat(total.toFixed(2)),
        itemCount: items.reduce((count, item) => count + item.quantity, 0)
      }
    });
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Add item to cart
// @route   POST /api/cart/items
// @access  Private
const addToCart = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.id;
    const { productId, quantity = 1 } = req.body;
    
    // Validate input
    if (!productId || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and valid quantity are required'
      });
    }
    
    // Check if product exists and is in stock
    const [products] = await connection.query(
      'SELECT * FROM products WHERE id = ?',
      [productId]
    );
    
    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }
    
    const product = products[0];
    
    if (product.stock < quantity) {
      return res.status(400).json({
        success: false,
        message: `Only ${product.stock} items available in stock`
      });
    }
    
    // Get or create cart
    let [carts] = await connection.query(
      'SELECT * FROM carts WHERE user_id = ?',
      [userId]
    );
    
    let cart = carts[0];
    
    if (!cart) {
      const [result] = await connection.query(
        'INSERT INTO carts (user_id) VALUES (?)',
        [userId]
      );
      cart = { id: result.insertId, user_id: userId };
    }
    
    // Check if item already in cart
    const [existingItems] = await connection.query(
      'SELECT * FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cart.id, productId]
    );
    
    if (existingItems.length > 0) {
      // Update quantity if item already in cart
      const newQuantity = existingItems[0].quantity + quantity;
      
      if (product.stock < newQuantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock - existingItems[0].quantity} more items available in stock`
        });
      }
      
      await connection.query(
        'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newQuantity, existingItems[0].id]
      );
    } else {
      // Add new item to cart
      await connection.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)',
        [cart.id, productId, quantity]
      );
    }
    
    await connection.commit();
    
    // Return updated cart
    return getCart(req, res, next);
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Update cart item quantity
// @route   PUT /api/cart/items/:itemId
// @access  Private
const updateCartItem = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.id;
    const { itemId } = req.params;
    const { quantity } = req.body;
    
    // Validate input
    if (quantity === undefined || quantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid quantity is required'
      });
    }
    
    // Get cart item with product details
    const [items] = await connection.query(
      `SELECT ci.*, p.stock 
       FROM cart_items ci
       JOIN carts c ON ci.cart_id = c.id
       JOIN products p ON ci.product_id = p.id
       WHERE ci.id = ? AND c.user_id = ?`,
      [itemId, userId]
    );
    
    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    const cartItem = items[0];
    
    if (quantity === 0) {
      // Remove item if quantity is 0
      await connection.query(
        'DELETE FROM cart_items WHERE id = ?',
        [itemId]
      );
    } else {
      // Check stock
      if (cartItem.stock < quantity) {
        return res.status(400).json({
          success: false,
          message: `Only ${cartItem.stock} items available in stock`
        });
      }
      
      // Update quantity
      await connection.query(
        'UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [quantity, itemId]
      );
    }
    
    await connection.commit();
    
    // Return updated cart
    return getCart(req, res, next);
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/items/:itemId
// @access  Private
const removeFromCart = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.id;
    const { itemId } = req.params;
    
    // Check if item exists in user's cart
    const [items] = await connection.query(
      `SELECT ci.* FROM cart_items ci
       JOIN carts c ON ci.cart_id = c.id
       WHERE ci.id = ? AND c.user_id = ?`,
      [itemId, userId]
    );
    
    if (items.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cart item not found'
      });
    }
    
    // Remove item from cart
    await connection.query(
      'DELETE FROM cart_items WHERE id = ?',
      [itemId]
    );
    
    await connection.commit();
    
    // Return updated cart
    return getCart(req, res, next);
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
const clearCart = async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const userId = req.user.id;
    
    // Get user's cart
    const [carts] = await connection.query(
      'SELECT id FROM carts WHERE user_id = ?',
      [userId]
    );
    
    if (carts.length === 0) {
      return res.json({
        success: true,
        message: 'Cart is already empty'
      });
    }
    
    const cartId = carts[0].id;
    
    // Remove all items from cart
    await connection.query(
      'DELETE FROM cart_items WHERE cart_id = ?',
      [cartId]
    );
    
    await connection.commit();
    
    res.json({
      success: true,
      message: 'Cart cleared successfully'
    });
    
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart
};
