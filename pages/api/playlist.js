import { getMatches } from '@/src/services/playlistCache.service';
import { buildM3uPlaylist, matchesToPlaylistEntries } from '@/src/utils/m3uPlaylist';
import { filterBySportTab } from '@/src/utils/playerGet';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const sportTab = String(req.query.sport || 'all');
    const download = req.query.download === '1' || req.query.download === 'true';
    // ?refresh=1 — ép quét lại ngay (bỏ qua cache 15 phút), dùng khi cần dữ liệu mới nhất gấp.
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    // Trận sắp đá cần 1 URL resolver TUYỆT ĐỐI (có domain) trong file .m3u —
    // trình phát mở file từ máy khác, không thể dùng URL tương đối. Tự suy
    // ra từ chính request đang phục vụ (đúng domain thật đang chạy, kể cả
    // preview deploy trên Vercel) — không cần cấu hình thêm biến môi trường.
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const baseUrl = host ? `${proto}://${host}` : '';

    const { matches, generatedAt, nextRefreshAt, refreshIntervalMs } = await getMatches({ forceRefresh });

    const playable = filterBySportTab(matches, sportTab);
    const entries = matchesToPlaylistEntries(playable, { baseUrl });
    const playlist = buildM3uPlaylist(entries);

    const ageSec = generatedAt ? Math.max(0, Math.round((Date.now() - generatedAt) / 1000)) : 0;

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="live-${sportTab}.m3u"`
    );
    // File tự làm mới mỗi 15 phút ở phía server — client/CDN có thể cache ngắn hạn,
    // vẫn luôn kiểm tra lại (revalidate) để không bao giờ phục vụ bản quá cũ.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=300');
    if (generatedAt) res.setHeader('Last-Modified', new Date(generatedAt).toUTCString());
    res.setHeader('X-Playlist-Generated-At', generatedAt ? new Date(generatedAt).toISOString() : '');
    res.setHeader('X-Playlist-Age-Seconds', String(ageSec));
    res.setHeader('X-Playlist-Refresh-Interval-Seconds', String(refreshIntervalMs / 1000));
    res.setHeader('X-Playlist-Next-Refresh-At', nextRefreshAt ? new Date(nextRefreshAt).toISOString() : '');

    return res.status(200).send(playlist);
  } catch (error) {
    console.error('[playlist] failed:', error);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send('#EXTM3U\n# Error: ' + (error.message || 'Internal Server Error') + '\n');
  }
}

// Quét trận có thể gọi ~15-20 nguồn ngoài — nới trần thời gian chạy
// (mặc định 10s) lên mức tối đa Vercel Hobby cho phép (60s) để đủ chỗ
// cho các lần cold-start/refresh chậm trước khi bị nền tảng tự ngắt.
export const config = { maxDuration: 60 };
