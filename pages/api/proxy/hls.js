/**
 * GET /api/proxy/hls?url=<link .m3u8/.ts/.key gốc, đã encodeURIComponent>
 *
 * FIX lỗi (xem lỗi.txt, 28/08/2026):
 *   "Access to XMLHttpRequest at 'https://luong.phaohoa.live/live/.../index.m3u8...'
 *    from origin 'https://nguonvip1.vercel.app' has been blocked by CORS policy"
 *   -> hls.js error: networkError manifestLoadError fatal=true
 *
 * NGUYÊN NHÂN: /api/playlist/resolve trước đây trả THẲNG link .m3u8 gốc của
 * CDN pháo hoa (luong.phaohoa.live...) cho trình duyệt. hls.js chạy trong
 * trình duyệt gọi (XHR/fetch) thẳng sang domain CDN đó để tải manifest +
 * từng segment .ts — nhưng CDN pháo hoa KHÔNG gắn header
 * "Access-Control-Allow-Origin" nên trình duyệt tự chặn request theo chính
 * sách CORS (đây là giới hạn phía TRÌNH DUYỆT, không phải lỗi mạng/lỗi
 * server). Vì manifest .m3u8 không tải được -> hls.js coi là lỗi mạng
 * fatal ngay từ bước đầu -> màn hình đen/không phát được.
 *
 * SỬA: route này chạy trên server (Node gọi HTTP thì KHÔNG bị CORS chi phối
 * — CORS chỉ áp dụng cho request phát ra từ trình duyệt), tải giúp nội dung
 * thật từ CDN nguồn:
 *   - Nếu là playlist .m3u8 (văn bản): đọc nội dung, viết lại MỌI link bên
 *     trong (dòng segment thường, link playlist con sau #EXT-X-STREAM-INF,
 *     URI="..." trong #EXT-X-KEY / #EXT-X-MEDIA) thành dạng tuyệt đối rồi
 *     bọc lại qua chính route proxy này -> trình duyệt chỉ còn thấy toàn bộ
 *     link trỏ VỀ DOMAIN CỦA CHÍNH MÌNH (same-origin), không còn gọi thẳng
 *     sang CDN pháo hoa nữa -> hết bị CORS chặn.
 *   - Nếu là segment nhị phân (.ts/.key/...): stream thẳng byte về trình
 *     duyệt, giữ nguyên Content-Type/Content-Length/Range từ CDN gốc.
 * Luôn gắn "Access-Control-Allow-Origin: *" trên MỌI phản hồi của route này
 * để dự phòng (kể cả khi app IPTV/ player khác gọi cross-origin thẳng vào
 * route proxy này thay vì qua trang web).
 */

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// FIX (17/09/2026 — "you do not have permission to access the requested
// resource" khi phát nguồn Chuối Chiên, và tiềm ẩn tương tự cho Giờ Vàng/
// Khán Đài): trước đây route này gắn CỨNG 1 Referer duy nhất (domain Pháo
// Hoa) cho MỌI nguồn — sai với CDN của các nguồn khác (vd edgemaxcdn.org,
// hdplaylink.com của Chuối Chiên), bị chặn vì nhiều CDN kiểm tra Referer
// khớp đúng domain trang gốc mới cho phát (chống hotlink). Giờ chọn Referer
// theo `source` (truyền từ buildProxyStreamUrl -> VideoPlayer -> đây) —
// vẫn giữ Pháo Hoa làm mặc định để không phá vỡ link cũ/link không rõ
// nguồn (playlist .m3u tĩnh tải về từ trước, v.v).
const REFERER_BY_SOURCE = {
  phaohoa: process.env.PHAOHOA_DOMAIN || process.env.PHAOHOA_BASE_URL || 'https://phaohoa1.live',
  giovang: process.env.GIOVANG_DOMAIN || 'https://giovang.city',
  khandaitv: process.env.KHANDAITV_DOMAIN || process.env.KHANDAITV_BASE_URL || 'https://khandai3.link',
  chuoichientv: 'https://live05.chuoichientv.me'
};
const REFERER_FALLBACK = REFERER_BY_SOURCE.phaohoa;

