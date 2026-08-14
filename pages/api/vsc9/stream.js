import vsc9Service from '@/src/services/vsc9.service';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  const id = String(req.query.id || req.query.url || '');
  if (!id) return res.status(400).json({ success: false, message: 'Thiếu id hoặc url trận đấu' });
  try {
    const detail = await vsc9Service.getMatchDetail(id);
    return res.status(200).json({ success: true, data: detail, meta: { source: 'vsc9', streamCount: detail.streams.length } });
  } catch (error) {
    console.error('[API /vsc9/stream]', error.message);
    return res.status(500).json({ success: false, message: 'Không thể lấy stream từ VSC9', error: error.message });
  }
}

// Mở Chromium headless (fallback khi bị chặn 403) tốn vài giây — nới trần
// thời gian chạy lên mức tối đa Vercel Hobby cho phép.
export const config = { maxDuration: 60 };
