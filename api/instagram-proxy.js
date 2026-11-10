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
    return res.status(400).json({ error: 'لینک اینستاگرام نامعتبر است.' });
  }
  const shortcode = match[1];

  try {
    // استفاده از API رسمی و پایدار OEmbed اینستاگرام (بدون خطای HTML یا بلاک شدن)
    const oembedUrl = `https://api.instagram.com/oembed/?url=https://www.instagram.com/p/${shortcode}/`;
    const response = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return res.status(404).json({ error: 'پست یافت نشد یا دسترسی به آن محدود (خصوصی) است.' });
    }

    const data = await response.json();

    // استخراج اطلاعات رسانه
    const mediaUrl = data.thumbnail_url || '';
    const caption = data.title || '';

    const slides = [
      {
        index: 1,
        type: mediaUrl.includes('.mp4') ? 'video' : 'image',
        media_url: mediaUrl,
        thumbnail_url: mediaUrl
      }
    ];

    return res.status(200).json({
      status: 'success',
      shortcode,
      caption,
      slide_count: slides.length,
      is_carousel: false,
      slides
    });

  } catch (err) {
    return res.status(500).json({ error: 'خطای پروکسی ورسل: ' + err.message });
  }
}
