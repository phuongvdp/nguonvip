/** @type {import('next').NextConfig} */
const PUPPETEER_EXTRA_TRACE_PATHS = [
  './node_modules/puppeteer-extra/**',
  './node_modules/puppeteer-extra-plugin/**',
  './node_modules/puppeteer-extra-plugin-stealth/**',
  './node_modules/puppeteer-extra-plugin-user-data-dir/**',
  './node_modules/puppeteer-extra-plugin-user-preferences/**'
];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // FIX (10/09/2026): đã chuyển từ @sparticuz/chromium (gói thường, ném kèm
  // sẵn file binary chromium .br trong node_modules) sang @sparticuz/
  // chromium-min (KHÔNG đóng gói sẵn binary — tự tải 1 gói .tar tự chứa từ
  // GitHub Releases về /tmp lúc chạy, xem src/utils/browserFetch.js) — vì
  // bản @sparticuz/chromium thường thiếu hẳn thư viện libnss3.so trên môi
  // trường Amazon Linux 2023 mà Vercel dùng cho Node.js 20/22/24, không có
  // cách nào tự cài bù vào được trên Vercel.
  //
  // FIX (10/09/2026 — lỗi "Cannot find module 'puppeteer-extra-plugin-
  // stealth/evasions/chrome.app'", rồi tiếp "puppeteer-extra-plugin-user-
  // preferences"): thêm puppeteer-extra-plugin-stealth để né phát hiện bot
  // (xem browserFetch.js) — nhưng cả họ gói puppeteer-extra-plugin-* này tự
  // require() lẫn nhau + các file con MỘT CÁCH ĐỘNG lúc chạy (kiến trúc
  // plugin), Next.js dò đồ thị import tĩnh nên không tự biết cần đóng gói
  // theo — đã liệt kê đủ CẢ CHUỖI phụ thuộc (tự kiểm tra package.json của
  // từng gói để chắc không sót) cho MỌI route có khả năng dùng tới trình
  // duyệt headless (trực tiếp hoặc gián tiếp qua playlistBuilder/matches
  // aggregator), nếu không sẽ lỗi module not found lúc chạy trên Vercel dù
  // chạy local vẫn OK.
  outputFileTracingIncludes: {
    '/api/giovang/live': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/giovang/stream': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/khandaitv/live': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/khandaitv/stream': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/matches': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/playlist': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/playlist/status': PUPPETEER_EXTRA_TRACE_PATHS,
    '/api/playlist/resolve': PUPPETEER_EXTRA_TRACE_PATHS,
  },
  async rewrites() {
    // Nhiều app IPTV (GSE, Perfect Player, SS IPTV, 1 số bản TiviMate...) tự
    // kiểm tra ĐUÔI FILE trong URL trước khi tải — thấy không phải .m3u/.m3u8
    // là báo lỗi ngay, dù nội dung /api/playlist trả về đúng chuẩn m3u.
    // Thêm alias có đuôi thật để những app khó tính này chấp nhận.
    // Playlist RIÊNG từng nguồn cũng cần alias đuôi .m3u/.m3u8 tương tự,
    // để dán thẳng vào app IPTV mà không cần biết cú pháp query
    // ?source=... — vẫn giữ nguyên /playlist.m3u?source=xxx cho ai muốn
    // tự ghép link (ví dụ thêm &sport=football), vì Next tự forward mọi
    // query param không khớp trong "source" sang "destination".
    return [
      { source: '/playlist.m3u', destination: '/api/playlist' },
      { source: '/playlist.m3u8', destination: '/api/playlist' },
      { source: '/playlist-phaohoa.m3u', destination: '/api/playlist?source=phaohoa' },
      { source: '/playlist-giovang.m3u', destination: '/api/playlist?source=giovang' },
      { source: '/playlist-khandaitv.m3u', destination: '/api/playlist?source=khandaitv' }
    ];
  }
};

module.exports = nextConfig;
