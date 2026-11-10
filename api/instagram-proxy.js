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

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return res.status(500).json({ error: 'متغیر APIFY_TOKEN در ورسل تنظیم نشده است.' });
  }

  try {
    // ۱. فراخوانی اکتر رسمی و فوق‌سریع Apify Instagram Scraper به صورت همگام (Synchronous)
    const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyToken}`;

    const response = await fetch(apifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/p/${shortcode}/`],
        resultsType: 'posts',
        resultsLimit: 1
      })
    });

    if (!response.ok) {
      throw new Error(`خطای سرور آپایفی: HTTP ${response.status}`);
    }

    const items = await response.json();
    if (!items || items.length === 0) {
      return res.status(404).json({ error: 'پست یافت نشد یا پیج کاملاً خصوصی است.' });
    }

    const item = items[0];
    const caption = item.caption || '';
    const slides = [];

    // اگر پست چند اسلایدی باشد (Carousel)
    if (item.childPosts && item.childPosts.length > 0) {
      item.childPosts.forEach((child, idx) => {
        const isVideo = Boolean(child.videoUrl);
        slides.push({
          index: idx + 1,
          type: isVideo ? 'video' : 'image',
          media_url: isVideo ? child.videoUrl : child.displayUrl,
          thumbnail_url: child.displayUrl || child.videoUrl
        });
      });
    } else {
      // پست یا ریلز تکی
      const isVideo = item.type === 'Video' || Boolean(item.videoUrl);
      const mediaUrl = isVideo ? item.videoUrl : item.displayUrl;
      slides.push({
        index: 1,
        type: isVideo ? 'video' : 'image',
        media_url: mediaUrl,
        thumbnail_url: item.displayUrl || mediaUrl
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
    return res.status(500).json({ error: 'خطای دریافت اطلاعات از Apify: ' + err.message });
  }
}
