import customSourceService from '@/src/services/customSource.service';

export default async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'DELETE') {
    try {
      const removed = customSourceService.removeSource(id);
      if (!removed) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy nguồn.' });
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { urls } = req.body || {};
      const list = Array.isArray(urls) ? urls : [];
      if (!list.length) {
        return res.status(400).json({ success: false, message: 'Cần ít nhất 1 link.' });
      }
      const result = await customSourceService.addLinks(id, list.slice(0, 10));
      if (result.error) {
        return res.status(422).json({ success: false, message: result.error });
      }
      return res.status(200).json({ success: true, data: result.source, analyzed: result.analyzed });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || 'Internal Server Error' });
    }
  }

  return res.status(405).json({ success: false, message: 'Method Not Allowed' });
}
