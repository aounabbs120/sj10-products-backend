// api/config/r2ReviewClient.js
const { S3Client } = require('@aws-sdk/client-s3');
require('dotenv').config();

const r2ReviewClient = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_REVIEW_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_REVIEW_ACCESS_KEY,
        secretAccessKey: process.env.R2_REVIEW_SECRET_KEY,
    },
});

module.exports = r2ReviewClient;