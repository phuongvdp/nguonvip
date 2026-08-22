import { getMatches } from '@/src/services/playlistCache.service';
import { buildM3uPlaylist, matchesToPlaylistEntries } from '@/src/utils/m3uPlaylist';
import { filterBySportTab, filterBySource, getSourceShortLabel } from '@/src/utils/playerGet';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const sportTab = String(req.query.sport || 'all');
    // ?source=xoilac|phaohoa|gavang|giovang — playlist RIÊNG cho 1 nguồn,
    // để dán vào VLC/app IPTV chỉ theo dõi 1 nguồn thay vì gộp tất cả.
    // Bỏ trống hoặc 'all' thì giữ hành vi cũ (gộp mọi nguồn).
    const sourceKey = String(req.query.source || req.query.nguon || 'all');
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

    const bySport = filterBySportTab(matches, sportTab);
    const playable = filterBySource(bySport, sourceKey);
    const entries = await matchesToPlaylistEntries(playable, { baseUrl });
    const playlist = buildM3uPlaylist(entries);

    const ageSec = generatedAt ? Math.max(0, Math.round((Date.now() - generatedAt) / 1000)) : 0;
    // Tên file phản ánh cả nguồn lẫn môn thể thao khi có lọc, ví dụ
    // "live-xoilac-football.m3u" — giúp phân biệt khi tải nhiều playlist
    // khác nhau về cùng 1 máy/app IPTV.
    const fileSlug = sourceKey === 'all' ? sportTab : `${sourceKey}-${sportTab}`;

    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="live-${fileSlug}.m3u"`
    );
    // s-maxage NGẮN (60s, không phải 120s như bug cũ) + stale-while-revalidate
    // NGẮN (90s) — vừa đủ để bấm refresh trên app luôn được CDN trả NGAY LẬP
    // TỨC (không phải đợi server quét lại từ đầu → hết cảnh "quay tít" khi
    // container Vercel nguội/cold-start), vừa không bị cache dai như bug cũ
    // (khi đó là 120+300=420s ~7 phút, khiến bấm refresh mãi không thấy gì
    // mới). Tệ nhất dữ liệu cũ đi ~2.5 phút — chấp nhận được vì bản thân dữ
    // liệu nguồn cũng chỉ tự làm mới mỗi 15 phút (xem playlistCache.service.js).
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=90');
    if (generatedAt) res.setHeader('Last-Modified', new Date(generatedAt).toUTCString());
    res.setHeader('X-Playlist-Generated-At', generatedAt ? new Date(generatedAt).toISOString() : '');
    res.setHeader('X-Playlist-Age-Seconds', String(ageSec));
    res.setHeader('X-Playlist-Refresh-Interval-Seconds', String(refreshIntervalMs / 1000));
    res.setHeader('X-Playlist-Next-Refresh-At', nextRefreshAt ? new Date(nextRefreshAt).toISOString() : '');
    // FIX (lỗi luôn tái hiện với MỌI request có ?source=... hoặc ?nguon=...):
    // getSourceShortLabel() trả về nhãn tiếng Việt có dấu (vd "Xôi Lạc",
    // "Gà Vàng") — HTTP header chỉ chấp nhận ký tự Latin-1 (ISO-8859-1),
    // Node ném "TypeError: Invalid character in header content" ngay khi
    // setHeader() với chuỗi có dấu tiếng Việt. Lỗi này bị try/catch bên
    // dưới bắt lại rồi in ra dưới dạng "#EXTM3U\n# Error: ..." — tức là
    // toàn bộ playlist theo nguồn riêng (?source=xoilac/gavang/phaohoa/
    // giovang) bị hỏng 100% các lần gọi, không phụ thuộc mạng/dữ liệu.
    // encodeURIComponent() giữ header luôn là ASCII hợp lệ; phía client
    // muốn hiển thị tên có dấu thì decodeURIComponent() lại.
    res.setHeader(
      'X-Playlist-Source',
      sourceKey === 'all' ? 'all' : encodeURIComponent(getSourceShortLabel(sourceKey))
    );

    return res.status(200).send(playlist);
  } catch (error) {
    // In cả stack trace ra log Vercel (không phải chỉ message) để lần sau
    // biết chính xác dòng nào gây lỗi, thay vì phải đoán qua thông báo
    // chung chung như "a.filter is not a function".
    console.error('[playlist] failed:', error?.stack || error);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(500).send('#EXTM3U\n# Error: ' + (error.message || 'Internal Server Error') + '\n');
  }
}

// Quét trận có thể gọi ~15-20 nguồn ngoài — nới trần thời gian chạy
// (mặc định 10s) lên mức tối đa Vercel Hobby cho phép (60s) để đủ chỗ
// cho các lần cold-start/refresh chậm trước khi bị nền tảng tự ngắt.
export const config = { maxDuration: 60 };
