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

// Referer mặc định lấy theo domain trang nguồn (giống cách phaohoa.service.js
// đang set Referer cho các API JSON) — nhiều CDN chặn hotlink dựa trên
// Referer của TRANG WEB gốc chứ không phải domain CDN media, nên set cứng
// domain trang thay vì đoán theo domain của chính link CDN.
const REFERER_FALLBACK =
  process.env.PHAOHOA_DOMAIN || process.env.PHAOHOA_BASE_URL || 'https://phaohoa1.live';

function buildProxyPath(absoluteUrl) {
  return `/api/proxy/hls?url=${encodeURIComponent(absoluteUrl)}`;
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
function rewriteUriAttr(line, baseUrl) {
  return line.replace(/URI="([^"]+)"/i, (match, uri) => {
    const abs = resolveAbsolute(baseUrl, uri);
    return `URI="${buildProxyPath(abs)}"`;
  });
}

function rewriteM3u8(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return /URI="/i.test(trimmed) ? rewriteUriAttr(line, baseUrl) : line;
    }

    // Dòng không bắt đầu bằng "#" -> link segment (.ts/.aac/...) hoặc link
    // playlist con (sau #EXT-X-STREAM-INF) — cả 2 trường hợp đều cần bọc
    // qua proxy, kể cả khi link vốn đã là URL tuyệt đối.
    const abs = resolveAbsolute(baseUrl, trimmed);
    return buildProxyPath(abs);
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
  if (!/^https?:\/\//i.test(target)) {
    res.status(400).json({ success: false, message: 'Thiếu hoặc sai tham số "url" (phải là link http/https đầy đủ).' });
    return;
  }

  try {
    const upstreamHeaders = {
      'User-Agent': DEFAULT_UA,
      Accept: '*/*',
      Referer: REFERER_FALLBACK
    };
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    const upstream = await fetch(target, {
      headers: upstreamHeaders,
      redirect: 'follow'
    });

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
      const rewritten = rewriteM3u8(text, finalUrl);
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
