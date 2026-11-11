const fs = require('fs');
const path = require('path');
const os = require('os');
const execSync = require('child_process').execSync;
const ftp = require('basic-ftp');

/**
 * XenOffload - Vercel Serverless Diagnostic & Pipeline Debugger
 * مسیر قرارگیری در پروژه ورسل: /api/vercel-debug.js (یا /api/debug.js)
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const report = {
    timestamp: new Date().toISOString(),
    status: 'ONLINE',
    vercel_environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      free_mem_mb: Math.round(os.freemem() / (1024 * 1024)),
      total_mem_mb: Math.round(os.totalmem() / (1024 * 1024)),
      uptime_seconds: Math.round(process.uptime()),
      apify_token_configured: Boolean(process.env.APIFY_TOKEN)
    },
    filesystem_tmp: {
      path: '/tmp',
      exists: fs.existsSync('/tmp'),
      writable: false,
      test_file_write: false,
      cache_directory: '/tmp/instagram_cache',
      cache_directory_exists: fs.existsSync('/tmp/instagram_cache')
    },
    curl_engine: {
      curl_available: false,
      outbound_instagram_test: false,
      http_code: 0,
      byte_length: 0
    },
    ftp_cdn_connection: {
      host: 'upc.geekclub.ir',
      user: 'new@upc.geekclub.ir',
      port: 21,
      connected: false,
      login_success: false,
      remote_dir_test: false,
      error: null
    }
  };

  // ۱. تست دسترسی نوشتن به دایرکتوری /tmp ورسل
  try {
    const testFile = path.join('/tmp', `debug_test_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'Vercel filesystem test OK');
    if (fs.existsSync(testFile)) {
      report.filesystem_tmp.writable = true;
      report.filesystem_tmp.test_file_write = true;
      fs.unlinkSync(testFile);
    }
  } catch (err) {
    report.filesystem_tmp.error = err.message;
  }

  // ۲. تست موتور cURL بومی و ارتباط خروجی به اینستاگرام
  try {
    const curlVersion = execSync('curl --version', { timeout: 3000 }).toString();
    report.curl_engine.curl_available = true;
    report.curl_engine.version_summary = curlVersion.split('\n')[0];

    const testUrl = 'https://www.instagram.com/p/DY2G6cZCTKF/embed/';
    const testCmd = `curl -s -L -A "Mozilla/5.0" -w "%{http_code}" -o /tmp/insta_test.html "${testUrl}"`;
    const httpCodeStr = execSync(testCmd, { timeout: 10000 }).toString().trim();
    report.curl_engine.http_code = parseInt(httpCodeStr) || 200;
    if (fs.existsSync('/tmp/insta_test.html')) {
      report.curl_engine.byte_length = fs.statSync('/tmp/insta_test.html').size;
      report.curl_engine.outbound_instagram_test = (report.curl_engine.byte_length > 0);
      fs.unlinkSync('/tmp/insta_test.html');
    }
  } catch (err) {
    report.curl_engine.error = err.message;
  }

  // ۳. تست سوکت FTP و اتصال به هاست CDN اختصاصی
  const client = new ftp.Client(15000);
  try {
    await client.access({
      host: 'upc.geekclub.ir',
      user: 'new@upc.geekclub.ir',
      password: '1z{Tf_@LAZg}#l0[',
      port: 21,
      secure: false
    });
    report.ftp_cdn_connection.connected = true;
    report.ftp_cdn_connection.login_success = true;

    await client.ensureDir('/forum/instagram_downloader/debug_test');
    report.ftp_cdn_connection.remote_dir_test = true;
  } catch (err) {
    report.ftp_cdn_connection.error = err.message;
  } finally {
    client.close();
  }

  // پاسخ HTML برای مرورگر یا JSON برای API
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="fa" dir="rtl">
      <head>
        <meta charset="utf-8">
        <title>دیباگر اختصاصی نودجی‌اس ورسل (Vercel Debugger)</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0b1120; color: #f1f5f9; padding: 24px; line-height: 1.6; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 20px; margin-bottom: 16px; }
          .badge { font-size: 11px; font-weight: bold; padding: 4px 10px; border-radius: 6px; }
          .badge-success { background: #065f46; color: #34d399; }
          .badge-error { background: #7f1d1d; color: #f87171; }
          pre { font-family: monospace; background: #020617; padding: 14px; border-radius: 8px; color: #38bdf8; direction: ltr; text-align: left; overflow-x: auto; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>⚡ دیباگر اختصاصی ورسل (Vercel Serverless Debugger)</h1>
          <p>وضعیت اندپوینت: <span class="badge badge-success">✔ فعال و آماده کار (HTTP 200 OK)</span></p>
          <p style="font-size:13px; color:#94a3b8;">گزارش زنده عارضه‌یابی دیسک موقت /tmp، موتور cURL، پورت ۲۱ FTP و حافظه:</p>
          <pre>${JSON.stringify(report, null, 2)}</pre>
        </div>
      </body>
      </html>
    `);
  }

  return res.status(200).json(report);
};
