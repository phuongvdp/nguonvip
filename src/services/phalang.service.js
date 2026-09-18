import { createHttpClient } from '@/src/utils/httpClient';

// Phá Làng TV — domain hiển thị đã đổi sang phalang.live (trước đây dò ra là
// phalang.tv, ĐÃ SAI — xem FIX 18/09/2026 bên dưới). API thật nằm trên
// domain RIÊNG do người dùng cung cấp qua tab Network của trình duyệt.
//   - POST /matches/graph  (BẮT BUỘC có body, kể cả body rỗng {} — GET trả
//     405, POST không kèm body trả 422 "Field required") -> { data: [...], total }
//     Trả về TOÀN BỘ trận (không chỉ live) — is_live là boolean có sẵn
//     ngay trong từng phần tử, tự lọc live/upcoming ở code bên dưới.
//   - GET  /match/{id}/live -> { type, source, hd_1, hd_2, ... } (link phát)
//     Trận CHƯA có link (chưa live) trả 404 "EntityNotFound" — đây là phản
//     hồi HỢP LỆ của API (không phải lỗi/bị chặn), KHÔNG log ra console.error
//     như lỗi thật để tránh làm ồn log Vercel mỗi lần quét.
//
// FIX (18/09/2026 — "nguồn Phá Làng không hiển thị trận live"): bắt được
// request THẬT từ trình duyệt (tab Network trang phalang.live/trang-chu) và
// phát hiện 2 chỗ sai so với code cũ:
//   1) Referer cũ trỏ nhầm sang phalang.tv (domain cũ/không còn đúng) — trang
//      thật đang chạy ở phalang.live, kèm Origin cross-site
//      "https://phalang.live" mà code cũ không hề gửi.
//   2) Body cũ gửi {} (rỗng hoàn toàn). API vẫn nhận (không lỗi) nhưng khi đó
//      rơi vào limit/sắp xếp MẶC ĐỊNH của server — không có gì đảm bảo mặc
//      định đó liệt kê đủ toàn bộ trận (đặc biệt trận đang live, đá từ trước
//      đó lâu, dễ bị rơi khỏi trang đầu nếu mặc định sort khác
//      order_asc=start_date). Request thật của trình duyệt LUÔN kèm
//      limit/page/order_asc/queries tường minh — nay gửi đúng cấu trúc đó
//      (queries: [] để lấy tất cả, không lọc is_hot như tab "Hot" trên web),
//      dùng limit lớn (200) + tự phân trang qua `total` trả về để chắc chắn
//      lấy hết mọi trận trong 1 lần quét, không chỉ trang đầu.
const PHALANG_API_BASE = process.env.PHALANG_API_BASE || 'https://api.plapi202624081158.com';
const PHALANG_SITE_ORIGIN = 'https://phalang.live';
const PHALANG_LIST_PAGE_SIZE = 200;
const PHALANG_LIST_MAX_PAGES = 5;

const SPORT_INFO = {
  football: { name: 'BÓNG ĐÁ', icon: 'fa-futbol' },
  volleyball: { name: 'BÓNG CHUYỀN', icon: 'fa-volleyball' },
  basketball: { name: 'BÓNG RỔ', icon: 'fa-basketball' },
  tennis: { name: 'TENNIS', icon: 'fa-baseball-bat-ball' },
  badminton: { name: 'CẦU LÔNG', icon: 'fa-shuttlecock' }
};

// desc trả về dạng chữ hoa tiếng Anh (FOOTBALL, VOLLEYBALL...) — map thẳng
// sang key sportAliases đã có trong playerGet.js (normalizeSport).
function mapSport(desc) {
  return String(desc || 'football').toLowerCase();
}