// FIX 2 (17/09/2026 — vẫn 403 Forbidden dù đã chọn đúng Referer theo
// nguồn ở trên, riêng CDN hdplaylink.com của Chuối Chiên):
// Chuối Chiên có 2 domain khác nhau — "domain chính" chuoichientv.link
// (xem chú thích đầu file src/services/chuoichientv.service.js) và domain
// PHỤ live05.chuoichientv.me là nơi trình duyệt thật sự chạy player. Trước
// đây route này đoán CDN hdplaylink.com kiểm tra Referer khớp domain PHỤ
// (live05...) — đoán sai, hoặc CDN đổi cách kiểm tra/đổi domain hợp lệ,
// nên header đó vẫn bị từ chối (403). Vì không có quyền đăng nhập backend
// CDN để biết CHÍNH XÁC domain nào được chấp nhận, và giá trị này có thể
// tự đổi bất cứ lúc nào phía CDN, KHÔNG đoán cứng 1 giá trị nữa — thử LẦN
// LƯỢT nhiều ứng viên hợp lý (domain chính, domain phụ, có/không dấu "/"
// cuối, gắn kèm Origin cùng cặp vì 1 số CDN đòi Origin thay vì/thêm vào
// Referer, và cuối cùng thử bỏ hẳn Referer/Origin — một số CDN chỉ chặn
// Referer SAI chứ không chặn Referer RỖNG) cho tới khi có 1 ứng viên được
// CDN chấp nhận (status không phải 401/403/451). Ứng viên nào thắng sẽ
// được nhớ lại trong bộ nhớ (theo hostname CDN) để các request sau (segment
// .ts kế tiếp của CÙNG 1 trận, dồn dập hàng chục request/phút) dùng thẳng,
// không phải thử lại từ đầu mỗi lần — tránh làm chậm phát video.
const REFERER_CANDIDATES_BY_SOURCE = {
  chuoichientv: ['https://live05.chuoichientv.me/', 'https://chuoichientv.link/', null],
  phaohoa: [REFERER_BY_SOURCE.phaohoa, null],
  giovang: [REFERER_BY_SOURCE.giovang, null],
  khandaitv: [REFERER_BY_SOURCE.khandaitv, null]
};

// Nhớ lại (trong bộ nhớ container, theo hostname CDN) ứng viên Referer nào
// vừa thắng gần nhất, để không phải thử lại tuần tự mỗi request.
const workingRefererByHost = new Map();

function refererCandidatesFor(source, target) {
  const preset = REFERER_CANDIDATES_BY_SOURCE[source];
  const list = preset && preset.length ? preset.slice() : [REFERER_BY_SOURCE[source] || REFERER_FALLBACK, null];

  let host = '';
  try {
    host = new URL(target).hostname;
  } catch {
    // target không parse được thì bỏ qua bước ưu tiên theo cache, vẫn thử
    // tuần tự các ứng viên còn lại như bình thường.
  }
  const remembered = host && workingRefererByHost.has(host) ? workingRefererByHost.get(host) : undefined;
  if (remembered !== undefined && list.includes(remembered)) {
    // Đẩy ứng viên đã từng thắng lên đầu danh sách để thử trước tiên.
    return [remembered, ...list.filter((r) => r !== remembered)];
  }
  return list;
}

function rememberWorkingReferer(target, referer) {
  try {
    const host = new URL(target).hostname;
    if (host) workingRefererByHost.set(host, referer);
  } catch {
    // bỏ qua nếu không parse được URL
  }
}

// Nguồn phát chặn hotlink (Referer/Origin sai) luôn trả 401/403, một số nơi
// dùng 451 — coi các mã này là "ứng viên hiện tại chưa đúng, thử tiếp",
// khác với lỗi thật (404 hết hạn link, 5xx server nguồn lỗi...) là dừng
// ngay không thử thêm (thử thêm Referer khác cũng không cứu được các lỗi
// này, chỉ tốn thời gian).
function isHotlinkBlockStatus(status) {
  return status === 401 || status === 403 || status === 451;
}

