import { createHttpClient } from '@/src/utils/httpClient';
import { slugifyVi } from '@/src/utils/slug';
import { fetchRenderedHtml } from '@/src/utils/browserFetch';

// Trang web: đổi tên miền tuỳ ý qua GIOVANG_DOMAIN (không cần sửa code).
// API JSON danh sách trận lại nằm ở 1 domain CDN/backend riêng dùng chung
// bởi nhiều site cùng plugin "wp-football-livestream" — xác nhận qua
// DevTools ngày 13/08/2026: có 2 file JSON tĩnh riêng biệt, không cần
// cookie/auth, không bị chặn bot (khác hẳn VSC9):
//   - live.json: CHỈ chứa trận đang live (status_code LIVE/1H/2H/HT/...)
//   - all.json : chứa MỌI trận (NS chưa đá, FT kết thúc, PEND bị hoãn...,
//     và cả LIVE) — đây mới là nguồn cho tab "sắp diễn ra"/"hôm nay"/...
const BASE_URL = process.env.GIOVANG_DOMAIN || 'https://giovang.city';
const LIVE_API_HOST = process.env.GIOVANG_LIVE_API_HOST || 'https://live-api.keonhacaitp.one';
const LIVE_JSON_PATH = '/storage/livestream/live.json';
const ALL_JSON_PATH = '/storage/livestream/all.json';

// Các status_code mà site coi là "đang diễn ra" (xác nhận từ script inline
// của trang: LIVE_STATUS = ['1H','2H','HT','PEN','LIVE','ET']).
const LIVE_STATUS_CODES = ['1H', '2H', 'HT', 'PEN', 'LIVE', 'ET'];

const SPORT_TYPE_MAP = {
  football: 'football',
  bongda: 'football',
  basketball: 'basketball',
  bongro: 'basketball',
  volleyball: 'volleyball',
  bongchuyen: 'volleyball',
  badminton: 'badminton',
  caulong: 'badminton',
  tennis: 'tennis',
};

function cleanUrl(str) {
  return String(str || '').replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
}

