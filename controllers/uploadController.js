// api/controllers/uploadController.js
const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const r2ReviewClient = require('../config/r2ReviewClient'); // Reusing your existing R2 client

exports.uploadReviewImages = async (req, res) => {
    try {
        // 1. Get Data from Body
        const { productId, orderId } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ message: "No images provided" });
        }
        if (!productId || !orderId) {
            return res.status(400).json({ message: "Product ID and Order ID are required" });
        }

        const uploadedUrls = [];
        const now = new Date();
        
        // Generate Time Strings for URL
        const dateStr = now.toISOString().split('T')[0]; // 2026-01-15
        // Format time as HH-MM-SS
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); 

        // 2. Loop through files (Max 3)
        // We use map to process them in parallel for speed
        const uploadPromises = files.map(async (file, index) => {
            
            // A. Compress & Convert to WebP (720p Width)
            const optimizedBuffer = await sharp(file.buffer)
                .resize({ width: 720, withoutEnlargement: true }) // Resize to 720p, don't stretch small images
                .webp({ quality: 75 }) // Reduce quality slightly for storage savings (hardly visible)
                .toBuffer();

            // B. Construct Unique Key
            // Pattern: r2/products/{PROD}/order/{ORD}/image/{1,2,3}/{DATE}/{TIME}.webp
            const imageNumber = index + 1; 
            const fileName = `r2/products/${productId}/order/${orderId}/image/${imageNumber}/${dateStr}/${timeStr}.webp`;

            // C. Upload to R2
            await r2ReviewClient.send(new PutObjectCommand({
                Bucket: process.env.R2_REVIEW_BUCKET_NAME,
                Key: fileName,
                Body: optimizedBuffer,
                ContentType: 'image/webp',
                // Optional: Cache control for browser (1 year) since URL is unique
                CacheControl: 'public, max-age=31536000, immutable' 
            }));

            // D. Generate Public URL
            // Ensure R2_REVIEW_PUBLIC_URL in .env does NOT have a trailing slash
            const publicUrl = `${process.env.R2_REVIEW_PUBLIC_URL}/${fileName}`;
            return publicUrl;
        });

        // Wait for all uploads to finish
        const results = await Promise.all(uploadPromises);

        // 3. Return URLs to Frontend
        res.status(200).json({ 
            message: "Images uploaded and optimized", 
            urls: results 
        });

    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ message: "Image upload failed" });
    }
};