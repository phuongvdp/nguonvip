import xoilacAffcupService from '@/src/services/xoilacAffcup.service';

/**
 * API endpoint để lấy chi tiết trận đấu AFF Cup kèm streams
 * 
 * Query parameters:
 * - id: slug hoặc ID trận đấu (required)
 * - sport: 'football' | 'all' (default: 'football')
 */
export default async function handler(req, res) {
  const { id, sport = 'football' } = req.query;

  // Chỉ cho phép GET
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  // Kiểm tra id bắt buộc
  if (!id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required parameter: id' 
    });
  }

  try {
    const { match, streams, matchId } = await xoilacAffcupService.getMatchDetail(id, sport);

    if (!match) {
      return res.status(404).json({
        success: false,
        message: 'Match not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        match,
        streams,
        matchId
      },
      meta: {
        source: 'xoilac-affcup',
        sport
      }
    });
  } catch (error) {
    console.error('Error in /api/affcup/stream:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
