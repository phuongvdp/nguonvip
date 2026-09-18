import phaohoaService from '@/src/services/phaohoa.service';
import giovangService from '@/src/services/giovang.service';
import khandaitvService from '@/src/services/khandaitv.service';
import chuoichientvService from '@/src/services/chuoichientv.service';
import phalangService from '@/src/services/phalang.service';
import { normalizeStreamList, isFlvUrl } from '@/src/utils/playerGet';
import { preferHlsForIptv } from '@/src/utils/m3uPlaylist';

/**
 * GET /api/playlist/resolve?source=<key>&matchId=<id>&url=<liveUrl>&sport=<sport>
 *
 * Trận "sắp đá" trong file .m3u KHÔNG có link stream cố định (vì chưa bóng
 * lăn, chưa có bình luận viên) — kênh của nó trong playlist trỏ vào đây
 * thay vì 1 URL cứng. Khi trình phát (VLC, TiviMate, Perfect Player...) mở
 * kênh này (bất kể lúc đó là trước hay sau giờ bóng lăn), route này MỚI đi
 * lấy link thật ngay tại thời điểm đó:
 *   - Có link → 302 redirect sang link .m3u8 thật, phát bình thường.
 *   - Chưa có (chưa tới giờ / nguồn chưa có blv) → trả lỗi ngắn, trình phát
 *     báo không mở được — người xem thử lại gần giờ bóng lăn.
 *
 * Không cache ở đây: mỗi lần mở kênh phải luôn kiểm tra lại trạng thái mới
 * nhất, tự nó không tốn tài nguyên vì chỉ chạy khi có người thật sự bấm play.
 *
 * FIX (25/08/2026 — theo yêu cầu "chỉ giữ Pháo Hoa + Giờ Vàng"): đã xoá hẳn
 * các nhánh Gà Vàng/Xôi Lạc/AFF Cup/90Phút/VSC9 — chỉ còn phaohoa/giovang.
 * FIX (09/09/2026 — theo yêu cầu): thêm nhánh khandaitv (cùng cách gọi như
 * phaohoa vì cùng schema/backend, xem khandaitv.service.js).
 * FIX (17/09/2026 — theo yêu cầu): thêm nhánh chuoichientv (API riêng, xem
 * chuoichientv.service.js — getStreamLinks chỉ cần matchId, không cần sport).
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
  const wantsJson = req.query.json === '1' || req.query.json === 'true';

  const notReadyYet = () => {
    if (wantsJson) {
      return res.status(503).json({ success: false, message: 'Trận chưa phát — thử lại gần giờ bóng lăn.' });
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(503).send('Trận chưa phát — thử lại gần giờ bóng lăn.');
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const maxAttempts = 2;
    const attemptTimeoutMs = 8000; // Pháo Hoa/Giờ Vàng/Khán Đài gọi thẳng 1 API, hiếm khi chậm

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (source === 'phaohoa') {
          if (!matchId) return notReadyYet();
          raw = await withDeadline(phaohoaService.getStreamLinks(matchId, sport), attemptTimeoutMs);
        } else if (source === 'khandaitv') {
          if (!matchId) return notReadyYet();
          raw = await withDeadline(khandaitvService.getStreamLinks(matchId, sport), attemptTimeoutMs);
        } else if (source === 'chuoichientv') {
          if (!matchId) return notReadyYet();
          raw = await withDeadline(chuoichientvService.getStreamLinks(matchId), attemptTimeoutMs);
        } else if (source === 'phalang') {
          if (!matchId) return notReadyYet();
          raw = await withDeadline(phalangService.getStreamLinks(matchId), attemptTimeoutMs);
        } else if (source === 'giovang') {
          const id = url || matchId;
          if (!id) return notReadyYet();
          const detail = await withDeadline(giovangService.getMatchDetail(id), attemptTimeoutMs);
          raw = detail?.streams || [];
        } else {
          return notReadyYet();
        }

        if (raw?.length) break;
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
      }
      if (attempt < maxAttempts) await sleep(400 * attempt);
    }

    const list = normalizeStreamList(raw || []);
    const best = list.find((s) => s.m3u8Url) || list[0];

    const upgraded = await preferHlsForIptv(best || {});
    const playUrl = upgraded?.playUrl || upgraded?.m3u8Url || best?.playUrl || best?.m3u8Url || best?.flvUrl;
    const format = upgraded?.format || (isFlvUrl(playUrl || '') ? 'flv' : '');

    if (!playUrl) return notReadyYet();

    if (wantsJson) {
      return res.status(200).json({ success: true, playUrl, format });
    }

    return res.redirect(302, playUrl);
  } catch (err) {
    console.error('[API /playlist/resolve]', err.message);
    if (wantsJson) return res.status(500).json({ success: false, message: err.message || 'Lỗi không xác định' });
    return notReadyYet();
  }
}

export const config = { maxDuration: 60 };
