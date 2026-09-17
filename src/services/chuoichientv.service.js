import { createHttpClient } from '@/src/utils/httpClient';
import { slugifyVi } from '@/src/utils/slug';

// Chuối Chiên TV — domain chính chuoichientv.link, frontend thật chạy trên
// live05.chuoichientv.me. API nằm trên domain RIÊNG (api-v2.chuoichientv.net)
// — đã tự kiểm tra: gọi thẳng bằng HTTP thường (không cần trình duyệt
// headless), KHÔNG bị Cloudflare chặn, KHÔNG cần token cho các endpoint đọc
// trận đấu (endpoint /chat/history mới cần Bearer token, không liên quan).
// Nhờ vậy nguồn này đơn giản hơn hẳn Khán Đài (không cần
// browserFetch/puppeteer gì cả).
const CHUOICHIENTV_API_BASE = process.env.CHUOICHIENTV_API_BASE || 'https://api-v2.chuoichientv.net/v2';

const SPORT_INFO = {
  football: { name: 'BÓNG ĐÁ', icon: 'fa-futbol' },
  volleyball: { name: 'BÓNG CHUYỀN', icon: 'fa-volleyball' },
  basketball: { name: 'BÓNG RỔ', icon: 'fa-basketball' },
  tennis: { name: 'TENNIS', icon: 'fa-baseball-bat-ball' }
};

const NOT_STARTED_STATUSES = new Set(['scheduled', 'not_started', 'upcoming', 'pending', 'ns']);
const FINISHED_STATUSES = new Set(['finished', 'ended', 'ft', 'full_time', 'cancelled', 'canceled', 'postponed', 'abandoned']);

