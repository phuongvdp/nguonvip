import customSourceService from '@/src/services/customSource.service';

/**
 * API endpoint để xóa nguồn hoặc link
 * 
 * Method: DELETE
 * Query params:
 * - sourceId: ID của nguồn (bắt buộc)
 * - url: URL cần xóa (tùy chọn, nếu không thì xóa cả nguồn)
 * 
 * Response: {
 *   "success": true/false,
 *   "message": "..."
 * }
 */
export default function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ 
      success: false, 
      message: 'Chỉ cho phép DELETE method' 
    });
  }

  const { sourceId, url } = req.query;

  if (!sourceId) {
    return res.status(400).json({ 
      success: false, 
      message: 'Thiếu sourceId' 
    });
  }

  try {
    let success = false;
    let message = '';

    if (url) {
      // Xóa một link cụ thể
      success = customSourceService.removeLink(sourceId, url);
      message = success 
        ? 'Xóa link thành công' 
        : 'Không tìm thấy link';
    } else {
      // Xóa cả nguồn
      success = customSourceService.removeSource(sourceId);
      message = success 
        ? 'Xóa nguồn thành công' 
        : 'Không tìm thấy nguồn';
    }

    if (!success) {
      return res.status(404).json({ success: false, message });
    }

    return res.status(200).json({
      success: true,
      message
    });
  } catch (error) {
    console.error('Error in /api/sources/delete:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
}
