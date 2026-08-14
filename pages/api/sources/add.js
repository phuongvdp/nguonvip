import customSourceService from '@/src/services/customSource.service';

/**
 * API endpoint để thêm nguồn mới
 * 
 * Method: POST
 * Body: {
 *   "name": "Tên nguồn",
 *   "urls": ["https://link1", "https://link2", ...]
 * }
 * 
 * Response: {
 *   "success": true/false,
 *   "source": {...},
 *   "analyzed": [...],
 *   "message": "..."
 * }
 */
export default async function handler(req, res) {
  // Chỉ cho phép POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Chỉ cho phép POST method' 
    });
  }

  const { name, urls } = req.body;

  // Validation
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Tên nguồn không được để trống' 
    });
  }

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Phải cung cấp ít nhất một URL' 
    });
  }

  try {
    const result = await customSourceService.addSource({ 
      name: name.trim(), 
      urls: urls.filter(u => typeof u === 'string').map(u => u.trim()) 
    });

    if (result.error) {
      return res.status(400).json({ 
        success: false, 
        message: result.error,
        analyzed: result.analyzed 
      });
    }

    return res.status(201).json({
      success: true,
      message: `Thêm nguồn "${result.source.name}" thành công`,
      source: result.source,
      analyzed: result.analyzed
    });
  } catch (error) {
    console.error('Error in /api/sources/add:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
}
