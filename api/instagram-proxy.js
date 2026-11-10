export default async function handler(req, res) {
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

  const match = url.match(/(?:\/p\/|\/reel\/|\/reels\/|\/tv\/)([A-Za-z0-9_-]+)/);
  if (!match) {
    return res.status(400).json({ error: 'فرمت لینک اینستاگرام نامعتبر است.' });
  }
  const shortcode = match[1];

  try {
    // ۱. دریافت صفحه امبد رسمی اینستاگرام که لینک مستقیم MP4 در پلیر آن تعبیه شده است
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const response = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const html = await response.text();

    // استخراج کپشن
    let caption = '';
    const captionMatch = html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
    if (captionMatch) {
      caption = captionMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    // ۲. استخراج لینک مستقیم ویدیو MP4
    let videoUrl = null;
    let thumbnailUrl = null;

    // جستجو در تگ video پلیر
    const videoTagMatch = html.match(/<video[^>]*src="([^"]+)"/i) 
                       || html.match(/class="EmbeddedMediaVideo"[^>]*src="([^"]+)"/i);
    if (videoTagMatch) {
      videoUrl = decodeHtml(videoTagMatch[1]);
    }

    // جستجو در کانفیگ‌های ویدیویی درون اسکریپت (video_url)
    if (!videoUrl) {
      const videoConfigMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/i)
                            || html.match(/"video_versions"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i);
      if (videoConfigMatch) {
        videoUrl = videoConfigMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      }
    }

    // ۳. استخراج پوستر و تصویر کاور
    const posterMatch = html.match(/<video[^>]*poster="([^"]+)"/i)
                     || html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i)
                     || html.match(/"display_url"\s*:\s*"([^"]+)"/i);
    if (posterMatch) {
      thumbnailUrl = decodeHtml(posterMatch[1]).replace(/\\u0026/g, '&').replace(/\\/g, '');
    }

    // ۴. اگر در امبد پیدا نشد، بررسی اسکریپت ساختاریافته (LD+JSON) در صفحه اصلی
    if (!videoUrl) {
      const pageResp = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });
      const pageHtml = await pageResp.text();

      const ldMatch = pageHtml.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
      if (ldMatch) {
        try {
          const ldData = JSON.parse(ldMatch[1]);
          if (ldData.video && ldData.video.contentUrl) {
            videoUrl = ldData.video.contentUrl;
            thumbnailUrl = ldData.video.thumbnailUrl || thumbnailUrl;
          }
        } catch (e) {}
      }

      if (!videoUrl) {
        const directVideoMatch = pageHtml.match(/"video_url"\s*:\s*"([^"]+)"/i);
        if (directVideoMatch) {
          videoUrl = directVideoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
        }
      }
    }

    // ۵. قالب‌بندی خروجی
    const isVideo = Boolean(videoUrl);
    const mediaUrl = isVideo ? videoUrl : thumbnailUrl;

    if (!mediaUrl) {
      return res.status(404).json({ error: 'فایل ویدیو در دسترس نیست یا پیج خصوصی است.' });
    }

    return res.status(200).json({
      status: 'success',
      shortcode,
      caption: decodeHtml(caption),
      slide_count: 1,
      is_carousel: false,
      slides: [
        {
          index: 1,
          type: isVideo ? 'video' : 'image',
          media_url: mediaUrl,
          thumbnail_url: thumbnailUrl || mediaUrl
        }
      ]
    });

  } catch (err) {
    return res.status(500).json({ error: 'خطای استخراج ویدیو: ' + err.message });
  }
}

function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}
