// Dùng khi site chặn thẳng request kiểu axios/cheerio (403 ở tầng WAF trước
// khi chạm tới nội dung thật) — mở 1 trình duyệt Chromium headless thật để
// site không phân biệt được với người dùng thường, rồi đọc HTML đã render
// hoặc bắt response của 1 API call cụ thể phát sinh trong lúc load trang.
//
// Trên Vercel dùng @sparticuz/chromium-min (bản Chromium NÉN SẴN CÓ trong
// gói npm KHÔNG đủ dùng — xem lý do ở FIX 10/09/2026 bên dưới) + puppeteer-
// core (không kèm chromium riêng, nhẹ hơn nhiều so với puppeteer đầy đủ).
// Máy dev local không có sẵn chromium kiểu này thì tự tải Chrome hệ thống
// qua biến CHROME_EXECUTABLE_PATH (xem README/env.example).
//
// FIX (10/09/2026 — lỗi "error while loading shared libraries: libnss3.so:
// cannot open shared object file"): đã tự kiểm tra trực tiếp trên Vercel
// (route debug-env.js) và xác nhận: bản @sparticuz/chromium ĐẦY ĐỦ (gói
// thường, không phải -min) khi chạy trên Node.js 20/22/24 của Vercel tự cho
// rằng hệ điều hành nền (Amazon Linux 2023) đã có sẵn NSS nên KHÔNG đóng gói
// kèm libnss3.so trong gói npm — nhưng môi trường Vercel thực tế lại không
// có sẵn, và Vercel không cho tự cài thêm gói hệ thống (dnf/apt) như máy chủ
// tự quản để bù vào. Đây không phải lỗi đường dẫn — file đó THỰC SỰ không
// tồn tại ở đâu cả trong trường hợp này.
// Giải pháp: dùng bản "-min" của gói này — bản này KHÔNG đóng gói sẵn
// chromium trong node_modules, mà TỰ TẢI 1 gói .tar nén Brotli đầy đủ (kèm
// mọi thư viện .so cần thiết, tự chứa, không phụ thuộc hệ điều hành) từ
// GitHub Releases của chính dự án @sparticuz/chromium ngay lần chạy đầu
// tiên (cold start), giải nén vào /tmp, các lần chạy sau (còn "ấm") dùng
// lại luôn không tải lại. Cần khớp ĐÚNG version release với version cài
// trong package.json (không tự ý đổi version 1 bên mà quên bên kia).
const CHROMIUM_PACK_VERSION = '131.0.1';
const CHROMIUM_PACK_URL = `https://github.com/Sparticuz/chromium/releases/download/v${CHROMIUM_PACK_VERSION}/chromium-v${CHROMIUM_PACK_VERSION}-pack.tar`;

const path = require('path');

let chromiumPromise;

async function loadChromium() {
  if (!chromiumPromise) {
    chromiumPromise = (async () => {
      const chromium = (await import('@sparticuz/chromium-min')).default;
      const puppeteer = await import('puppeteer-core');
      return { chromium, puppeteer };
    })();
  }
  return chromiumPromise;
}

// Giữ 1 browser instance dùng lại giữa các lần gọi trong cùng 1 lambda còn
// "ấm" (warm) — mở Chromium mất 2-4s (chưa tính lần đầu phải tải thêm gói
// pack.tar ở trên, có thể lâu hơn), không muốn trả giá đó ở mọi request.
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
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || (await chromium.executablePath(CHROMIUM_PACK_URL));

  // Giữ lại phòng hờ: dù gói pack.tar đã tự chứa mọi thư viện cần thiết,
  // khai báo thêm LD_LIBRARY_PATH trỏ đúng thư mục giải nén vẫn vô hại và
  // giúp chắc chắn hơn nếu có thư viện phụ nào chưa được linker tự tìm thấy.
  if (!process.env.CHROME_EXECUTABLE_PATH) {
    const execDir = path.dirname(executablePath);
    process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
      ? `${execDir}:${process.env.LD_LIBRARY_PATH}`
      : execDir;
  }

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

/**
 * Mở trang bằng trình duyệt thật rồi đọc 1 biến global trên window (sau khi
 * đã hydrate/chạy xong JS của trang) — dùng cho các site Nuxt/Next nhúng
 * sẵn dữ liệu (window.__NUXT__, window.__NEXT_DATA__...) nhưng ở dạng đã
 * mã hoá riêng (devalue...) trong HTML nguồn, rất khó tự parse tay. Nhờ
 * chính trình duyệt (đã tự giải mã xong để chạy app) trả lại giá trị JS
 * THẬT SỰ đã dựng xong, khỏi phải viết lại bộ giải mã đó.
 *
 * @param {string} url
 * @param {{ evalExpr?: string, timeoutMs?: number, userAgent?: string }} [opts]
 */
async function fetchPageGlobal(url, opts = {}) {
  const { evalExpr = 'window.__NUXT__', timeoutMs = 25000, userAgent } = opts;
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    if (userAgent) await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8' });
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs });

    // Cloudflare "Just a moment..." tự chuyển trang sau khi giải xong JS
    // challenge — đợi thêm 1 chút, không cần biết chính xác lúc nào xong.
    await page.waitForFunction(
      (expr) => {
        try {
          // eslint-disable-next-line no-eval
          return !!eval(expr);
        } catch {
          return false;
        }
      },
      { timeout: timeoutMs },
      evalExpr
    ).catch(() => {});

    const data = await page.evaluate((expr) => {
      try {
        // eslint-disable-next-line no-eval
        const val = eval(expr);
        return val === undefined ? null : JSON.parse(JSON.stringify(val));
      } catch {
        return null;
      }
    }, evalExpr);

    return { data, status: response?.status() || 0 };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { fetchRenderedHtml, fetchApiViaBrowser, fetchPageGlobal, getBrowser };
