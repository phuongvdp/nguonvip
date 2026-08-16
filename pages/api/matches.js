import { getMatches } from '@/src/services/playlistCache.service';
import { filterBySportTab, getSourceKey } from '@/src/utils/playerGet';

/**
 * GET /api/matches?sport=<tab>&refresh=1
 *
 * JSON version of the aggregated live-match list (same cache as
 * /api/playlist), used by the homepage to render match cards grouped by
 * source with per-source show/hide toggles.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const sportTab = String(req.query.sport || 'all');
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    const { matches, generatedAt, nextRefreshAt, refreshIntervalMs } = await getMatches({ forceRefresh });
    const filtered = filterBySportTab(matches, sportTab);

    const data = filtered
      .map((m) => ({
        matchId: m.matchId,
        title: m.title || '',
        homeTeam: m.homeTeam || null,
        awayTeam: m.awayTeam || null,
        sport: m.sport,
        sportCategory: m.sportCategory,
        source: getSourceKey(m),
        sourceLabel: m.sourceLabel || '',
        competition: m.competition || null,
        matchTimeTimestamp: m.matchTimeTimestamp,
        status: m.status || {},
        streams: (m.streams || []).map((s) => ({
          name: s.streamerName || s.name || 'Server',
          playUrl: s.playUrl || s.m3u8Url || s.flvUrl || '',
          format: s.format || ''
        })).filter((s) => s.playUrl)
      }))
      // FIX: Gà Vàng & Xôi Lạc hiện trận live không có link phát nào (chưa
      // có BLV, hoặc mọi CDN của BLV đó đều chết) khiến người dùng bấm vào
      // là báo lỗi ("Không thể tìm thấy trang ..."). File .m3u đã lọc bỏ
      // các trận này (xem matchesToPlaylistEntries trong m3uPlaylist.js) —
      // trang web dùng endpoint này riêng nên phải lọc lại y hệt ở đây,
      // không thì vẫn hiện thẻ trận không bấm được. Chỉ áp dụng cho 2 nguồn
      // này — các nguồn khác không bị lọc theo bình luận viên nên hiếm khi
      // rơi vào tình trạng "live mà 0 link".
      .filter((m) => {
        if (m.streams.length) return true;
        if (!m.status?.isLive) return true;
        return !(m.source === 'gavang' || m.source === 'xoilac');
      });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      count: data.length,
      generatedAt: generatedAt ? new Date(generatedAt).toISOString() : null,
      nextRefreshAt: nextRefreshAt ? new Date(nextRefreshAt).toISOString() : null,
      refreshIntervalSeconds: refreshIntervalMs / 1000,
      matches: data
    });
  } catch (error) {
    console.error('[api/matches] failed:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Internal Server Error', matches: [] });
  }
}

// Quét trận có thể gọi ~15-20 nguồn ngoài — nới trần thời gian chạy
// (mặc định 10s) lên mức tối đa Vercel Hobby cho phép (60s) để đủ chỗ
// cho các lần cold-start/refresh chậm trước khi bị nền tảng tự ngắt.
export const config = { maxDuration: 60 };
