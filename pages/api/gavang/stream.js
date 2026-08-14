import crawlerService from '@/src/services/crawler.service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }
  try {
    let matchId = req.query.id;
    const liveUrl = req.query.url;

    if (!matchId && !liveUrl) {
      return res.status(400).json({
        success: false,
        message: 'Either parameter "id" (Match ID) or "url" (liveUrl) is required.'
      });
    }

    if (!matchId && liveUrl) {
      matchId = await crawlerService.getMatchIdFromUrl(liveUrl);
    }

    const streams = await crawlerService.getStreamLinksByMatchId(matchId);

    return res.status(200).json({
      success: true,
      matchId,
      count: streams.length,
      data: streams
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
