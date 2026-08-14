import xoilacAffcupService from '@/src/services/xoilacAffcup.service';

/**
 * API endpoint để lấy trận đấu AFF Cup theo tab
 * 
 * Query parameters:
 * - tab: 'live' | 'upcoming' | 'today' | 'hot' | 'commentator' (default: 'live')
 * - sport: 'football' | 'all' (default: 'football')
 * - page: số trang (default: 1)
 */
export default async function handler(req, res) {
  const { tab = 'live', sport = 'football', page = 1 } = req.query;

  // Chỉ cho phép GET
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    // Nếu yêu cầu tất cả các trang (used by aggregator)
    if (req.query.all === 'true') {
      const { matches, totalCount } = await xoilacAffcupService.getAllMatchesByTab(tab, sport);
      return res.status(200).json({
        success: true,
        data: matches,
        meta: {
          tab,
          sport,
          total: totalCount,
          source: 'xoilac-affcup'
        }
      });
    }

    // Lấy một trang cụ thể
    const { matches, hasMore, totalCount } = await xoilacAffcupService.getMatchesByTab(
      tab,
      sport,
      parseInt(page) || 1
    );

    return res.status(200).json({
      success: true,
      data: matches,
      meta: {
        tab,
        sport,
        page: parseInt(page) || 1,
        hasMore,
        total: totalCount,
        source: 'xoilac-affcup'
      }
    });
  } catch (error) {
    console.error('Error in /api/affcup/live:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
