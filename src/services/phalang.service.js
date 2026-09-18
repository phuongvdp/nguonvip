import { createHttpClient } from '@/src/utils/httpClient';

// Phá Làng TV — domain hiển thị phalang.tv (React/Vite SPA, không lộ API
// trong HTML tĩnh). API thật nằm trên domain RIÊNG do người dùng cung cấp
// qua tab Network của trình duyệt:
//   - GET  /matches/graph        -> { data: [...], total }  (danh sách trận)
//   - GET  /match/{id}/live      -> { type, source, hd_1, hd_2, ... } (link phát)
// Gọi thẳng bằng axios KHÔNG có Referer/User-Agent trình duyệt bị chặn bot
// (đã tự kiểm tra, lỗi bot-detection) — vì vậy bắt buộc phải giả User-Agent +
// Referer giống trình duyệt thật, y hệt cách chuoichientv.service.js làm.
// CHƯA XÁC NHẬN được việc set 2 header này có đủ để vượt qua bot-detection
// khi chạy trên IP máy chủ Vercel hay không (khác NAT với máy người dùng) —
// nếu vẫn bị chặn, xem khandaitv.service.js để biết cách chuyển sang
// browserFetch (Chromium headless) làm phương án dự phòng.
const PHALANG_API_BASE = process.env.PHALANG_API_BASE || 'https://api.plapi202624081158.com';

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
        Referer: 'https://phalang.tv/'
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

    // FIX GHI CHÚ (18/09/2026): start_date trả về dạng "YYYY-MM-DDTHH:mm:ss"
    // KHÔNG có múi giờ. Coi đây là giờ Việt Nam (+07:00) sẵn — trang hướng
    // tới người xem VN, giống cách hiển thị trực tiếp trên site gốc. Nếu
    // sau này phát hiện giờ hiển thị lệch 7 tiếng so với thực tế, đổi lại
    // thành new Date(m.start_date + 'Z') (tức API trả UTC) thay vì '+07:00'.
    const matchDate = m.start_date ? new Date(`${m.start_date}+07:00`) : new Date();
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

  async fetchList() {
    try {
      const { data } = await this.client.get('/matches/graph', { params: { _t: Date.now() } });
      return Array.isArray(data?.data) ? data.data : [];
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
      console.error('Error fetching Phalang stream links:', error.message);
      return [];
    }
  }
}

const phalangService = new PhalangService();
export default phalangService;
