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
const fs = require('fs');
const zlib = require('zlib');

let chromiumPromise;

async function loadChromium() {
  if (!chromiumPromise) {
    chromiumPromise = (async () => {
      const chromium = (await import('@sparticuz/chromium-min')).default;
      // FIX (10/09/2026 — lỗi "Attempted to use detached Frame" lặp lại
      // liên tục khi đọc dữ liệu, dù đã qua được bước tải trang): Cloudflare
      // không chỉ kiểm tra navigator.webdriver mà còn dò thêm nhiều dấu
      // hiệu khác của trình duyệt tự động/máy chủ (renderer đồ hoạ giả lập
      // SwiftShader, chrome.runtime thiếu, danh sách plugin trống...),
      // khiến trang cứ liên tục bắt giải lại challenge, không bao giờ qua
      // hẳn — mỗi lần code định đọc dữ liệu lại đúng lúc trang đang tải lại
      // giữa chừng. Đổi từ puppeteer-core thuần sang puppeteer-extra + plugin
      // stealth (bộ vá ~17 dấu hiệu nhận diện bot được cộng đồng dùng rộng
      // rãi cho đúng loại vấn đề này) thay vì tự vá tay từng dấu hiệu một.
      const { addExtra } = await import('puppeteer-extra');
      const puppeteerCore = await import('puppeteer-core');
      const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
      const puppeteer = addExtra(puppeteerCore.default ?? puppeteerCore);
      puppeteer.use(StealthPlugin());
      return { chromium, puppeteer };
    })();
  }
  return chromiumPromise;
}

// Tự giải nén định dạng .tar (USTAR/POSIX) bằng tay — KHÔNG gọi lệnh `tar`
// bên ngoài, vì môi trường function của Vercel không chắc có sẵn lệnh này
// trong PATH (đã tự kiểm chứng: gọi execFileSync('tar', ...) chạy không ra
// lỗi rõ ràng nhưng cũng không tạo ra file nào — nghi là lệnh không tồn
// tại/không hoạt động như trên máy thường). Định dạng tar khá đơn giản: mỗi
// file là 1 block header 512 byte (tên ở byte 0-100, kích thước dạng bát
// phân ở byte 124-136, cờ loại ở byte 156) theo sau là nội dung file, đệm
// thêm cho đủ bội số 512 byte. Đã tự tải file thật của bản 131.0.1 về test
// bằng đúng đoạn code này trước khi đưa vào đây — ra đúng kích thước file
// gốc, chạy đúng.
function extractTarBuffer(buffer, destDir) {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // 2 block toàn số 0 = hết file

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);

    offset += 512;
    if (!name) continue;

    const destPath = path.join(destDir, name);
    if (typeFlag === '5' || name.endsWith('/')) {
      fs.mkdirSync(destPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, buffer.subarray(offset, offset + size));
    }

    offset += Math.ceil(size / 512) * 512; // nội dung đệm về bội số 512
  }
}