class GiovangService {
  constructor() {
    this.client = createHttpClient({
      timeout: 15000,
      headers: {
        Accept: '*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
    });
    this.cache = new Map();
    this.lastDiagnostics = null;
  }

  async cached(key, loader, ttl = 20 * 1000) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await loader();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  buildDetailUrl(m) {
    // Xác nhận thật từ URL trận đấu thật (13/08/2026): dạng
    // "truc-tiep-{home}-vs-{away}-{dd}-{mm}-{id}" — CHỈ ngày-tháng, không
    // có năm, khớp với field day_month ("13/08") chứ không phải date đầy đủ.
    const home = slugifyVi(m?.teams?.home?.name);
    const away = slugifyVi(m?.teams?.away?.name);
    const dayMonth = String(m?.day_month || '').replace('/', '-');
    const slug = [home, away ? `vs-${away}` : '', dayMonth, m?.id]
      .filter(Boolean)
      .join('-')
      .replace(/-+/g, '-');
    return `${BASE_URL}/truc-tiep-${slug}`;
  }

  normalizeMatch(m) {
    const statusCode = String(m.status_code || '').toUpperCase();
    const isLive = LIVE_STATUS_CODES.includes(statusCode) || m.is_live === true;
    const isFinished = statusCode === 'FT';
    const timestampMs = (m.time_start || 0) * 1000;
    const matchDate = timestampMs ? new Date(timestampMs) : new Date();
    const timeStr = m.time ? String(m.time).slice(0, 5) : matchDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
    const dateStr = matchDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const elapsed = statusCode === 'HT' ? 'HT' : (m.live_time ? `${m.live_time}` : '');

    const detailUrl = this.buildDetailUrl(m);
    const sportSlug = SPORT_TYPE_MAP[String(m.type || '').toLowerCase()] || String(m.type || 'football');

    return {
      matchId: `giovang_${m.id}`,
      originalId: m.id,
      source: 'giovang',
      sport: sportSlug,
      competition: {
        name: m.league?.title || '',
        logo: cleanUrl(m.league?.icon),
        icon: cleanUrl(m.league?.icon),
      },
      homeTeam: {
        name: (m.teams?.home?.name || 'Home').trim(),
        logo: cleanUrl(m.teams?.home?.logo),
      },
      awayTeam: {
        name: (m.teams?.away?.name || 'Away').trim(),
        logo: cleanUrl(m.teams?.away?.logo),
      },
      score: {
        home: m.score?.fulltime?.home ?? 0,
        away: m.score?.fulltime?.away ?? 0,
      },
      status: {
        isLive,
        isFinished,
        isHalfTime: statusCode === 'HT',
        isUpcoming: !isLive && !isFinished,
        name: isLive ? (m.status || 'LIVE') : (isFinished ? 'FT' : 'Sắp diễn ra'),
        text: isLive ? (m.status || 'LIVE') : (isFinished ? 'Kết thúc' : 'Sắp diễn ra'),
        elapsedTime: isLive && elapsed ? (/^\d+$/.test(elapsed) ? `${elapsed}'` : elapsed) : '',
        minutes: elapsed,
      },
      matchTime: timestampMs,
      matchTimeTimestamp: timestampMs,
      timeFormatted: `${timeStr} - ${m.day_month || ''}`,
      dateStr,
      timeStr,
      isHot: !!m.is_hot,
      commentators: (m.blv || []).map((key) => ({ id: key, name: key, streamUrl: '' })),
      streamers: [],
      stream: {
        liveUrl: detailUrl,
        matchId: m.id,
      },
    };
  }

  async fetchJson(path, label) {
    const url = `${LIVE_API_HOST}${path}?t=${Date.now()}`;
    const response = await this.client.get(url);
    const diag = { url, status: response.status, contentType: response.headers?.['content-type'] || '' };
    const list = response.data?.response;
    if (!Array.isArray(list)) {
      console.warn(`[giovang] ${label} trả về định dạng không đúng — không tìm thấy field "response" là mảng`);
      diag.error = 'invalid_format';
      this.lastDiagnostics = { ...this.lastDiagnostics, [label]: diag };
      return [];
    }
    diag.rawRecordsFound = list.length;
    this.lastDiagnostics = { ...this.lastDiagnostics, [label]: diag };
    return list.map((m) => this.normalizeMatch(m));
  }

  /**
   * live.json chỉ chứa trận đang live (cập nhật real-time, đáng tin nhất
   * cho trạng thái live) — all.json chứa MỌI trận (NS/FT/PEND/LIVE...) làm
   * nguồn cho các tab còn lại. Gộp 2 nguồn, ưu tiên bản ghi từ live.json
   * khi trùng id vì nó cập nhật sát thời gian thực hơn.
   */
  async fetchAllMatches() {
    const [liveList, allList] = await Promise.all([
      this.fetchJson(LIVE_JSON_PATH, 'liveJson').catch((err) => {
        this.lastDiagnostics = { ...this.lastDiagnostics, liveJson: { error: err.message } };
        console.warn('[giovang] fetchJson(live.json) lỗi:', err.message);
        return [];
      }),
      this.fetchJson(ALL_JSON_PATH, 'allJson').catch((err) => {
        this.lastDiagnostics = { ...this.lastDiagnostics, allJson: { error: err.message } };
        console.warn('[giovang] fetchJson(all.json) lỗi:', err.message);
        return [];
      }),
    ]);
    const merged = new Map();
    for (const m of allList) merged.set(m.originalId, m);
    for (const m of liveList) merged.set(m.originalId, m); // live.json đè lên, ưu tiên real-time
    return [...merged.values()];
  }

  async getMatchesByTab(tab = 'live') {
    return this.cached(`matches:${tab}`, async () => {
      const all = await this.fetchAllMatches();

      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
      const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

      let matches;
      if (tab === 'live') matches = all.filter((m) => m.status.isLive);
      else if (tab === 'upcoming') matches = all.filter((m) => m.status.isUpcoming);
      else if (tab === 'hot') matches = all.filter((m) => m.isHot);
      else if (tab === 'today') matches = all.filter((m) => m.dateStr === todayStr);
      else if (tab === 'tomorrow') matches = all.filter((m) => m.dateStr === tomorrowStr);
      else matches = all;

      return { matches, hasMore: false, totalCount: matches.length };
    });
  }

  /** all.json/live.json trả về mọi trận trong 1 lần gọi — không có phân trang thật. */
  async getAllMatchesByTab(tab = 'live') {
    return this.getMatchesByTab(tab);
  }

  extractHlsUrls(text) {
    const input = cleanUrl(text);
    const found = input.match(/https?:[^'"\s<>\\]+?\.m3u8(?:\?[^'"\s<>\\]*)?/gi) || [];
    return [...new Set(found.map(cleanUrl))];
  }

  async getMatchDetail(idOrUrl) {
    const rawId = String(idOrUrl || '').replace(/^giovang_/, '');
    const detailUrl = /^https?:\/\//i.test(rawId) ? rawId : null;

    let targetUrl = detailUrl;
    if (!targetUrl) {
      // Không có URL đầy đủ (gọi bằng id trần) — thử suy luận lại từ cache
      // danh sách gần nhất để lấy đúng slug thật thay vì đoán.
      const cachedLive = this.cache.get('matches:live')?.value?.matches || [];
      const cachedAll = this.cache.get('matches:all')?.value?.matches || [];
      const found = [...cachedLive, ...cachedAll].find((m) => m.originalId === rawId || m.matchId === `giovang_${rawId}`);
      targetUrl = found?.stream?.liveUrl || `${BASE_URL}/?livestream=${encodeURIComponent(rawId)}`;
    }

    let html = '';
    let hlsUrls = [];

    // Trang chi tiết render sẵn phía server (WordPress, không phải SPA như
    // VSC9) — thử HTTP thường trước, nhẹ và nhanh hơn hẳn mở trình duyệt.
    try {
      const response = await this.client.get(targetUrl);
      this.lastDiagnostics = { ...this.lastDiagnostics, detailHttp: { status: response.status, htmlLength: String(response.data || '').length } };
      if (response.status < 400) {
        html = response.data;
        hlsUrls = this.extractHlsUrls(html);
      }
    } catch (err) {
      this.lastDiagnostics = { ...this.lastDiagnostics, detailHttp: { error: err.message } };
      console.warn('[giovang] getMatchDetail HTTP lỗi:', err.message);
    }

    // Không tìm thấy link m3u8 nào trong HTML thô (trận có thể lazy-load
    // player bằng JS) → dự phòng mở bằng trình duyệt headless để đọc DOM
    // đã render đầy đủ.
    if (!hlsUrls.length) {
      try {
        const rendered = await fetchRenderedHtml(targetUrl, {
          timeoutMs: 25000,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        });
        html = rendered.html || html;
        hlsUrls = this.extractHlsUrls(html);
        this.lastDiagnostics = { ...this.lastDiagnostics, detailBrowser: { status: rendered.status, htmlLength: html.length, foundAfterBrowser: hlsUrls.length } };
      } catch (err) {
        this.lastDiagnostics = { ...this.lastDiagnostics, detailBrowser: { error: err.message } };
        console.warn('[giovang] getMatchDetail fetchRenderedHtml lỗi:', err.message);
      }
    }

    const streams = hlsUrls.map((url, index) => ({
      id: `giovang_${rawId}_${index + 1}`,
      streamerName: `Giovang ${index + 1}`,
      name: `Giovang ${index + 1}`,
      m3u8Url: url,
      playUrl: url,
      format: 'hls',
    }));

    return {
      matchId: `giovang_${rawId}`,
      match: { matchId: `giovang_${rawId}`, source: 'giovang', stream: { liveUrl: targetUrl, matchId: rawId } },
      streams,
    };
  }
}

const giovangService = new GiovangService();
export default giovangService;
