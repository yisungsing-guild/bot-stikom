#!/usr/bin/env node
// Cloudinary onboarding script (single-file)
// Inline credentials are required by the onboarding flow below.

const cloudinary = require('cloudinary').v2;

// === Cloudinary credentials from environment ===
const cloudinaryConfig = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
};

if (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key && cloudinaryConfig.api_secret) {
  cloudinary.config(cloudinaryConfig);
}

async function main() {
  try {
    console.log('1) Uploading sample image from Cloudinary demo domain...');
    const sampleUrl = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

    const uploadResult = await cloudinary.uploader.upload(sampleUrl, {
      folder: 'onboarding_test',
      use_filename: true,
      unique_filename: true
    });

    console.log('\n--- Upload Result ---');
    console.log('secure_url:', uploadResult.secure_url);
    console.log('public_id:', uploadResult.public_id);

    console.log('\n2) Fetching image details (metadata)...');
    const resource = await cloudinary.api.resource(uploadResult.public_id);
    console.log('width:', resource.width);
    console.log('height:', resource.height);
    console.log('format:', resource.format);
    console.log('bytes:', resource.bytes);

    console.log('\n3) Generating transformed URL (f_auto + q_auto)...');
    // f_auto (fetch_format: 'auto') tells Cloudinary to deliver the image
    // in the most efficient format supported by the client's browser (webp/avif/etc.).
    // q_auto (quality: 'auto') tells Cloudinary to automatically select an
    // optimal visual quality level to reduce file size.
    const transformedUrl = cloudinary.url(uploadResult.public_id, {
      secure: true,
      fetch_format: 'auto',
      quality: 'auto'
    });

    console.log('Transformed URL:', transformedUrl);

    console.log('\nDone! Click the transformed URL to inspect format and file size.');
  } catch (err) {
    console.error('ERROR during Cloudinary onboarding script:');
    console.error(err);
    process.exit(1);
  }
}

main();