class ChuoiChienTvService {
  constructor() {
    this.client = createHttpClient({
      baseURL: CHUOICHIENTV_API_BASE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://live05.chuoichientv.me/'
      }
    });
    // FIX (17/09/2026 — "các trận đang live nguồn Chuối Chiên không xem
    // được"): findRawMatch() bên dưới gọi 1 endpoint chi tiết RIÊNG
    // (/matches/external/{id}) để lấy lại link stream cho 1 trận — nếu
    // endpoint đó lỗi/timeout/đổi schema thì trận live mất sạch nút ▶, dù
    // list `/matches?type=live` NGAY TRƯỚC ĐÓ đã trả sẵn đầy đủ BLV/link
    // rồi (xem normalizeMatch — commentators dựng thẳng từ m.blvs trong
    // response danh sách). Giữ 1 cache nhỏ trong bộ nhớ (raw match theo
    // externalId, ghi đè mỗi lần fetchList) làm phương án DỰ PHÒNG: nếu gọi
    // endpoint chi tiết thất bại, dùng lại đúng dữ liệu vừa quét được thay
    // vì trả về rỗng.
    this._rawMatchCache = new Map();
  }

  detectCdn(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('edgemaxcdn')) return 'EDGEMAX';
    if (u.includes('hdplaylink')) return 'HDPLAYLINK';
    if (u.includes('cloudflare')) return 'CLOUDFLARE';
    return 'HLS';
  }

  normalizeMatch(m) {
    const rawStatus = String(m.status || '').toLowerCase();
    const isNotStarted = NOT_STARTED_STATUSES.has(rawStatus);
    const isFinished = FINISHED_STATUSES.has(rawStatus);
    const isLive = !!rawStatus && !isNotStarted && !isFinished;

    const sportInfo = SPORT_INFO[m.sport] || { name: String(m.sport || 'BÓNG ĐÁ').toUpperCase(), icon: 'fa-futbol' };

    const matchDate = m.matchTime ? new Date(m.matchTime) : new Date();
    const timeStr = matchDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
    const dateStr = matchDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const dd = String(matchDate.getDate()).padStart(2, '0');
    const mm = String(matchDate.getMonth() + 1).padStart(2, '0');

    const homeName = m.teams?.home?.name || 'Home';
    const awayName = m.teams?.away?.name || 'Away';
    const externalId = m.externalId || m._id;
    const slug = m.slug || `${slugifyVi(homeName)}-vs-${slugifyVi(awayName)}`;

    // Mỗi BLV có thể có nhiều chất lượng (HD/FHD...) — tách thành từng lựa
    // chọn stream riêng, y hệt cách các nguồn khác liệt kê nhiều server.
    const commentators = (m.blvs || []).flatMap((b) => (b.streams || []).map((s) => ({
      id: `${b._id || b.username}_${s.label || ''}`,
      name: s.label ? `${b.name} (${s.label})` : b.name,
      avatar: b.avatar || '',
      streamUrl: s.url,
      isLive: true,
      cdn: this.detectCdn(s.url)
    }))).filter((c) => c.streamUrl);

    return {
      matchId: `cct_${externalId}`,
      originalId: externalId,
      slug,
      source: 'chuoichientv',
      sport: m.sport || 'football',
      sportName: sportInfo.name,
      sportIcon: sportInfo.icon,
      competition: {
        name: m.league?.name || '',
        logo: m.league?.logo || '',
        icon: m.league?.logo || ''
      },
      homeTeam: { name: homeName, logo: m.teams?.home?.logo || '' },
      awayTeam: { name: awayName, logo: m.teams?.away?.logo || '' },
      score: {
        home: m.score?.home ?? 0,
        away: m.score?.away ?? 0
      },
      status: {
        isLive,
        isFinished,
        isHalfTime: false,
        isUpcoming: !isLive && !isFinished,
        name: isLive ? 'LIVE' : (isFinished ? 'FT' : 'Sắp diễn ra'),
        text: isLive ? 'LIVE' : (isFinished ? 'Kết thúc' : 'Sắp diễn ra'),
        elapsedTime: '',
        minutes: ''
      },
      stats: {
        halfTimeScore: `${m.score?.halftime?.home ?? 0}-${m.score?.halftime?.away ?? 0}`,
        corners: '0-0',
        yellowCards: '0-0'
      },
      matchTime: matchDate.getTime(),
      matchTimeTimestamp: matchDate.getTime(),
      timeFormatted: `${timeStr} - ${dd}/${mm}`,
      dateStr,
      timeStr,
      isHot: !!m.isHot,
      commentators,
      streamers: commentators,
      streamUrl: commentators[0]?.streamUrl || '',
      stream: {
        liveUrl: `https://live05.chuoichientv.me/live/${externalId}/${slug}`,
        streamerName: commentators[0]?.name || null,
        streamerAvatar: commentators[0]?.avatar || null
      },
      odds: null
    };
  }

  mapStreams(match) {
    return (match?.commentators || []).map((c) => {
      const isFlv = /\.flv(\?|$)/i.test(c.streamUrl);
      return {
        id: c.id,
        streamerId: c.id,
        name: c.name,
        streamerName: c.name,
        avatar: c.avatar,
        streamerAvatar: c.avatar,
        link: c.streamUrl,
        m3u8Url: c.streamUrl,
        playUrl: c.streamUrl,
        format: isFlv ? 'flv' : 'hls',
        cdn: c.cdn,
        quality: c.name.includes('FHD') ? 'FHD' : 'HD'
      };
    });
  }

  async fetchList(type, page = 1, limit = 500) {
    try {
      const { data } = await this.client.get('/matches', { params: { type, page, limit, _t: Date.now() } });
      const list = data?.matches || [];
      // Ghi lại từng trận thô vào cache dự phòng cho findRawMatch() — xem
      // chú thích FIX 17/09/2026 ở constructor.
      for (const m of list) {
        const key = m?.externalId || m?._id;
        if (key) this._rawMatchCache.set(String(key), m);
      }
      return list;
    } catch (error) {
      console.error(`Error fetching ChuoiChienTV list (type=${type}):`, error.message);
      return [];
    }
  }

  async getAllMatches() {
    const raw = await this.fetchList('live');
    return raw.map((m) => this.normalizeMatch(m));
  }

  /** Interface giống các nguồn khác: gộp mọi type thành 1 danh sách, tự lọc theo tab ở code. */
  async getAllMatchesByTab(tab) {
    const [liveRaw, upcomingRaw] = await Promise.all([
      this.fetchList('live'),
      this.fetchList('upcoming')
    ]);

    const seen = new Set();
    const all = [];
    for (const m of [...liveRaw, ...upcomingRaw]) {
      const key = m.externalId || m._id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push(this.normalizeMatch(m));
    }

    let matches = all;
    if (tab === 'live') matches = all.filter((m) => m.status.isLive);
    else if (tab === 'upcoming') matches = all.filter((m) => m.status.isUpcoming);

    return { matches, hasMore: false, totalCount: matches.length };
  }

  async findRawMatch(matchId) {
    const cleanId = String(matchId || '').replace(/^cct_/, '');
    if (!cleanId) return null;
    try {
      const { data } = await this.client.get(`/matches/external/${cleanId}`, { params: { _t: Date.now() } });
      const detail = data?.data || null;
      if (detail) return detail;
    } catch (error) {
      console.error('Error fetching ChuoiChienTV match detail:', error.message);
    }
    // FIX 17/09/2026: endpoint chi tiết lỗi/rỗng -> dùng lại bản ghi thô đã
    // có sẵn từ lần quét danh sách gần nhất (xem cache trong fetchList())
    // thay vì trả về null (mất nút ▶ dù dữ liệu cần thiết vốn đã có).
    return this._rawMatchCache.get(cleanId) || null;
  }

  async getStreamLinks(matchId) {
    const raw = await this.findRawMatch(matchId);
    if (!raw) return [];
    return this.mapStreams(this.normalizeMatch(raw));
  }

  async getMatchDetail(matchId) {
    const raw = await this.findRawMatch(matchId);
    if (!raw) return null;
    const match = this.normalizeMatch(raw);
    return { match, streams: this.mapStreams(match), matchId: match.matchId };
  }

  async getMatchLiveSnapshot(matchId) {
    const raw = await this.findRawMatch(matchId);
    return raw ? this.normalizeMatch(raw) : null;
  }
}

const chuoichientvService = new ChuoiChienTvService();
export default chuoichientvService;
