import crawlerService from '@/src/services/crawler.service';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const { sport, tab } = req.query;
    const targetTab = tab || 'live';
    const matches = targetTab === 'live'
      ? await crawlerService.getLiveMatches(sport || 'all')
      : await crawlerService.getMatchesByTab(targetTab, sport || 'all');
    return res.status(200).json({
      success: true,
      count: matches.length,
      data: matches
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
