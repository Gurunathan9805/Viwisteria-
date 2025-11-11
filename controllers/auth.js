const { generateToken, generateRefreshToken } = require("../middleware/auth");
const pool = require("../config/db");
const bcrypt = require("bcrypt");

// --- Role Model Functions ---

/**
 * Create a new role in the database
 * @param {string} name - Name of the role (e.g., 'admin', 'user')
 * @returns {Promise<number>} The ID of the created role
 */
const createRole = async (name) => {
  try {
    const [result] = await pool.query(
      "INSERT INTO roles (name) VALUES (?)",
      [name]
    );
    return result.insertId;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new Error("Role already exists");
    }
    throw error;
  }
};

// --- User Model Functions ---

/**
 * Create a new role and user in a single transaction
 * @param {Object} roleData - Role data { name }
 * @param {Object} userData - User data { name, email, password }
 * @returns {Promise<Object>} Object containing roleId and userId
 */
const createRoleAndUser = async (roleData, userData) => {
  let connection;
  try {
    // Get a connection from the pool
    connection = await pool.getConnection();
    
    // Start transaction
    await connection.beginTransaction();

    try {
      // 1. Create role first
      const [roleResult] = await connection.query(
        "INSERT INTO roles (name) VALUES (?)",
        [roleData.name]
      );
      const roleId = roleResult.insertId;

      // 2. Then create user with the new role
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const [userResult] = await connection.query(
        "INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)",
        [userData.name, userData.email, hashedPassword, roleId]
      );

      // Commit the transaction
      await connection.commit();
      
      return {
        roleId,
        userId: userResult.insertId
      };
    } catch (error) {
      // Rollback the transaction if any error occurs
      await connection.rollback();
      throw error; // Re-throw the error to be caught by the outer catch
    }
  } finally {
    // Always release the connection back to the pool
    if (connection) {
      connection.release();
    }
  }
};


/**
 * Create a new user in the database.
 */
/**
 * Check if a role exists by ID
 */
const roleExists = async (roleId) => {
  try {
    const [rows] = await pool.query("SELECT id FROM roles WHERE id = ?", [roleId]);
    return rows.length > 0;
  } catch (error) {
    throw error;
  }
};

/**
 * Create a new user in the database.
 * @param {Object} userData - User data including name, email, password, and role_id
 * @throws {Error} If email already exists or role is invalid
 */
const createUser = async ({ name, email, password, role_id = 3 }) => {
  // Validate role exists
  const isValidRole = await roleExists(role_id);
  if (!isValidRole) {
    throw new Error("Invalid role specified");
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)",
      [name, email, hashedPassword, role_id]
    );
    return result.insertId;
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new Error("Email already exists");
    } else if (error.code === "ER_NO_REFERENCED_ROW_2") {
      throw new Error("Invalid role specified");
    }
    throw error;
  }
};

/**
 * Find a user by their email address.
 */
const findUserByEmail = async (email) => {
  try {
    const [rows] = await pool.query(
      "SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.email = ?",
      [email]
    );
    return rows[0];
  } catch (error) {
    throw error;
  }
};

/**
 * Find a user by their ID.
 */
const findUserById = async (id) => {
  try {
    const [rows] = await pool.query(
      "SELECT u.*, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?",
      [id]
    );
    return rows[0];
  } catch (error) {
    throw error;
  }
};

/**
 * Verify a user's password.
 */
const verifyPassword = async (user, password) => {
  return await bcrypt.compare(password, user.password);
};

// --- Authentication Controller Functions ---

/**
 * Register a new user.
 */
const register = async (req, res) => {
  try {
    const { name, email, password, confirmPassword, isAdmin } = req.body;

    // Validate input
    if (!name || !email || !password || !confirmPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    let newUser;
    
    // If this is an admin registration, create role and user in a transaction
    if (isAdmin) {
      const result = await createRoleAndUser(
        { name: 'admin' },
        { name, email, password }
      );
      newUser = await findUserById(result.userId);
    } else {
      // Regular user registration with default role (2 = user)
      const userId = await createUser({
        name,
        email,
        password,
      });
      newUser = await findUserById(userId);
    }

    // Generate tokens
    const token = generateToken(newUser);
    const refreshToken = generateRefreshToken(newUser);

    // Store refresh token in database
    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [newUser.id, refreshToken]
    );

    // Remove sensitive data before sending response
    delete newUser.password;

    res.status(201).json({
      message: "User registered successfully",
      user: newUser,
      token,
      refreshToken,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      message: error.message || "Error registering user",
    });
  }
};

/**
 * User login.
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Find user by email
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Verify password
    const isPasswordValid = await verifyPassword(user, password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate tokens
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // Store refresh token in database
    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))",
      [user.id, refreshToken]
    );

    // Remove sensitive data before sending response
    delete user.password;

    res.json({
      message: "Login successful",
      user,
      token,
      refreshToken,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Error during login",
    });
  }
};

// --- Token Controller Functions ---

/**
 * Refresh access token.
 */
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    // Find the refresh token in database
    const [tokens] = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()",
      [refreshToken]
    );

    if (!tokens.length) {
      return res
        .status(403)
        .json({ message: "Invalid or expired refresh token" });
    }

    const token = tokens[0];

    // Get user data
    const user = await findUserById(token.user_id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate new access token
    const newAccessToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    // Update refresh token in database
    await pool.query(
      "UPDATE refresh_tokens SET token = ?, expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id = ?",
      [newRefreshToken, token.id]
    );

    res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({
      message: "Error refreshing token",
    });
  }
};

/**
 * Logout (revoke refresh token).
 */
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await pool.query("DELETE FROM refresh_tokens WHERE token = ?", [
        refreshToken,
      ]);
    }

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      message: "Error during logout",
    });
  }
};

// --- User Profile Controller Functions ---

/**
 * Get current user profile.
 */
const getProfile = async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Remove sensitive data before sending response
    delete user.password;

    res.json(user);
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      message: "Error fetching user profile",
    });
  }
};

/**
 * Update user profile.
 */
const updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    const userId = req.user.id;

    // Update user in database
    await pool.query("UPDATE users SET name = ?, email = ? WHERE id = ?", [
      name,
      email,
      userId,
    ]);

    // Get updated user data
    const updatedUser = await findUserById(userId);
    delete updatedUser.password;

    res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      message: "Error updating profile",
    });
  }
};

// --- Role Controller Functions ---

/**
 * Middleware to check if user has the required role.
 */
const checkRole = (role) => {
  return async (req, res, next) => {
    try {
      const user = await findUserById(req.user.id);
      const [roleData] = await pool.query(
        "SELECT name FROM roles WHERE id = ?",
        [user.role_id]
      );

      if (!roleData.length || roleData[0].name !== role) {
        return res.status(403).json({ message: "Access denied" });
      }

      next();
    } catch (error) {
      console.error("Role check error:", error);
      return res.status(500).json({ message: "Error checking user role" });
    }
  };
};

/**
 * Get all roles (admin only).
 */
const getRoles = async (req, res) => {
  try {
    const [roles] = await pool.query("SELECT * FROM roles");
    res.json(roles);
  } catch (error) {
    console.error("Get roles error:", error);
    res.status(500).json({ message: "Error fetching roles" });
  }
};

// --- Export All Functions ---

module.exports = {
  createUser,
  findUserByEmail,
  findUserById,
  verifyPassword,
  register,
  login,
  refreshToken,
  logout,
  getProfile,
  updateProfile,
  checkRole,
  getRoles,
};
