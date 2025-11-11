const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const requiredEnvVars = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_UPLOAD_FOLDER",
  "CLOUDINARY_ALLOWED_FORMATS",
  "CLOUDINARY_MAX_FILE_SIZE",
];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingVars.join(", ")}`
  );
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const allowedFormats = process.env.CLOUDINARY_ALLOWED_FORMATS.split(",").map(
  (f) => f.trim()
);

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: process.env.CLOUDINARY_UPLOAD_FOLDER,
    allowed_formats: allowedFormats,
    transformation: [
      { width: 800, height: 800, crop: "limit", quality: "auto" },
    ],
  },
});

// Create multer upload instance with memory storage
const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: parseInt(process.env.CLOUDINARY_MAX_FILE_SIZE) * 1024 * 1024, // Convert MB to bytes
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const fileType = file.mimetype.split("/")[0];
    if (fileType !== "image") {
      return cb(
        new Error(`Only image files are allowed! Received: ${file.mimetype}`),
        false
      );
    }

    const fileExt = path.extname(file.originalname).toLowerCase().substring(1);
    if (!allowedFormats.includes(fileExt)) {
      return cb(
        new Error(
          `Invalid file type. Allowed types: ${allowedFormats.join(
            ", "
          )}. Received: ${fileExt}`
        ),
        false
      );
    }

    cb(null, true);
  },
}).single("image");

// Middleware to handle file upload
const uploadImage = (req, res, next) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
};

module.exports = { cloudinary, uploadImage };
