import customSourceService from '@/src/services/customSource.service';

/**
 * API endpoint để thêm links mới vào nguồn hiện có
 * 
 * Method: POST
 * Query params:
 * - sourceId: ID của nguồn (bắt buộc)
 * 
 * Body: {
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
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Chỉ cho phép POST method' 
    });
  }

  const { sourceId } = req.query;
  const { urls } = req.body;

  if (!sourceId) {
    return res.status(400).json({ 
      success: false, 
      message: 'Thiếu sourceId' 
    });
  }

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Phải cung cấp ít nhất một URL' 
    });
  }

  try {
    // Kiểm tra nguồn tồn tại
    const source = customSourceService.get(sourceId);
    if (!source) {
      return res.status(404).json({ 
        success: false, 
        message: 'Không tìm thấy nguồn' 
      });
    }

    const result = await customSourceService.addLinks(
      sourceId, 
      urls.filter(u => typeof u === 'string').map(u => u.trim())
    );

    if (result.error) {
      return res.status(400).json({ 
        success: false, 
        message: result.error,
        analyzed: result.analyzed 
      });
    }

    const addedCount = result.analyzed.filter(r => r.ok).length;
    return res.status(200).json({
      success: true,
      message: `Thêm ${addedCount} link(s) thành công`,
      source: result.source,
      analyzed: result.analyzed
    });
  } catch (error) {
    console.error('Error in /api/sources/add-links:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
}
