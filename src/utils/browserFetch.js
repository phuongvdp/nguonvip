// Dùng khi site chặn thẳng request kiểu axios/cheerio (403 ở tầng WAF trước
// khi chạm tới nội dung thật) — mở 1 trình duyệt Chromium headless thật để
// site không phân biệt được với người dùng thường, rồi đọc HTML đã render
// hoặc bắt response của 1 API call cụ thể phát sinh trong lúc load trang.
//
// Trên Vercel dùng @sparticuz/chromium (bản Chromium nén sẵn cho môi trường
// serverless) + puppeteer-core (không kèm chromium riêng, nhẹ hơn nhiều so
// với puppeteer đầy đủ — quan trọng vì serverless function có giới hạn
// dung lượng). Máy dev local không có sẵn chromium kiểu này thì tự tải
// Chrome hệ thống qua biến CHROME_EXECUTABLE_PATH (xem README/env.example).

let chromiumPromise;

async function loadChromium() {
  if (!chromiumPromise) {
    chromiumPromise = (async () => {
      const chromium = (await import('@sparticuz/chromium')).default;
      const puppeteer = await import('puppeteer-core');
      return { chromium, puppeteer };
    })();
  }
  return chromiumPromise;
}

// Giữ 1 browser instance dùng lại giữa các lần gọi trong cùng 1 lambda còn
// "ấm" (warm) — mở Chromium mất 2-4s, không muốn trả giá đó ở mọi request.
let browserPromise;
let browserOpenedAt = 0;
const BROWSER_MAX_AGE_MS = 5 * 60 * 1000;

async function getBrowser() {
  if (browserPromise && Date.now() - browserOpenedAt < BROWSER_MAX_AGE_MS) {
    try {
      const browser = await browserPromise;
      if (browser.isConnected()) return browser;
    } catch {
      // rơi xuống mở lại bên dưới
    }
  }

  const { chromium, puppeteer } = await loadChromium();
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath());

  browserOpenedAt = Date.now();
  browserPromise = puppeteer.launch({
    args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
    defaultViewport: { width: 1366, height: 768 },
    executablePath,
    headless: chromium.headless ?? true,
  });
  return browserPromise;
}

/**
 * Mở 1 trang bằng trình duyệt thật, chờ load xong, trả về HTML cuối cùng
 * (đã chạy JS) — dùng khi chỉ cần đọc DOM render sẵn.
 *
 * @param {string} url
 * @param {{ waitForSelector?: string, timeoutMs?: number, userAgent?: string }} [opts]
 */
async function fetchRenderedHtml(url, opts = {}) {
  const { waitForSelector, timeoutMs = 20000, userAgent } = opts;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    if (userAgent) await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8' });
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: timeoutMs }).catch(() => {});
    }
    const html = await page.content();
    return { html, status: response?.status() || 0 };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Mở trang và bắt response JSON của 1 (hoặc nhiều) API call khớp
 * `matchUrl` (string con hoặc RegExp) phát sinh trong lúc trang tự load —
 * dùng khi trang gọi API bằng JS (fetch/XHR) mà request thẳng bị site chặn,
 * nhưng nếu để trình duyệt tự gọi (kèm cookie/JS challenge đã qua) thì được.
 *
 * @param {string} url trang để mở
 * @param {string|RegExp} matchUrl phần URL cần bắt response
 * @param {{ timeoutMs?: number, triggerClick?: string }} [opts] triggerClick: selector để click sau khi trang load (một số trang chỉ gọi API khi tương tác)
 * @returns {Promise<any[]>} danh sách JSON body của mọi response khớp
 */
async function fetchApiViaBrowser(url, matchUrl, opts = {}) {
  const { timeoutMs = 20000, triggerClick } = opts;
  const browser = await getBrowser();
  const page = await browser.newPage();
  const captured = [];
  try {
    page.on('response', async (response) => {
      try {
        const reqUrl = response.url();
        const isMatch = matchUrl instanceof RegExp ? matchUrl.test(reqUrl) : reqUrl.includes(matchUrl);
        if (!isMatch) return;
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        captured.push(await response.json());
      } catch {
        // response không parse được thành JSON — bỏ qua, không phải cái cần bắt
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });
    if (triggerClick) {
      await page.click(triggerClick).catch(() => {});
      await page.waitForNetworkIdle({ idleTime: 800, timeout: timeoutMs }).catch(() => {});
    }
    return captured;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { fetchRenderedHtml, fetchApiViaBrowser, getBrowser };
