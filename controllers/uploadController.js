const sharp = require('sharp');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const r2ReviewClient = require('../config/r2ReviewClient');
const crypto = require('crypto'); // Built-in for unique IDs

exports.uploadReviewImages = async (req, res) => {
    try {
        const { productId, orderId } = req.body;
        const files = req.files;

        // 1. Basic Validation
        if (!files || files.length === 0) {
            return res.status(400).json({ message: "No images provided" });
        }
        if (!productId || !orderId) {
            return res.status(400).json({ message: "Product ID and Order ID are required" });
        }

        console.log(`📸 [UPLOAD] Processing ${files.length} images for Order: ${orderId}`);

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // e.g., 2026-07-16
        
        // 2. Map and Process Files in Parallel
        const uploadPromises = files.map(async (file, index) => {
            
            // A. Unique Suffix (Taake filename kabhi takraye na)
            const uniqueId = crypto.randomBytes(4).toString('hex');
            const imageNumber = index + 1; 

            // B. ⚡ SHARP ENGINE: Optimization & Auto-Rotate
            const optimizedBuffer = await sharp(file.buffer)
                .rotate() // 🚨 Mobile images ko auto-straight karta hai
                .resize({ 
                    width: 720, 
                    height: 720, 
                    fit: 'inside', // Aspect ratio kharab nahi karega
                    withoutEnlargement: true 
                })
                .webp({ quality: 80, effort: 2 }) // Quality/Size ka balance
                .toBuffer();

            // C. Path Construction
            // Pattern: review-uploads/2026-07-16/order-ID/prod-ID-img-1-uuid.webp
            const fileName = `review-uploads/${dateStr}/order-${orderId}/${productId}-img-${imageNumber}-${uniqueId}.webp`;

            // D. Upload to Cloudflare R2
            await r2ReviewClient.send(new PutObjectCommand({
                Bucket: process.env.R2_REVIEW_BUCKET_NAME,
                Key: fileName,
                Body: optimizedBuffer,
                ContentType: 'image/webp',
                CacheControl: 'public, max-age=31536000, immutable' 
            }));

            // E. Public URL
            return `${process.env.R2_REVIEW_PUBLIC_URL}/${fileName}`;
        });

        // 3. Execute all uploads together
        const urls = await Promise.all(uploadPromises);

        console.log(`✅ [UPLOAD] Successfully moved ${urls.length} images to R2`);

        res.status(200).json({ 
            success: true,
            message: "Images processed and saved.", 
            urls: urls 
        });

    } catch (error) {
        console.error("🔴 [Upload Controller] Critical Error:", error.message);
        res.status(500).json({ success: false, message: "Server was unable to process images." });
    }
};