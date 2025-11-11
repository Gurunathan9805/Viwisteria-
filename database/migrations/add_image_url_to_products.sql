-- Add image_url column to products table
ALTER TABLE products
ADD COLUMN image_url VARCHAR(255) NULL DEFAULT NULL AFTER key_features;