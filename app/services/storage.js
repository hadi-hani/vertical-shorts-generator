'use strict';

/* Optional S3 / S3-compatible (MinIO) offload of finished outputs. Best-effort:
 * when configured, completed MP4/SRT/ASS are uploaded under
 * outputs/<userId>/<projectId>.* and the job URLs point at them (via
 * S3_PUBLIC_BASE_URL when set, else the object URL). On any failure the job
 * keeps its local URLs and the app continues normally. */

const config = require('../config');
const { log } = require('../lib/logger');

let s3 = null;

function isConfigured() {
  return Boolean(config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
}

function init() {
  if (!isConfigured()) return;
  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3 = new S3Client({
      region: config.S3_REGION || 'us-east-1',
      endpoint: config.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(config.S3_ENDPOINT),
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      },
    });
  } catch (err) {
    log('warn', 's3_init_failed', { message: err.message });
    s3 = null;
  }
  return s3;
}

function publicUrl(key) {
  if (config.S3_PUBLIC_BASE_URL) {
    return `${config.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  }
  const base = config.S3_ENDPOINT ? config.S3_ENDPOINT.replace(/\/$/, '') : `https://s3.${config.S3_REGION || 'us-east-1'}.amazonaws.com`;
  return `${base}/${config.S3_BUCKET}/${key}`;
}

async function uploadOutputs(projectId, userId, files) {
  if (!s3) return null;
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { readFileSync } = require('fs');
  const results = {};
  for (const [ext, localPath] of Object.entries(files)) {
    const key = `outputs/${userId}/${projectId}${ext}`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: readFileSync(localPath),
          ContentType:
            ext === '.mp4' ? 'video/mp4' : ext === '.srt' ? 'application/x-subrip' : 'text/plain; charset=utf-8',
        })
      );
      results[ext] = publicUrl(key);
    } catch (err) {
      log('warn', 's3_upload_failed', { projectId, key, message: err.message });
    }
  }
  return results;
}

async function removeOutputs(projectId, userId) {
  if (!s3) return;
  const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
  const keys = ['.mp4', '.srt', '.ass'].map(
    (ext) => `outputs/${userId}/${projectId}${ext}`
  );
  try {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: config.S3_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      })
    );
  } catch (err) {
    log('warn', 's3_delete_failed', { projectId, message: err.message });
  }
}

module.exports = { init, isConfigured, uploadOutputs, removeOutputs };