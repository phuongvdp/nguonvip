/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // @sparticuz/chromium ném kèm 1 file binary chromium nén (.br) không nằm
  // trong đồ thị import tĩnh mà Vercel tự dò ra — phải khai báo tay để nó
  // được đóng gói theo function, nếu không sẽ lỗi "Could not find chromium"
  // lúc chạy trên Vercel dù chạy local vẫn OK.
  outputFileTracingIncludes: {
    '/api/vsc9/live': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/vsc9/stream': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/giovang/live': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/giovang/stream': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/matches': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/playlist': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/playlist/status': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/playlist/resolve': ['./node_modules/@sparticuz/chromium/bin/**'],
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
      { source: '/playlist-xoilac.m3u', destination: '/api/playlist?source=xoilac' },
      { source: '/playlist-phaohoa.m3u', destination: '/api/playlist?source=phaohoa' },
      { source: '/playlist-gavang.m3u', destination: '/api/playlist?source=gavang' },
      { source: '/playlist-giovang.m3u', destination: '/api/playlist?source=giovang' }
    ];
  }
};

module.exports = nextConfig;
