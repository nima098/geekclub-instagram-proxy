// ========================================================
// مسیر در پروژه ورسل: api/instagram-proxy.js
// نیازمند پکیج basic-ftp در ورسل (npm install basic-ftp)
// اجرا روی Node.js Serverless Function (Vercel)
// ========================================================

import fs from 'fs';
import path from 'path';
import { Client as FtpClient } from 'basic-ftp';

// دایرکتوری ذخیره‌سازی محلی در ورسل (پوشه موقت استاندارد لینوکسی سرورلس)
const TMP_STORAGE_DIR = path.join('/tmp', 'instagram_cache');
const TTL_HOURS = 12;
const TTL_MS = TTL_HOURS * 60 * 60 * 1000;

// پاکسازی فایل‌های قدیمی‌تر از ۱۲ ساعت در ورسل
function cleanupExpiredFiles() {
  try {
    if (!fs.existsSync(TMP_STORAGE_DIR)) return;
    const now = Date.now();
    const shortcodeFolders = fs.readdirSync(TMP_STORAGE_DIR);
    for (const folder of shortcodeFolders) {
      const folderPath = path.join(TMP_STORAGE_DIR, folder);
      const stat = fs.statSync(folderPath);
      if (now - stat.mtimeMs > TTL_MS) {
        fs.rmSync(folderPath, { recursive: true, force: true });
      }
    }
  } catch (err) {
    console.error('Error during 12h cleanup:', err.message);
  }
}

