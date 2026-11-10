export default async function handler(req, res) {
  // تنظیم هدرهای CORS برای دسترسی بدون محدودیت
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const url = req.query.url || req.body?.url;
  if (!url) {
    return res.status(400).json({ error: 'پارامتر url الزامی است.' });
  }

  // ۱. استخراج Shortcode
  const match = url.match(/(?:\/p\/|\/reel\/|\/reels\/|\/tv\/)([A-Za-z0-9_-]+)/);
  if (!match) {
    return res.status(400).json({ error: 'فرمت لینک اینستاگرام نامعتبر است.' });
  }
  const shortcode = match[1];

  try {
    // ۲. فراخوانی امبد اینستاگرام با fetch پیش‌فرض مرورگر/Node.js
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();

    // ۳. استخراج کپشن
    let caption = '';
    const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
    if (captionMatch) {
      caption = captionMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    const slides = [];

    // ۴. استخراج ویدیوها
    const videoMatches = [...html.matchAll(/class="EmbeddedMediaVideo"[^>]*src="([^"]+)"/gi)];
    videoMatches.forEach((m, idx) => {
      slides.push({
        index: idx + 1,
        type: 'video',
        media_url: decodeHtml(m[1]),
        thumbnail_url: ''
      });
    });

    // ۵. استخراج تصاویر
    if (slides.length === 0) {
      const imgMatches = [...html.matchAll(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/gi)];
      imgMatches.forEach((m, idx) => {
        slides.push({
          index: idx + 1,
          type: 'image',
          media_url: decodeHtml(m[1]),
          thumbnail_url: decodeHtml(m[1])
        });
      });
    }

    // ۶. پشتیبان OEmbed در صورت بسته بودن
    if (slides.length === 0) {
      try {
        const oembedRes = await fetch(`https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}/`);
        if (oembedRes.ok) {
          const oembedData = await oembedRes.json();
          slides.push({
            index: 1,
            type: 'image',
            media_url: oembedData.thumbnail_url,
            thumbnail_url: oembedData.thumbnail_url
          });
          caption = caption || oembedData.title || '';
        }
      } catch (oe) {}
    }

    return res.status(200).json({
      status: 'success',
      shortcode,
      caption,
      slide_count: slides.length,
      is_carousel: slides.length > 1,
      slides
    });

  } catch (err) {
    return res.status(500).json({ error: 'خطای سرور پروکسی ورسل: ' + err.message });
  }
}

function decodeHtml(html) {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}
