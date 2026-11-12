const fs = require('fs');
const path = require('path');
const ftp = require('basic-ftp');

const FTP_CONFIG = {
  host: 'upc.geekclub.ir',
  user: 'new@upc.geekclub.ir',
  password: '1z{Tf_@LAZg}#l0[',
  port: 21,
  secure: false
};

const TTL_MS = 12 * 60 * 60 * 1000; // ۱۲ ساعت

function cleanupExpiredFiles(baseDir) {
  if (!fs.existsSync(baseDir)) return;
  const now = Date.now();
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const ent of entries) {
      const fullPath = path.join(baseDir, ent.name);
      if (ent.isDirectory()) {
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > TTL_MS) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }
      }
    }
  } catch (e) {}
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const targetUrl = req.query.url;
  const apifyToken = req.query.apify_token || process.env.APIFY_TOKEN;

  if (req.query.check_cleanup === '1') {
    const tmpBase = '/tmp/instagram_cache';
    cleanupExpiredFiles(tmpBase);
    return res.status(200).json({ status: 'ok', ttl_policy: { hours: 12 } });
  }

  if (!targetUrl) {
    return res.status(400).json({ error: 'آدرس URL مشخص نشده است.' });
  }

  const isInsta = targetUrl.match(/(?:\/p\/|\/reel\/|\/reels\/|\/tv\/)([A-Za-z0-9_-]+)/);
  const shortcode = isInsta ? isInsta[1] : 'custom_' + Math.random().toString(36).substring(2, 9);

  const localDir = path.join('/tmp', 'instagram_cache', shortcode);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  cleanupExpiredFiles('/tmp/instagram_cache');

  let mediaUrl = '';
  let captionText = '';
  let extractionMethod = 'local_curl_engine';

  // ۱. استفاده از Apify در صورت وجود توکن
  if (apifyToken) {
    try {
      const apifyApiUrl = `https://api.apify.com/v2/acts/apify~instagram-reel-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}`;
      const apifyResp = await fetch(apifyApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directUrls: [targetUrl], resultsLimit: 1 })
      });
      if (apifyResp.ok) {
        const apifyItems = await apifyResp.json();
        if (Array.isArray(apifyItems) && apifyItems.length > 0) {
          const item = apifyItems[0];
          mediaUrl = item.videoUrl || item.displayUrl || '';
          captionText = item.caption || '';
          if (mediaUrl) extractionMethod = 'apify_api';
        }
      }
    } catch (e) {}
  }

  // ۲. استخراج با cURL پیشرفته در صورت عدم استفاده از Apify
  if (!mediaUrl) {
    try {
      const execSync = require('child_process').execSync;
      const cleanUrl = targetUrl.split('?')[0].replace(/\/$/, '') + '/embed/';
      const curlCmd = `curl -s -L -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" -H "Accept-Language: en-US,en;q=0.9" -H "Sec-Fetch-Dest: document" "${cleanUrl}"`;
      const html = execSync(curlCmd, { timeout: 15000 }).toString();

      const vidMatch = html.match(/video_url(?:\\*)"\s*:\s*(?:\\*)"(https:[^"]+?)"/);
      if (vidMatch) {
        mediaUrl = vidMatch[1].replace(/\\/g, '').replace(/&amp;/g, '&');
      } else {
        const imgMatch = html.match(/display_url(?:\\*)"\s*:\s*(?:\\*)"(https:[^"]+?)"/);
        if (imgMatch) {
          mediaUrl = imgMatch[1].replace(/\\/g, '').replace(/&amp;/g, '&');
        }
      }
    } catch (e) {}
  }

  if (!mediaUrl) {
    return res.status(404).json({ 
      error: 'محتوای اینستاگرام توسط اینستاگرام مسدود شده است. لطفاً توکن Apify API را وارد فرمایید یا پست دیگری را تست کنید.' 
    });
  }

  // ۳. دانلود فیزیکی در /tmp
  const isVideo = !mediaUrl.includes('.jpg') && !mediaUrl.includes('.jpeg') && !mediaUrl.includes('.webp');
  const ext = isVideo ? 'mp4' : 'jpg';
  const localFilePath = path.join(localDir, `slide_1.${ext}`);

  try {
    const execSync = require('child_process').execSync;
    execSync(`curl -s -L -o "${localFilePath}" "${mediaUrl}"`, { timeout: 20000 });
  } catch (e) {}

  const fileSizeBytes = fs.existsSync(localFilePath) ? fs.statSync(localFilePath).size : 0;

  // ۴. آپلود FTP به CDN
  const ftpReport = [];
  let cdnPublicUrl = `https://upc.geekclub.ir/forum/instagram_downloader/${shortcode}/slide_1.${ext}`;

  if (fileSizeBytes > 0) {
    const client = new ftp.Client(20000);
    try {
      await client.access(FTP_CONFIG);
      const remoteDir = `/forum/instagram_downloader/${shortcode}`;
      await client.ensureDir(remoteDir);
      await client.uploadFrom(localFilePath, `slide_1.${ext}`);
      ftpReport.push({ status: 'uploaded', remote_dir: remoteDir });
    } catch (err) {
      ftpReport.push({ status: 'failed', error: err.message });
    } finally {
      client.close();
    }
  }

  return res.status(200).json({
    shortcode: shortcode,
    caption: captionText,
    extraction_method: extractionMethod,
    slides: [
      {
        index: 1,
        type: isVideo ? 'video' : 'image',
        size_bytes: fileSizeBytes,
        fallback_url: mediaUrl,
        cdn_url: cdnPublicUrl
      }
    ],
    ftp_report: ftpReport
  });
};
