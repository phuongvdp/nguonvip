import ninetyService from '@/src/services/ninety.service';

/**
 * GET /api/ninety/stream?id=<slug-or-id>&sport=football
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { id, sport = 'football' } = req.query;

  if (!id) {
    return res.status(400).json({ success: false, message: 'Thiếu tham số id' });
  }

  try {
    const detail = await ninetyService.getMatchDetail(id, sport);

    if (!detail) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy trận đấu' });
    }

    return res.status(200).json({
      success: true,
      data: {
        match: detail.match,
        streams: detail.streams,
        matchId: detail.matchId,
      },
      meta: {
        source: '90phut',
        id,
        sport,
        streamCount: detail.streams?.length || 0,
      },
    });
  } catch (err) {
    console.error('[API /ninety/stream]', err.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy stream từ 90phut',
      error: err.message,
    });
  }
}