class PhalangService {
  constructor() {
    this.client = createHttpClient({
      baseURL: PHALANG_API_BASE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: PHALANG_SITE_ORIGIN,
        Referer: `${PHALANG_SITE_ORIGIN}/trang-chu`
      }
    });
  }

  detectCdn(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('digitalcdn')) return 'DIGITALCDN';
    if (u.includes('cloudflare')) return 'CLOUDFLARE';
    return 'HLS';
  }

  normalizeMatch(m) {
    const sport = mapSport(m.desc);
    const sportInfo = SPORT_INFO[sport] || { name: String(m.desc || 'BÓNG ĐÁ').toUpperCase(), icon: 'fa-futbol' };

    // FIX (18/09/2026 — "thời gian các trận bị lệch 7h"): start_date trả về
    // dạng "YYYY-MM-DDTHH:mm:ss" KHÔNG có múi giờ. Lần trước ĐOÁN đây là giờ
    // Việt Nam sẵn (gán '+07:00') — SAI, thực tế API trả giờ UTC, cộng thêm
    // +07:00 khi hiển thị (qua timeZone: 'Asia/Ho_Chi_Minh' bên dưới) làm giờ
    // bị cộng dồn 2 lần -> lệch hẳn 7 tiếng so với giờ thật. Đổi lại đúng như
    // ghi chú đã lường trước: coi start_date là UTC (gán 'Z') rồi mới quy đổi
    // sang giờ VN lúc format.
    const matchDate = m.start_date ? new Date(`${m.start_date}Z`) : new Date();
    const timeStr = matchDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
    const dateStr = matchDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const dd = String(matchDate.getDate()).padStart(2, '0');
    const mm = String(matchDate.getMonth() + 1).padStart(2, '0');

    const homeName = m.team_1 || 'Home';
    const awayName = m.team_2 || 'Away';
    const isLive = !!m.is_live;

    return {
      matchId: `pl_${m.id}`,
      originalId: m.id,
      streamKey: m.stream_key,
      source: 'phalang',
      sport,
      sportName: sportInfo.name,
      sportIcon: sportInfo.icon,
      title: m.title || `${homeName} - ${awayName}`,
      competition: { name: m.league || '', logo: '', icon: '' },
      homeTeam: { name: homeName, logo: m.team_1_logo || '' },
      awayTeam: { name: awayName, logo: m.team_2_logo || '' },
      score: { home: m.team_1_score ?? 0, away: m.team_2_score ?? 0 },
      status: {
        isLive,
        isFinished: false,
        isHalfTime: false,
        isUpcoming: !isLive,
        name: isLive ? 'LIVE' : 'Sắp diễn ra',
        text: isLive ? 'LIVE' : 'Sắp diễn ra',
        elapsedTime: '',
        minutes: ''
      },
      matchTime: matchDate.getTime(),
      matchTimeTimestamp: matchDate.getTime(),
      timeFormatted: `${timeStr} - ${dd}/${mm}`,
      dateStr,
      timeStr,
      isHot: !!m.is_hot,
      // source_live đôi khi đã có sẵn link .m3u8 thẳng trong danh sách (trận
      // chưa live) — giữ lại làm phương án nhanh, nhưng KHÔNG đảm bảo đúng
      // cho trận đang live thật (đã thấy trường hợp is_live=true mà
      // source_live vẫn null) — trận live luôn phải gọi getStreamLinks().
      streamUrl: m.source_live || '',
      commentators: m.source_live
        ? [{ id: `${m.id}_0`, name: m.blv || 'Server 1', avatar: '', streamUrl: m.source_live, isLive: true, cdn: this.detectCdn(m.source_live) }]
        : [],
      stream: { liveUrl: '', streamerName: m.blv || null, streamerAvatar: null },
      odds: null
    };
  }

  mapStreams(match) {
    return (match?.commentators || []).map((c) => ({
      id: c.id,
      streamerId: c.id,
      name: c.name,
      streamerName: c.name,
      avatar: c.avatar,
      streamerAvatar: c.avatar,
      link: c.streamUrl,
      m3u8Url: c.streamUrl,
      playUrl: c.streamUrl,
      format: 'hls',
      cdn: c.cdn,
      quality: 'HD'
    }));
  }

  /** Body giống hệt trình duyệt thật gửi lên /matches/graph (xem FIX 18/09/2026
   *  ở đầu file) — queries rỗng = không lọc theo is_hot/… như tab "Hot" trên
   *  web, lấy TOÀN BỘ trận để tự lọc live/upcoming ở code bên dưới. */
  buildListBody(page) {
    return {
      limit: PHALANG_LIST_PAGE_SIZE,
      page,
      order_asc: 'start_date',
      queries: []
    };
  }

  async fetchList() {
    try {
      const all = [];
      let total = Infinity;

      for (let page = 1; page <= PHALANG_LIST_MAX_PAGES && all.length < total; page++) {
        const { data } = await this.client.post(
          '/matches/graph',
          this.buildListBody(page),
          { params: { _t: Date.now() } }
        );
        const batch = Array.isArray(data?.data) ? data.data : [];
        total = Number.isFinite(data?.total) ? data.total : batch.length;
        all.push(...batch);
        // Trang cuối trả về ít hơn page size -> không còn dữ liệu, dừng sớm.
        if (batch.length < PHALANG_LIST_PAGE_SIZE) break;
      }

      return all;
    } catch (error) {
      console.error('Error fetching Phalang list:', error.message);
      return [];
    }
  }

  /** Interface giống các nguồn khác: gộp mọi type thành 1 danh sách, tự lọc theo tab ở code. */
  async getAllMatchesByTab(tab) {
    const raw = await this.fetchList();
    const all = raw.map((m) => this.normalizeMatch(m));

    let matches = all;
    if (tab === 'live') matches = all.filter((m) => m.status.isLive);
    else if (tab === 'upcoming') matches = all.filter((m) => m.status.isUpcoming);

    return { matches, hasMore: false, totalCount: matches.length };
  }

  /** hd_1, hd_2, ... (thứ tự không đảm bảo) + source (nếu có) -> danh sách server, dedupe. */
  extractStreamUrls(detail) {
    if (!detail) return [];
    const urls = [];
    const hdKeys = Object.keys(detail)
      .filter((k) => /^hd_\d+$/i.test(k))
      .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]));
    for (const k of hdKeys) {
      if (detail[k]) urls.push(detail[k]);
    }
    if (detail.source && !urls.includes(detail.source)) urls.push(detail.source);
    return [...new Set(urls)].filter(Boolean);
  }

  async getStreamLinks(matchId, blvName) {
    const cleanId = String(matchId || '').replace(/^pl_/, '');
    if (!cleanId) return [];
    try {
      const { data } = await this.client.get(`/match/${cleanId}/live`, { params: { _t: Date.now() } });
      const urls = this.extractStreamUrls(data);
      return urls.map((url, i) => ({
        id: `${cleanId}_${i}`,
        streamerId: `${cleanId}_${i}`,
        name: blvName ? `${blvName} (Server ${i + 1})` : `Server ${i + 1}`,
        streamerName: blvName ? `${blvName} (Server ${i + 1})` : `Server ${i + 1}`,
        link: url,
        m3u8Url: url,
        playUrl: url,
        format: 'hls',
        cdn: this.detectCdn(url),
        quality: 'HD'
      }));
    } catch (error) {
      // 404 EntityNotFound = trận chưa có link phát (chưa live/nguồn chưa
      // cập nhật) — phản hồi HỢP LỆ của API, không phải lỗi thật, không log
      // ồn console mỗi lần quét. Chỉ log các lỗi khác (mạng, 5xx...).
      if (error.response?.status !== 404) {
        console.error('Error fetching Phalang stream links:', error.message);
      }
      return [];
    }
  }
}

const phalangService = new PhalangService();
export default phalangService;
