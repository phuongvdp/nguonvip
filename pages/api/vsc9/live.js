import vsc9Service from '@/src/services/vsc9.service';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  try {
    const { tab = 'live' } = req.query;
    const result = await vsc9Service.getMatchesByTab(tab);
    return res.status(200).json({
      success: true,
      data: result.matches,
      meta: { source: 'vsc9', tab, total: result.totalCount, hasMore: false },
      // Chỉ trả debug khi rỗng, để biết ngay đang bị chặn ở bước nào
      // (warmup / gọi API JSON / fallback quét HTML) mà không cần vào log Vercel.
      ...(result.totalCount === 0 ? { debug: vsc9Service.lastDiagnostics } : {}),
    });
  } catch (error) {
    console.error('[API /vsc9/live]', error.message);
    return res.status(500).json({ success: false, message: 'Không thể lấy dữ liệu từ VSC9', error: error.message });
  }
}

// Mở Chromium headless (fallback khi bị chặn 403) tốn vài giây — nới trần
// thời gian chạy lên mức tối đa Vercel Hobby cho phép.
export const config = { maxDuration: 60 };
