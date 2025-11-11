const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const JWT_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRY = '7d';

// Generate JWT token
const generateToken = (user) => {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role_id },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
};

// Generate refresh token
const generateRefreshToken = (user) => {
    return jwt.sign(
        { id: user.id },
        JWT_SECRET + user.password,
        { expiresIn: REFRESH_TOKEN_EXPIRY }
    );
};

// Verify JWT token
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
        
        if (!user.length) {
            return res.status(401).json({ message: 'User not found' });
        }

        req.user = user[0];
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// Check user role
const checkRole = (roles) => {
    return async (req, res, next) => {
        try {
            const [role] = await pool.query('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
            
            if (!role.length || !roles.includes(role[0].name)) {
                return res.status(403).json({ message: 'Access denied' });
            }
            
            next();
        } catch (error) {
            console.error('Role check error:', error);
            return res.status(500).json({ message: 'Error checking user role' });
        }
    };
};

module.exports = {
    generateToken,
    generateRefreshToken,
    verifyToken,
    checkRole
};