// FIX (10/09/2026 — vẫn thiếu libnss3.so ngay cả sau khi đổi sang -min):
// đã tự kiểm tra qua route debug-env.js và phát hiện: chromium.executable
// Path(url) có tải đúng gói .tar về thư mục "chromium-pack" cạnh file thực
// thi, NHƯNG bên trong đó các file thư viện hệ thống vẫn còn nguyên dạng
// nén Brotli (al2023.tar.br) — KHÔNG được tự động giải nén ra .so như kỳ
// vọng (khả năng do gói này chủ yếu được test trên các runtime chính thức
// của AWS Lambda, còn runtime Node.js 24 mà Vercel dùng không hoàn toàn
// giống hệt). Tự giải nén tay bằng zlib (đã có sẵn trong Node.js, không cần
// cài thêm gì) + extractTarBuffer() ở trên (thuần JS, không gọi lệnh `tar`
// ngoài — xem lý do ngay phía trên hàm đó).
function ensureSharedLibsExtracted(execDir) {
  // FIX: đã tự tải + giải nén thử file thật để kiểm chứng — libnss3.so nằm
  // trong 1 thư mục con "lib/" SAU KHI giải nén (không nằm trực tiếp cùng
  // cấp với file chromium như đoán ban đầu).
  const libDir = path.join(execDir, 'lib');
  const nssPath = path.join(libDir, 'libnss3.so');
  if (fs.existsSync(nssPath)) return; // đã có sẵn, khỏi làm gì thêm

  const packDir = path.join(execDir, 'chromium-pack');
  if (!fs.existsSync(packDir)) return;

  // Ưu tiên al2023 (môi trường Amazon Linux 2023 — dùng cho Node.js 20 trở
  // lên), al2 chỉ để dự phòng nếu vì lý do gì đó al2023 không có/không giải
  // nén được.
  const candidates = ['al2023.tar.br', 'al2.tar.br'];
  for (const name of candidates) {
    const brPath = path.join(packDir, name);
    if (!fs.existsSync(brPath)) continue;
    try {
      const compressed = fs.readFileSync(brPath);
      const decompressed = zlib.brotliDecompressSync(compressed);
      extractTarBuffer(decompressed, execDir);
      if (fs.existsSync(nssPath)) return; // giải nén xong, có file cần rồi
    } catch (error) {
      console.error(`Không giải nén được ${name}:`, error.message);
      // thử file tiếp theo trong danh sách candidates
    }
  }
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

  if (!process.env.CHROME_EXECUTABLE_PATH) {
    const execDir = path.dirname(executablePath);
    ensureSharedLibsExtracted(execDir);

    // Thư viện .so giải nén ra nằm trong execDir/lib (xem
    // ensureSharedLibsExtracted) — trỏ LD_LIBRARY_PATH vào ĐÚNG thư mục đó,
    // không phải execDir gốc.
    const libDir = path.join(execDir, 'lib');
    process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
      ? `${libDir}:${execDir}:${process.env.LD_LIBRARY_PATH}`
      : `${libDir}:${execDir}`;
  }

  browserOpenedAt = Date.now();
  browserPromise = puppeteer.launch({
    args: [
      ...chromium.args,
      '--disable-blink-features=AutomationControlled',
      // FIX (10/09/2026 — lỗi "Navigating frame was detached"): /dev/shm bị
      // giới hạn quá nhỏ trên môi trường container/serverless khiến
      // Chromium crash giữa chừng — cờ này bắt Chromium dùng file tạm trên
      // đĩa thay vì /dev/shm.
      '--disable-dev-shm-usage'
    ],
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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
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

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
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
 * Liên tục thử page.evaluate(expr) mỗi `intervalMs` cho tới khi ra kết quả
 * khác rỗng hoặc hết `overallTimeoutMs` — thay vì đoán chính xác lúc nào
 * trang chuyển hướng xong (khó đoán khi Cloudflare có thể tự chuyển trang
 * nhiều lần liên tiếp), cứ bỏ qua MỌI lỗi giữa chừng (kể cả "Execution
 * context was destroyed" do đang chuyển trang) và thử lại đến khi nào được
 * thì thôi, trong giới hạn thời gian cho phép.
 */
async function pollPageEvaluate(page, expr, overallTimeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + overallTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const val = await page.evaluate((e) => {
        try {
          // eslint-disable-next-line no-eval
          const v = eval(e);
          return v === undefined ? null : JSON.parse(JSON.stringify(v));
        } catch {
          return null;
        }
      }, expr);
      if (val) return val;
    } catch (error) {
      lastError = error; // context bị huỷ do đang chuyển trang — bỏ qua, thử lại
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) console.error('pollPageEvaluate: hết giờ, lỗi cuối cùng:', lastError.message);
  return null;
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

    let status = 0;
    try {
      // Giới hạn riêng bước goto ngắn hơn tổng thời gian cho phép — phần
      // "chờ Cloudflare tự giải + chuyển hướng" quan trọng hơn nằm ở bước
      // pollPageEvaluate ngay dưới, cần nhường phần lớn thời gian cho nó.
      const gotoTimeoutMs = Math.min(timeoutMs, 15000);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gotoTimeoutMs });
      status = response?.status() || 0;
    } catch (error) {
      // "Execution context was destroyed"/timeout ngay trong lúc goto cũng
      // có thể xảy ra nếu Cloudflare tự chuyển hướng liên tục — bỏ qua, vẫn
      // thử đọc dữ liệu ở bước dưới vì page có thể đã load được trang thật.
      console.error('fetchPageGlobal: lỗi lúc goto (bỏ qua, thử đọc tiếp):', error.message);
    }

    // Cloudflare "Just a moment..." có thể tự chuyển hướng NHIỀU LẦN liên
    // tiếp — không đoán chính xác lúc nào xong, cứ thử đọc liên tục cho
    // tới khi ra dữ liệu hoặc hết giờ.
    const data = await pollPageEvaluate(page, evalExpr, timeoutMs, 1000);

    return { data, status };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { fetchRenderedHtml, fetchApiViaBrowser, fetchPageGlobal, getBrowser, ensureSharedLibsExtracted };
