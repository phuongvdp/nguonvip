import crawlerService from '@/src/services/crawler.service';
import xoilacService from '@/src/services/xoilac.service';
import phaohoaService from '@/src/services/phaohoa.service';
import xoilacAffcupService from '@/src/services/xoilacAffcup.service';
import ninetyService from '@/src/services/ninety.service';
import vsc9Service from '@/src/services/vsc9.service';
import giovangService from '@/src/services/giovang.service';
import { normalizeStreamList } from '@/src/utils/playerGet';

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

  try {
    let raw = [];

    if (source === 'xoilac') {
      if (!url) return notReadyYet();
      raw = await xoilacService.getStreams(url);
    } else if (source === 'phaohoa') {
      if (!matchId) return notReadyYet();
      raw = await phaohoaService.getStreamLinks(matchId, sport);
    } else if (source === 'xoilac-affcup') {
      if (!url) return notReadyYet();
      raw = await xoilacAffcupService.getStreams(url);
    } else if (source === '90phut') {
      const id = matchId || url;
      if (!id) return notReadyYet();
      const detail = await ninetyService.getMatchDetail(id, sport);
      raw = detail?.streams || [];
    } else if (source === 'vsc9') {
      const id = url || matchId;
      if (!id) return notReadyYet();
      const detail = await vsc9Service.getMatchDetail(id);
      raw = detail?.streams || [];
    } else if (source === 'giovang') {
      const id = url || matchId;
      if (!id) return notReadyYet();
      const detail = await giovangService.getMatchDetail(id);
      raw = detail?.streams || [];
    } else {
      // gavang (mặc định)
      let id = matchId;
      if (!id && url) id = await crawlerService.getMatchIdFromUrl(url);
      if (!id) return notReadyYet();
      raw = await crawlerService.getStreamLinksByMatchId(id);
    }

    const list = normalizeStreamList(raw || []);
    const best = list.find((s) => s.m3u8Url) || list[0];
    const playUrl = best?.playUrl || best?.m3u8Url || best?.flvUrl;

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