export default async function handler(req, res) {
  // فعال‌سازی CORS برای پذیرش درخواست از انجمن زنفورو
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // اجرای پاکسازی خودکار فایل‌های قدیمی‌تر از ۱۲ ساعت در ورسل
  cleanupExpiredFiles();

  // سرو مستقیم بایت‌های ذخیره‌شده از پوشه موقت ورسل در صورت نیاز
  const { serve_file, sc } = req.query;
  if (serve_file && sc) {
    const safeFile = path.basename(serve_file);
    const safeSc = path.basename(sc);
    const filePath = path.join(TMP_STORAGE_DIR, safeSc, safeFile);
    if (fs.existsSync(filePath)) {
      const mime = safeFile.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=43200'); // 12 hours
      return res.status(200).send(fs.readFileSync(filePath));
    }
    return res.status(404).send('File expired or not found');
  }

  const { url, offload_ftp } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'پارامتر url الزامی است.' });
  }

  try {
    // ۱. استخراج کد کوتاه (Shortcode) از لینک اینستاگرام
    const match = url.match(/(?:\/p\/|\/reel\/|\/reels\/|\/tv\/)([A-Za-z0-9_-]+)/);
    if (!match) {
      return res.status(400).json({ error: 'فرمت لینک اینستاگرام نامعتبر است.' });
    }
    const shortcode = match[1];

    // ۲. دریافت اطلاعات ساختاریافته از اینستاگرام (Embed Captioned)
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    let slides = [];
    let caption = '';

    if (response.ok) {
      const html = await response.text();
      const captionMatch = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
      if (captionMatch) {
        caption = captionMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      const videoMatches = [...html.matchAll(/class="EmbeddedMediaVideo"[^>]*src="([^"]+)"/gi)];
      const imgMatches = [...html.matchAll(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/gi)];

      if (videoMatches.length > 0) {
        videoMatches.forEach((m, idx) => {
          slides.push({
            index: idx + 1,
            type: 'video',
            raw_media_url: decodeHtml(m[1]),
            raw_thumb_url: imgMatches[idx] ? decodeHtml(imgMatches[idx][1]) : ''
          });
        });
      } else if (imgMatches.length > 0) {
        imgMatches.forEach((m, idx) => {
          slides.push({
            index: idx + 1,
            type: 'image',
            raw_media_url: decodeHtml(m[1]),
            raw_thumb_url: decodeHtml(m[1])
          });
        });
      }
    }

    if (slides.length === 0) {
      const oembedRes = await fetch(`https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}/`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (oembedRes.ok) {
        const odata = await oembedRes.json();
        caption = odata.title || '';
        slides.push({
          index: 1,
          type: 'image',
          raw_media_url: odata.thumbnail_url,
          raw_thumb_url: odata.thumbnail_url
        });
      }
    }

    if (slides.length === 0) {
      return res.status(404).json({ error: 'محتوای پست یا ریلز اینستاگرام یافت نشد یا خصوصی است.' });
    }

    // ۳. مرحله دانلود فیزیکی فایل‌ها درون استوریج موقت Vercel (/tmp)
    const localPostDir = path.join(TMP_STORAGE_DIR, shortcode);
    if (!fs.existsSync(localPostDir)) {
      fs.mkdirSync(localPostDir, { recursive: true });
    }

    const host = req.headers['x-forwarded-host'] || req.headers.host || 'geekclub-instagram-proxy.vercel.app';
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${proto}://${host}/api/instagram-proxy`;

    const downloadedSlides = [];
    for (const slide of slides) {
      const ext = (slide.type === 'video') ? 'mp4' : 'jpg';
      const fileName = `slide_${slide.index}.${ext}`;
      const localFilePath = path.join(localPostDir, fileName);

      // دانلود مدیا درون ورسل
      const mRes = await fetch(slide.raw_media_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (mRes.ok) {
        const buf = Buffer.from(await mRes.arrayBuffer());
        fs.writeFileSync(localFilePath, buf);
      }

      // دانلود کاور ویدیو درون ورسل
      let localThumbPath = '';
      if (slide.raw_thumb_url) {
        const thumbName = `thumb_${slide.index}.jpg`;
        localThumbPath = path.join(localPostDir, thumbName);
        const tRes = await fetch(slide.raw_thumb_url, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (tRes.ok) {
          fs.writeFileSync(localThumbPath, Buffer.from(await tRes.arrayBuffer()));
        }
      }

      downloadedSlides.push({
        index: slide.index,
        type: slide.type,
        file_name: fileName,
        local_file_path: localFilePath,
        local_thumb_path: localThumbPath,
        size_bytes: fs.existsSync(localFilePath) ? fs.statSync(localFilePath).size : 0,
        vercel_download_url: `${baseUrl}?serve_file=${fileName}&sc=${shortcode}`,
        vercel_thumb_url: localThumbPath ? `${baseUrl}?serve_file=thumb_${slide.index}.jpg&sc=${shortcode}` : ''
      });
    }

    // ۴. مرحله اتصال مستقیم به FTP هاست CDN و ارسال فایل‌های دانلودشده از ورسل به CDN
    let ftpUploadResults = [];
    const shouldFtpOffload = (offload_ftp === '1' || offload_ftp === 'true' || true);

    if (shouldFtpOffload) {
      const ftp = new FtpClient(30000); // 30s timeout
      try {
        await ftp.access({
          host: process.env.CDN_FTP_HOST || 'upc.geekclub.ir',
          user: process.env.CDN_FTP_USER || 'new@upc.geekclub.ir',
          password: process.env.CDN_FTP_PASSWORD || '1z{Tf_@LAZg}#l0[',
          port: parseInt(process.env.CDN_FTP_PORT || '21', 10),
          secure: false
        });

        for (const s of downloadedSlides) {
          if (!fs.existsSync(s.local_file_path)) continue;

          // مسیر مقصد در CDN
          const remoteDir = `/forum/instagram_downloader/${shortcode}`;
          await ftp.ensureDir(remoteDir);

          const remoteMediaPath = `${remoteDir}/${s.file_name}`;
          await ftp.uploadFrom(s.local_file_path, remoteMediaPath);

          if (s.local_thumb_path && fs.existsSync(s.local_thumb_path)) {
            await ftp.uploadFrom(s.local_thumb_path, `${remoteDir}/thumb_${s.index}.jpg`);
          }

          ftpUploadResults.push({
            file: s.file_name,
            status: 'uploaded',
            cdn_url: `https://upc.geekclub.ir/forum/instagram_downloader/${shortcode}/${s.file_name}`
          });
        }
      } catch (ftpErr) {
        ftpUploadResults.push({ error: 'FTP Offload Error: ' + ftpErr.message });
      } finally {
        ftp.close();
      }
    }

    // ۵. خروجی نهایی با لینک‌های CDN و لینک‌های پشتیبان ورسل
    const responseSlides = downloadedSlides.map((s) => {
      const cdnUrl = `https://upc.geekclub.ir/forum/instagram_downloader/${shortcode}/${s.file_name}`;
      const cdnThumb = `https://upc.geekclub.ir/forum/instagram_downloader/${shortcode}/thumb_${s.index}.jpg`;
      return {
        index: s.index,
        type: s.type,
        cdn_url: cdnUrl,
        fallback_url: s.vercel_download_url,
        thumbnail_url: cdnThumb,
        size_bytes: s.size_bytes
      };
    });

    return res.status(200).json({
      status: 'success',
      shortcode,
      caption,
      slide_count: responseSlides.length,
      is_carousel: responseSlides.length > 1,
      retention_in_vercel: '12_hours_auto_cleanup',
      slides: responseSlides,
      ftp_report: ftpUploadResults
    });

  } catch (err) {
    return res.status(500).json({
      error: 'خطا در چرخه دانلود ورسل و آفلود CDN: ' + err.message
    });
  }
}

function decodeHtml(html) {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
