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
    // روش ۱: استفاده از API داخلی کلاینت اینستاگرام با هدرهای موبایل
    const apiUrl = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 298.0.0.23.110',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Mode': 'cors',
        'X-IG-App-ID': '936619743392459' // کلید پابلیک اینستاگرام وب
      }
    });

    const rawText = await response.text();

    // بررسی اینکه آیا پاسخ واقعاً JSON است یا صفحه HTML برگشته
    if (rawText.trim().startsWith('<') || rawText.includes('<!DOCTYPE')) {
      // اگر اینستاگرام بلاک کرد، از روش دوم (استخراج تگ‌های OpenGraph) استفاده کن
      return await parseViaHtmlOpenGraph(shortcode, res);
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch (e) {
      return await parseViaHtmlOpenGraph(shortcode, res);
    }

    const item = json?.items?.[0] || json?.graphql?.shortcode_media;
    if (!item) {
      return await parseViaHtmlOpenGraph(shortcode, res);
    }

    const caption = item.caption?.text || item.edge_media_to_caption?.edges?.[0]?.node?.text || '';
    const slides = [];

    // اگر پست چند اسلایدی باشد (Carousel)
    if (item.carousel_media && item.carousel_media.length > 0) {
      item.carousel_media.forEach((m, idx) => {
        const isVideo = m.media_type === 2 || Boolean(m.video_versions);
        const videoUrl = m.video_versions?.[0]?.url;
        const imgUrl = m.image_versions2?.candidates?.[0]?.url;
        slides.push({
          index: idx + 1,
          type: isVideo ? 'video' : 'image',
          media_url: isVideo ? videoUrl : imgUrl,
          thumbnail_url: imgUrl || videoUrl
        });
      });
    } else {
      // پست تکی (ریلز یا عکس تکی)
      const isVideo = item.media_type === 2 || Boolean(item.video_versions) || item.is_video;
      const videoUrl = item.video_versions?.[0]?.url || item.video_url;
      const imgUrl = item.image_versions2?.candidates?.[0]?.url || item.display_url;
      slides.push({
        index: 1,
        type: isVideo ? 'video' : 'image',
        media_url: isVideo ? videoUrl : imgUrl,
        thumbnail_url: imgUrl || videoUrl
      });
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
    return await parseViaHtmlOpenGraph(shortcode, res);
  }
}

// موتور پشتیبان: استخراج از کدهای متا og:video و og:image بدون بلاک شدن
async function parseViaHtmlOpenGraph(shortcode, res) {
  try {
    const pageUrl = `https://www.instagram.com/p/${shortcode}/`;
    const resp = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html'
      }
    });

    const html = await resp.text();

    const videoMatch = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) 
                    || html.match(/<meta\s+property="og:video:secure_url"\s+content="([^"]+)"/i);
    const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);

    const isVideo = Boolean(videoMatch);
    const mediaUrl = isVideo ? decodeHtml(videoMatch[1]) : (imageMatch ? decodeHtml(imageMatch[1]) : '');

    if (!mediaUrl) {
      return res.status(404).json({ error: 'پست یافت نشد یا پیج اینستاگرام خصوصی (Private) است.' });
    }

    return res.status(200).json({
      status: 'success',
      shortcode,
      caption: titleMatch ? decodeHtml(titleMatch[1]) : '',
      slide_count: 1,
      is_carousel: false,
      slides: [
        {
          index: 1,
          type: isVideo ? 'video' : 'image',
          media_url: mediaUrl,
          thumbnail_url: imageMatch ? decodeHtml(imageMatch[1]) : mediaUrl
        }
      ]
    });
  } catch (e) {
    return res.status(500).json({ error: 'خطا در دریافت رسانه از اینستاگرام: ' + e.message });
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