async function fetchUpstreamWithRefererFallback(target, source, rangeHeader) {
  const candidates = refererCandidatesFor(source, target);
  let lastResponse = null;
  let lastError = null;

  for (const referer of candidates) {
    const upstreamHeaders = {
      'User-Agent': DEFAULT_UA,
      Accept: '*/*'
    };
    if (referer) {
      upstreamHeaders.Referer = referer;
      try {
        upstreamHeaders.Origin = new URL(referer).origin;
      } catch {
        // referer không phải URL hợp lệ (không nên xảy ra) -> bỏ qua Origin
      }
    }
    if (rangeHeader) upstreamHeaders.Range = rangeHeader;

    try {
      const response = await fetch(target, { headers: upstreamHeaders, redirect: 'follow' });
      if (!isHotlinkBlockStatus(response.status)) {
        rememberWorkingReferer(target, referer);
        return response;
      }
      lastResponse = response;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error('Không có Referer nào gọi được tới nguồn phát');
}

function buildProxyPath(absoluteUrl, source) {
  const qs = new URLSearchParams({ url: absoluteUrl });
  if (source) qs.set('source', source);
  return `/api/proxy/hls?${qs.toString()}`;
}

function resolveAbsolute(baseUrl, maybeRelative) {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

// Viết lại URI="..." trong các dòng thẻ như #EXT-X-KEY, #EXT-X-MEDIA để
// cũng đi qua proxy (nếu không, trình duyệt sẽ tự tải thẳng key/audio phụ
// từ CDN gốc và lại dính đúng lỗi CORS y như link .m3u8 chính).
function rewriteUriAttr(line, baseUrl, source) {
  return line.replace(/URI="([^"]+)"/i, (match, uri) => {
    const abs = resolveAbsolute(baseUrl, uri);
    return `URI="${buildProxyPath(abs, source)}"`;
  });
}

function rewriteM3u8(text, baseUrl, source) {
  const lines = text.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return /URI="/i.test(trimmed) ? rewriteUriAttr(line, baseUrl, source) : line;
    }

    // Dòng không bắt đầu bằng "#" -> link segment (.ts/.aac/...) hoặc link
    // playlist con (sau #EXT-X-STREAM-INF) — cả 2 trường hợp đều cần bọc
    // qua proxy, kể cả khi link vốn đã là URL tuyệt đối.
    const abs = resolveAbsolute(baseUrl, trimmed);
    return buildProxyPath(abs, source);
  });
  return rewritten.join('\n');
}

export default async function handler(req, res) {
  // Gắn CORS ngay từ đầu, kể cả khi lỗi bên dưới, để không rơi vào tình
  // huống ẩn: proxy trả lỗi 4xx/5xx nhưng vẫn thiếu header CORS khiến
  // trình duyệt lại hiện đúng lỗi CORS thay vì lỗi thật (dễ chẩn đoán sai).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ success: false, message: 'Method Not Allowed' });
    return;
  }

  const target = String(req.query.url || '');
  const source = String(req.query.source || '');
  if (!/^https?:\/\//i.test(target)) {
    res.status(400).json({ success: false, message: 'Thiếu hoặc sai tham số "url" (phải là link http/https đầy đủ).' });
    return;
  }

  try {
    const upstream = await fetchUpstreamWithRefererFallback(target, source, req.headers.range);

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status || 502).json({
        success: false,
        message: `Nguồn phát trả về lỗi ${upstream.status} khi tải: ${target}`
      });
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    // upstream.url là URL SAU CÙNG sau khi theo hết redirect — dùng làm base
    // để quy đổi link tương đối bên trong playlist cho đúng, tránh trường
    // hợp link .m3u8 ban đầu 302 sang domain CDN khác.
    const finalUrl = upstream.url || target;
    const looksLikeManifest =
      /mpegurl/i.test(contentType) || /\.m3u8(\?|$)/i.test(finalUrl) || /\.m3u8(\?|$)/i.test(target);

    if (looksLikeManifest) {
      const text = await upstream.text();
      // Nếu nội dung tải về không thực sự là playlist (vd trang lỗi HTML do
      // link đã hết hạn/sign sai) thì KHÔNG cố parse tiếp, trả lỗi rõ ràng
      // thay vì đẩy HTML rác vào hls.js khiến lỗi càng khó hiểu.
      if (!/^#EXTM3U/m.test(text)) {
        res.status(502).json({
          success: false,
          message: 'Link nguồn đã hết hạn hoặc không còn hợp lệ (không phải nội dung m3u8 thật).'
        });
        return;
      }
      const rewritten = rewriteM3u8(text, finalUrl, source);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(rewritten);
      return;
    }

    // Nhị phân (segment .ts, .key, .aac...) — stream thẳng, không buffer cả
    // file vào bộ nhớ, giữ nguyên header liên quan tới phát video/seek.
    res.status(upstream.status);
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'HEAD' || !upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[api/proxy/hls]', err?.message, '| target:', target);
    res.status(502).json({
      success: false,
      message: 'Không lấy được dữ liệu từ nguồn phát: ' + (err?.message || 'lỗi không xác định')
    });
  }
}

export const config = {
  api: { responseLimit: false },
  maxDuration: 30
};
