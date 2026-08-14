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

    const data = filtered.map((m) => ({
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
    }));

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
