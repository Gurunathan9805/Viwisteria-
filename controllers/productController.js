const pool = require('../config/db');
const { cloudinary } = require('../config/cloudinary');

// @desc    Get all products
// @route   GET /api/products
// @access  Private/Admin
const getProducts = async (req, res, next) => {
  try {
    console.log('Fetching all products...');
    
    // Fetch all products from the database
    const [products] = await pool.query(`
      SELECT 
        id,
        name,
        category,
        description,
        price,
        stock,
        key_features,
        image_url,
        created_at,
        updated_at
      FROM products 
      ORDER BY created_at DESC
    `);

    // Process the products data
    const formattedProducts = products.map(product => {
      // Parse key_features if it's a string
      let keyFeatures = [];
      try {
        keyFeatures = product.key_features ? 
          (typeof product.key_features === 'string' ? 
            JSON.parse(product.key_features) : 
            product.key_features) : 
          [];
      } catch (e) {
        console.error(`Error parsing key_features for product ${product.id}:`, e);
        keyFeatures = [];
      }

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        description: product.description || '',
        price: parseFloat(product.price) || 0,
        stock: parseInt(product.stock) || 0,
        keyFeatures,
        imageUrl: product.image_url || null,
        createdAt: product.created_at,
        updatedAt: product.updated_at
      };
    });

    console.log(`Successfully fetched ${formattedProducts.length} products`);
    res.status(200).json({
      success: true,
      count: formattedProducts.length,
      data: formattedProducts
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    next(error);
  }
};

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = async (req, res, next) => {
  try {
    const { name, description, price, stock, keyFeatures, category } = req.body;

    if (!name || !price || stock === undefined || !category) {
      return res.status(400).json({ message: 'Please provide all required fields: name, price, stock, and category' });
    }

    let imageUrl = '';
    
    // Handle image upload to Cloudinary if file exists
    if (req.file) {
      try {
        const fileBuffer = req.file.buffer;
        if (!fileBuffer || fileBuffer.length === 0) {
          throw new Error('Empty file');
        }

        // Convert buffer to base64
        const base64String = fileBuffer.toString('base64');
        const dataUri = `data:${req.file.mimetype};base64,${base64String}`;

        // Upload to Cloudinary using the v2 uploader
        const result = await cloudinary.uploader.upload(dataUri, {
          folder: 'chocolate_shop',
          resource_type: 'auto'
        });
        
        console.log('Cloudinary upload result:', result); // Debug log
        imageUrl = result.secure_url;
      } catch (error) {
        console.error('Error uploading image to Cloudinary:', error);
        return res.status(500).json({ message: 'Error uploading image' });
      }
    }

    // Parse keyFeatures if it's a string, otherwise use as is
    let keyFeaturesData = [];
    try {
      keyFeaturesData = typeof keyFeatures === 'string' ? JSON.parse(keyFeatures) : (keyFeatures || []);
    } catch (e) {
      console.error('Error parsing keyFeatures:', e);
      keyFeaturesData = [];
    }

    console.log('Inserting product with image URL:', imageUrl); // Debug log
    
    const [result] = await pool.query(
      'INSERT INTO products (name, category, description, price, stock, key_features, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, category, description, parseFloat(price), parseInt(stock), JSON.stringify(keyFeaturesData), imageUrl]
    );

    console.log('Insert result:', result); // Debug log

    const [newProduct] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
    console.log('Retrieved product after insert:', newProduct[0]); // Debug log
    
    // Safely parse key_features if it exists and is a string
    if (newProduct[0] && newProduct[0].key_features) {
      try {
        newProduct[0].key_features = typeof newProduct[0].key_features === 'string' 
          ? JSON.parse(newProduct[0].key_features) 
          : newProduct[0].key_features;
      } catch (e) {
        console.error('Error parsing key_features:', e);
        // If parsing fails, set to empty array
        newProduct[0].key_features = [];
      }
    } else {
      // If key_features doesn't exist, set to empty array
      newProduct[0].key_features = [];
    }
    
    res.status(201).json({
      message: 'Product created successfully',
      product: newProduct[0]
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = async (req, res, next) => {
  try {
    const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);

    if (product.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Handle file upload if present
    let imageUrl = product[0].image_url;
    if (req.file) {
      try {
        // Convert buffer to base64 for Cloudinary
        const base64String = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        const result = await cloudinary.uploader.upload(base64String, {
          folder: 'chocolate_shop',
          format: 'webp',
          quality: 'auto',
          fetch_format: 'auto'
        });
        imageUrl = result.secure_url;
      } catch (uploadError) {
        console.error('Error uploading image to Cloudinary:', uploadError);
        return res.status(500).json({ message: 'Error uploading image' });
      }
    }

    // Parse keyFeatures if it's a string, otherwise use as is or default to empty array
    let keyFeaturesData = [];
    try {
      // Check if keyFeatures is in the request body or use existing value
      const keyFeaturesFromRequest = req.body.keyFeatures || product[0].key_features;
      
      if (keyFeaturesFromRequest) {
        keyFeaturesData = typeof keyFeaturesFromRequest === 'string' 
          ? JSON.parse(keyFeaturesFromRequest)
          : keyFeaturesFromRequest;
      }
      
      // Ensure it's an array
      if (!Array.isArray(keyFeaturesData)) {
        keyFeaturesData = [];
      }
    } catch (e) {
      console.error('Error parsing keyFeatures:', e);
      keyFeaturesData = [];
    }

    // Prepare updated fields
    const updatedFields = {
      name: req.body.name || product[0].name,
      category: req.body.category || product[0].category,
      description: req.body.description || product[0].description || '',
      price: req.body.price ? parseFloat(req.body.price) : product[0].price,
      stock: req.body.stock ? parseInt(req.body.stock) : product[0].stock,
      key_features: JSON.stringify(keyFeaturesData),
      image_url: imageUrl
    };

    await pool.query(
      'UPDATE products SET name = ?, category = ?, description = ?, price = ?, stock = ?, key_features = ?, image_url = ? WHERE id = ?',
      [
        updatedFields.name,
        updatedFields.category,
        updatedFields.description, 
        updatedFields.price, 
        updatedFields.stock, 
        updatedFields.key_features,
        updatedFields.image_url,
        req.params.id
      ]
    );

    const [updatedProduct] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    
    // Safely parse the key_features JSON string back to an array
    let parsedKeyFeatures = [];
    try {
      if (updatedProduct[0].key_features) {
        // If it's already an array, use it as is
        if (Array.isArray(updatedProduct[0].key_features)) {
          parsedKeyFeatures = updatedProduct[0].key_features;
        } 
        // If it's a string, try to parse it
        else if (typeof updatedProduct[0].key_features === 'string') {
          parsedKeyFeatures = JSON.parse(updatedProduct[0].key_features);
          // Ensure it's an array after parsing
          if (!Array.isArray(parsedKeyFeatures)) {
            console.warn('key_features is not an array after parsing, defaulting to empty array');
            parsedKeyFeatures = [];
          }
        }
      }
    } catch (e) {
      console.error('Error parsing key_features:', e);
      parsedKeyFeatures = [];
    }

    const productWithFeatures = {
      ...updatedProduct[0],
      key_features: parsedKeyFeatures
    };
    
    res.json(productWithFeatures);
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = async (req, res, next) => {
  try {
    const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);

    if (product.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.json({ message: 'Product removed' });
  } catch (error) {
    next(error);
  }
};

// @desc    Get product by ID
// @route   GET /api/products/:id
// @access  Private/Admin
const getProductById = async (req, res, next) => {
  try {
    const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);

    if (product.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Parse the key_features JSON string back to an array
    const productWithFeatures = {
      ...product[0],
      key_features: JSON.parse(product[0].key_features || '[]')
    };
    res.json(productWithFeatures);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById
};
