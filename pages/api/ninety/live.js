import ninetyService from '@/src/services/ninety.service';

/**
 * GET /api/ninety/live
 * Query: tab, sport, page, all
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { tab = 'live', sport = 'football', page = 1, all } = req.query;

  try {
    let result;
    if (all === '1' || all === 'true') {
      result = await ninetyService.getAllMatchesByTab(tab, sport);
    } else {
      result = await ninetyService.getMatchesByTab(tab, sport, Number(page));
    }

    const { matches = [], hasMore = false, totalCount = 0 } = result;

    return res.status(200).json({
      success: true,
      data: matches,
      meta: {
        source: '90phut',
        tab,
        sport,
        page: Number(page),
        total: totalCount,
        hasMore,
        cached: true,
      },
    });
  } catch (err) {
    console.error('[API /ninety/live]', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy dữ liệu từ 90phut',
      error: err.message,
    });
  }
}
