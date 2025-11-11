const express = require("express"); // If using "type": "module"
const app = express();
const cookieParser = require("cookie-parser");
require("dotenv").config();
const cors = require("cors");
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Configure CORS
const allowedOrigins = ['http://localhost:5173', 'http://localhost:3000'];
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(cookieParser());

// Import routes
const authRoutes = require("./routes/authRoute");
const productRoutes = require("./routes/productRoutes");
const orderRoutes = require("./routes/orderRoutes");
const cartRoutes = require("./routes/cartRoutes");

// Routes
app.get("/", (req, res) => {
  res.send("Hello from Express backend ");
});

// Auth routes
app.use("/api/auth", authRoutes);

// Product routes (public GET, protected POST/PUT/DELETE)
app.use("/api/products", productRoutes);

// Order and transaction routes (protected)
app.use("/api/orders", orderRoutes);

// Cart routes (protected)
app.use("/api/cart", cartRoutes);

// Admin test route
app.get(
  "/api/admin",
  require("./middleware/auth").verifyToken,
  require("./middleware/auth").checkRole(["admin"]),
  (req, res) => {
    res.json({ message: "Admin access granted" });
  }
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : {},
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
