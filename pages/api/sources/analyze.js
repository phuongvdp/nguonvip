import customSourceService from '@/src/services/customSource.service';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }
  try {
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    if (!urls.length) {
      return res.status(400).json({ success: false, message: 'Cần ít nhất 1 link để phân tích.' });
    }
    const analyzed = await customSourceService.analyze(urls.slice(0, 10));
    return res.status(200).json({ success: true, data: analyzed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
  }
}
