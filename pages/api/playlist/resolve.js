import crawlerService from '@/src/services/crawler.service';
import xoilacService from '@/src/services/xoilac.service';
import phaohoaService from '@/src/services/phaohoa.service';
import xoilacAffcupService from '@/src/services/xoilacAffcup.service';
import ninetyService from '@/src/services/ninety.service';
import vsc9Service from '@/src/services/vsc9.service';
import giovangService from '@/src/services/giovang.service';
import { normalizeStreamList, verifyStreamUrlPlayable } from '@/src/utils/playerGet';
import { preferHlsForIptv } from '@/src/utils/m3uPlaylist';

/**
 * GET /api/playlist/resolve?source=<key>&matchId=<id>&url=<liveUrl>&sport=<sport>
 *
 * Trận "sắp đá" trong file .m3u KHÔNG có link stream cố định (vì chưa bóng
 * lăn, chưa có bình luận viên) — kênh của nó trong playlist trỏ vào đây
 * thay vì 1 URL cứng. Khi trình phát (VLC, TiviMate, Perfect Player...) mở
 * kênh này (bất kể lúc đó là trước hay sau giờ bóng lăn), route này MỚI đi
 * lấy link thật ngay tại thời điểm đó:
 *   - Có link → 302 redirect sang link .m3u8/.flv thật, phát bình thường.
 *   - Chưa có (chưa tới giờ / nguồn chưa có blv) → trả lỗi ngắn, trình phát
 *     báo không mở được — người xem thử lại gần giờ bóng lăn.
 *
 * Không cache ở đây: mỗi lần mở kênh phải luôn kiểm tra lại trạng thái mới
 * nhất, tự nó không tốn tài nguyên vì chỉ chạy khi có người thật sự bấm play.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const source = String(req.query.source || '');
  const matchId = String(req.query.matchId || '');
  const url = String(req.query.url || '');
  const sport = String(req.query.sport || 'football');

  const notReadyYet = () => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(503).send('Trận chưa phát — thử lại gần giờ bóng lăn.');
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // FIX "chờ mãi không phát được trên điện thoại" (Xôi Lạc): mỗi lần thử
  // bên dưới trước đây KHÔNG có giới hạn thời gian riêng — xoilacService
  // .getStreams() probe TUẦN TỰ nhiều candidate CDN cho từng BLV (xem
  // resolveBestForChannel() trong xoilac.service.js), có candidate không
  // phản hồi thì cứ đợi hết timeout mạng mặc định. Cộng dồn nhiều candidate
  // × nhiều BLV × tối đa 3 lần thử (isRetryProne) dễ vượt xa 60s
  // (maxDuration) — route bị Vercel NGẮT NGANG, KHÔNG trả response gì cả,
  // nên app/điện thoại chỉ thấy "đang tải..." treo mãi chứ không phải báo
  // lỗi rõ ràng. Ép mỗi LẦN THỬ phải xong trong 1 mốc an toàn — quá hạn thì
  // coi như lần thử đó rỗng (giống lỗi mạng thoáng qua) và sang lần kế/trả
  // lỗi 503 rõ ràng, đảm bảo tổng thời gian toàn bộ vòng lặp luôn có margin
  // an toàn dưới 60s cho MỌI nguồn.
  async function withDeadline(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve([]), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    let raw = [];

    // GHI CHÚ FIX: route resolver này trước đây chỉ thử ĐÚNG 1 LẦN cho mọi
    // nguồn — trong khi resolveStreams() (dùng lúc build cache playlist) đã
    // luôn thử lại 2-3 lần cho mỗi nguồn. Gà Vàng và Xôi Lạc cần thêm bước
    // mạng phụ (Gà Vàng: tra matchId->JSON riêng; Xôi Lạc: mở trang trận rồi
    // resolve từng embed) nên dễ timeout/lỗi tạm thời (transient) hơn hẳn
    // Giovang/90Phut/VSC9/Pháo Hoa (gọi thẳng 1 API). Kết quả đúng như báo
    // cáo: trận vẫn đang live nhưng bấm vào báo "resource unavailable" vì
    // lần thử DUY NHẤT đó dính lỗi mạng thoáng qua. Thêm retry ở đây cho
    // toàn bộ nguồn, đặc biệt gavang/xoilac.
    const isRetryProne = source === 'xoilac' || !source;
    // Gà Vàng dùng riêng 2 lần thử: mỗi lần getStreamsForLiveUrl() đã tự
    // chạy 2 bước (JSON tĩnh nhanh → rồi mới tới trình duyệt headless nếu
    // cần, ~20-25s) — lặp 3 lần như trước dễ vượt quá maxDuration=60s.
    const maxAttempts = isRetryProne ? 3 : (source === 'gavang' ? 2 : 2);
    // Mốc thời gian an toàn cho 1 LẦN THỬ, theo đặc điểm từng nguồn — nhân
    // với maxAttempts (+ sleep giữa các lần) luôn còn margin rõ dưới 60s:
    //  - gavang (kể cả source rỗng, rơi vào nhánh gavang mặc định): có bước
    //    trình duyệt headless (~20-25s) → 22s × 2 lần + sleep ≈ 44.4s.
    //  - xoilac/xoilac-affcup: chỉ HTML tĩnh + probe candidate tuần tự,
    //    không mở trình duyệt → 12s × 3 lần + sleep ≈ 37.2s. Chậm hơn 12s
    //    thật sự gần như chắc chắn là candidate bị kẹt, không phải "sắp
    //    xong" — cắt sớm để còn thời gian thử candidate/lần khác.
    //  - phaohoa/90phut/vsc9/giovang: gọi thẳng 1 API, hiếm khi chậm → 8s.
    const ATTEMPT_TIMEOUT_BY_SOURCE = {
      gavang: 22000,
      xoilac: 12000,
      'xoilac-affcup': 12000,
      phaohoa: 8000,
      '90phut': 8000,
      vsc9: 8000,
      giovang: 8000
    };
    const attemptTimeoutMs = ATTEMPT_TIMEOUT_BY_SOURCE[source || 'gavang'] || 12000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (source === 'xoilac') {
          if (!url) return notReadyYet();
          raw = await withDeadline(xoilacService.getStreams(url), attemptTimeoutMs);
        } else if (source === 'phaohoa') {
          if (!matchId) return notReadyYet();
          raw = await withDeadline(phaohoaService.getStreamLinks(matchId, sport), attemptTimeoutMs);
        } else if (source === 'xoilac-affcup') {
          if (!url) return notReadyYet();
          raw = await withDeadline(xoilacAffcupService.getStreams(url), attemptTimeoutMs);
        } else if (source === '90phut') {
          const id = matchId || url;
          if (!id) return notReadyYet();
          const detail = await withDeadline(ninetyService.getMatchDetail(id, sport), attemptTimeoutMs);
          raw = detail?.streams || [];
        } else if (source === 'vsc9') {
          const id = url || matchId;
          if (!id) return notReadyYet();
          const detail = await withDeadline(vsc9Service.getMatchDetail(id), attemptTimeoutMs);
          raw = detail?.streams || [];
        } else if (source === 'giovang') {
          const id = url || matchId;
          if (!id) return notReadyYet();
          const detail = await withDeadline(giovangService.getMatchDetail(id), attemptTimeoutMs);
          raw = detail?.streams || [];
        } else {
          // gavang (mặc định) — getStreamsForLiveUrl() tự lo cả việc tra
          // matchId lẫn fallback mở trình duyệt headless khi trang giờ nạp
          // link bằng JS phía client (xem crawlerService.getStreamsViaBrowser
          // để biết lý do cần bước này — site đổi cách render, không còn
          // đọc được bằng HTML tĩnh nữa với nhiều trận).
          if (!matchId && !url) return notReadyYet();
          raw = await withDeadline(crawlerService.getStreamsForLiveUrl(url, matchId), attemptTimeoutMs);
        }

        if (raw?.length) break;
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
      }
      if (attempt < maxAttempts) await sleep(400 * attempt);
    }

    const list = normalizeStreamList(raw || []);
    // FIX cùng cơ chế với playlistBuilder.service.js: Gà Vàng không tự kiểm
    // tra domain còn phát được hay không (Xôi Lạc đã có isUrlReachable()
    // riêng trong xoilac.service.js) — xác minh lại ở đây trước khi redirect
    // thẳng người xem sang 1 link chết.
    let verifiedList = list;
    if (source === 'gavang' && list.length) {
      const checked = await Promise.all(
        list.map(async (s) => {
          const url = s.playUrl || s.m3u8Url || s.flvUrl;
          return (await verifyStreamUrlPlayable(url)) ? s : null;
        })
      );
      const playable = checked.filter(Boolean);
      if (playable.length) verifiedList = playable;
    }
    const best = verifiedList.find((s) => s.m3u8Url) || verifiedList[0];

    // FIX "link FLV không xem được trên điện thoại": route này redirect
    // THẲNG người xem sang playUrl gốc — nếu nguồn chỉ trả FLV (Xôi Lạc hay
    // ưu tiên chọn kênh FLV vì cert hợp lệ hơn), điện thoại/app IPTV (hầu
    // hết chỉ chạy được HLS, không hỗ trợ FLV) sẽ không phát được dù trận
    // vẫn đang live thật — dù link đã redirect đúng, VLC/TiviMate/Perfect
    // Player mở lên vẫn báo lỗi vì bản thân ĐỊNH DẠNG file không chạy được,
    // không phải do link chết. Trước khi redirect, thử nâng cấp sang bản
    // HLS song song (preferHlsForIptv() — CÙNG hàm dùng khi nhúng link trực
    // tiếp vào .m3u ở matchesToPlaylistEntries(), xem m3uPlaylist.js) và chỉ
    // dùng nếu xác minh CÒN PHÁT ĐƯỢC THẬT; không có/không xác minh được thì
    // vẫn giữ FLV như cũ (web + VLC trên PC vẫn phát bình thường FLV).
    const upgraded = await preferHlsForIptv(best || {});
    const playUrl = upgraded?.playUrl || upgraded?.m3u8Url || best?.playUrl || best?.m3u8Url || best?.flvUrl;

    if (!playUrl) return notReadyYet();

    return res.redirect(302, playUrl);
  } catch (err) {
    console.error('[API /playlist/resolve]', err.message);
    return notReadyYet();
  }
}

// Mở Chromium headless (fallback khi bị chặn 403) tốn vài giây — nới trần
// thời gian chạy lên mức tối đa Vercel Hobby cho phép.
export const config = { maxDuration: 60 };
