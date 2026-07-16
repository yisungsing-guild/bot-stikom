#!/usr/bin/env node
// Upload video to Cloudinary then transcribe with OpenAI (single-file)
// Inline credentials: Cloudinary + OPENAI_API_KEY

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const { OpenAI } = require('openai');

// === Cloudinary and OpenAI credentials from environment ===
const cloudinaryConfig = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_CLOUD || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
};

if (cloudinaryConfig.cloud_name && cloudinaryConfig.api_key && cloudinaryConfig.api_secret) {
  cloudinary.config(cloudinaryConfig);
}

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

async function downloadToFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const res = await axios({ method: 'get', url, responseType: 'stream' });
  return new Promise((resolve, reject) => {
    res.data.pipe(writer);
    let error = null;
    writer.on('error', (err) => {
      error = err;
      writer.close();
      reject(err);
    });
    writer.on('close', () => {
      if (!error) resolve(destPath);
    });
  });
}

async function main() {
  try {
    const arg = process.argv[2];
    const source = arg && arg.trim().length ? arg.trim() : 'https://res.cloudinary.com/demo/video/upload/sample.mp4';
    console.log('Source (local path or URL):', source);

    console.log('\n1) Preparing video for upload to Cloudinary...');
    // If source is URL, download to temp file first to avoid Cloudinary remote-fetch errors
    const isUrl = /^https?:\/\//i.test(source);
    let localPathForUpload = source;
    let downloadedTmp = null;
    if (isUrl) {
      const tmpDir = os.tmpdir();
      const ext = path.extname(source.split('?')[0]) || '.mp4';
      const tmpPath = path.join(tmpDir, `cloud_upload_${Date.now()}${ext}`);
      console.log('Downloading remote URL to temporary file before upload...');
      try {
        await downloadToFile(source, tmpPath);
        console.log('Downloaded remote to:', tmpPath);
        localPathForUpload = tmpPath;
        downloadedTmp = tmpPath;
      } catch (dlErr) {
        console.warn('Primary download failed:', dlErr && dlErr.message ? dlErr.message : String(dlErr));
        // Try fallback public URLs
        const fallbacks = [
          'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          'https://file-examples.com/wp-content/uploads/2018/04/file_example_MP4_480_1_5MG.mp4'
        ];
        let got = false;
        for (const fb of fallbacks) {
          const fbTmp = path.join(tmpDir, `cloud_upload_fallback_${Date.now()}${path.extname(fb.split('?')[0]) || '.mp4'}`);
          try {
            console.log('Trying fallback URL:', fb);
            await downloadToFile(fb, fbTmp);
            console.log('Downloaded fallback to:', fbTmp);
            localPathForUpload = fbTmp;
            downloadedTmp = fbTmp;
            got = true;
            break;
          } catch (e) {
            console.warn('Fallback download failed:', e && e.message ? e.message : String(e));
          }
        }
        if (!got) throw new Error('All remote download attempts failed');
      }
    }

    let uploadResult;
    try {
      const stat = fs.existsSync(localPathForUpload) ? fs.statSync(localPathForUpload) : null;
      const fileSize = stat && stat.size ? stat.size : 0;
      const MB = 1024 * 1024;
      // If file is large, use chunked upload (upload_large). Adjust threshold as needed.
      if (fileSize > 50 * MB) {
        console.log('File is large (', Math.round(fileSize / MB), 'MB) — using upload_stream and piping file...');
        // Use upload_stream to pipe the file stream into Cloudinary (works for large files)
        uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream({
            resource_type: 'video',
            folder: 'onboarding_videos',
            use_filename: true,
            unique_filename: true
          }, function(error, result) {
            if (error) return reject(error);
            resolve(result);
          });
          const readStream = fs.createReadStream(localPathForUpload);
          readStream.on('error', (e) => reject(e));
          readStream.pipe(stream);
        });
      } else {
        uploadResult = await cloudinary.uploader.upload(localPathForUpload, {
          resource_type: 'video',
          folder: 'onboarding_videos',
          use_filename: true,
          unique_filename: true
        });
      }
    } catch (err) {
      // fallback: try a public sample MP4 if demo resource not found and no explicit arg
      if (!arg && isUrl) {
        const fallback = 'https://file-examples.com/wp-content/uploads/2018/04/file_example_MP4_480_1_5MG.mp4';
        console.warn('Primary demo video download/upload failed; retrying with fallback sample:', fallback);
        const tmpDir = os.tmpdir();
        const tmpPath = path.join(tmpDir, `cloud_upload_fallback_${Date.now()}.mp4`);
        await downloadToFile(fallback, tmpPath);
        uploadResult = await cloudinary.uploader.upload(tmpPath, {
          resource_type: 'video',
          folder: 'onboarding_videos',
          use_filename: true,
          unique_filename: true
        });
        // cleanup fallback tmp
        try { fs.unlinkSync(tmpPath); } catch (e) {}
      } else {
        // cleanup any downloaded tmp before rethrow
        if (downloadedTmp) try { fs.unlinkSync(downloadedTmp); } catch (e) {}
        throw err;
      }
    }

    console.log('\n--- Upload Result ---');
    console.log('raw upload result:', uploadResult);
    // Some accounts or SDK methods may return limited fields; fallback to querying resources
    if (!uploadResult || !uploadResult.secure_url) {
      console.warn('Upload response did not include secure_url; querying Cloudinary for recent resource in folder onboarding_videos...');
      try {
        const list = await cloudinary.api.resources({
          resource_type: 'video',
          type: 'upload',
          prefix: 'onboarding_videos',
          max_results: 10
        });
        if (list && Array.isArray(list.resources) && list.resources.length > 0) {
          // pick the most recent by uploaded_at
          list.resources.sort((a, b) => new Date(b.created_at || b.uploaded_at || 0) - new Date(a.created_at || a.uploaded_at || 0));
          const res = list.resources[0];
          uploadResult = uploadResult || {};
          uploadResult.secure_url = res.secure_url || res.url || null;
          uploadResult.public_id = res.public_id || null;
          uploadResult.resource_type = res.resource_type || 'video';
          console.log('Found resource via API:', uploadResult.public_id, uploadResult.secure_url);
        } else {
          console.warn('No resources found in folder onboarding_videos');
        }
      } catch (qErr) {
        console.warn('Resource query failed:', qErr && qErr.message ? qErr.message : String(qErr));
      }
    } else {
      console.log('secure_url:', uploadResult.secure_url);
      console.log('public_id:', uploadResult.public_id);
      console.log('resource_type:', uploadResult.resource_type);
    }

    console.log('\n2) Downloading uploaded video to temporary file for transcription...');
    const tmpDir2 = os.tmpdir();
    const tmpPath = path.join(tmpDir2, `cloud_vid_${Date.now()}.mp4`);
    await downloadToFile(uploadResult.secure_url, tmpPath);
    console.log('Downloaded to:', tmpPath);

    console.log('\n3) Sending file to OpenAI for transcription (whisper-1)...');
    const fileStream = fs.createReadStream(tmpPath);
    const resp = await client.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      language: 'id'
    });

    const transcript = resp && typeof resp.text === 'string' ? resp.text.trim() : '';
    console.log('\n--- Transcription Result ---');
    console.log(transcript || '(no text returned)');

    console.log('\n4) Done. Cleanup temporary file.');
    try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    // also cleanup downloadedTmp if we downloaded before upload
    try { if (typeof downloadedTmp === 'string' && downloadedTmp && fs.existsSync(downloadedTmp)) fs.unlinkSync(downloadedTmp); } catch (e) {}
    console.log('\nSummary:');
    console.log('- Uploaded video URL:', uploadResult.secure_url);
    console.log('- Public ID:', uploadResult.public_id);
    console.log('- Transcript length (chars):', transcript.length);

    // Optionally print short excerpt
    if (transcript.length > 0) console.log('\nTranscript excerpt:\n', transcript.slice(0, 800));

  } catch (err) {
    console.error('ERROR in upload+transcribe script:');
    console.error(err);
    process.exit(1);
  }
}

main();
