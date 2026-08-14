import * as cheerio from 'cheerio';
import { createHttpClient } from '@/src/utils/httpClient';
import { fetchRenderedHtml } from '@/src/utils/browserFetch';

// VSC9 renders match data server-side, while the player attaches the current
// HLS URL dynamically.  Keep the match page as the durable identifier: an HLS
// URL is short-lived and must never be stored as a permanent source URL.
const BASE_URL = process.env.VSC9_DOMAIN || process.env.VSC9_BASE_URL || 'https://vsc9.vip';

const cleanUrl = (value = '') => String(value)
  .replace(/\\u0026/g, '&').replace(/\\u002F/g, '/').replace(/\\\//g, '/')
  .replace(/&amp;/g, '&').replace(/^['\"]|['\"]$/g, '');

const absoluteUrl = (value = '') => {
  const url = cleanUrl(value);
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
};

const titleTeams = (slug = '') => {
  const plain = String(slug).replace(/\?.*$/, '').replace(/^.*\/truc-tiep\//, '');
  const name = plain.replace(/-[a-z0-9]{12,}$/i, '').replace(/-/g, ' ').trim();
  const parts = name.split(/\s+vs\s+/i);
  return { home: parts[0] || 'Đội nhà', away: parts[1] || 'Đội khách' };
};

// Header set lấy đúng như trình duyệt Chrome thật (kèm sec-ch-ua/sec-fetch-*) —
// nhiều site chặn bot chỉ dựa vào việc thiếu các header này, không cần giải
// JS challenge thật sự.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
};

class Vsc9Service {
  constructor() {
    this.baseUrl = BASE_URL;
    this.client = createHttpClient({
      baseURL: BASE_URL,
      timeout: 15000,
      // Không throw ở 4xx/5xx — để tự đọc status/body và fallback thay vì
      // rớt thẳng vào catch mà không biết site trả về gì (trang chặn bot
      // thường trả 200 kèm HTML "Just a moment..." hoặc 403/503).
      validateStatus: () => true,
      headers: {
        ...BROWSER_HEADERS,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${BASE_URL}/`,
      },
    });
    this.cache = new Map();
    this.cookieJar = '';
    this.cookieAt = 0;
    // Lưu lại chẩn đoán của lần chạy gần nhất để trả kèm trong response khi
    // rỗng — đỡ phải mò log Vercel mới biết đang chặn ở bước nào.
    this.lastDiagnostics = null;
  }

  async cached(key, loader, ttl = 90 * 1000) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await loader();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  // Nhiều site chặn bot chỉ cấp cookie hợp lệ sau khi "ghé" trang chủ như
  // trình duyệt thật (GET / trước khi gọi API/JSON). Mở lại cookie này mỗi
  // ~10 phút để không bị gọi API bằng session đã hết hạn.
  async warmup() {
    if (this.cookieJar && Date.now() - this.cookieAt < 10 * 60 * 1000) return this.cookieJar;
    try {
      const res = await this.client.get('/', { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
      const setCookie = res.headers?.['set-cookie'] || [];
      if (setCookie.length) {
        this.cookieJar = setCookie.map((c) => c.split(';')[0]).join('; ');
        this.cookieAt = Date.now();
      }
      if (res.status >= 400) {
        console.warn(`[vsc9] warmup GET / trả về status ${res.status} — site có thể đang chặn bot`);
      }
    } catch (err) {
      console.warn('[vsc9] warmup thất bại:', err.message);
    }
    return this.cookieJar;
  }

  parseMatches(html) {
    const $ = cheerio.load(html || '');
    const seen = new Set();
    const matches = [];

    $('a[href*="/truc-tiep/"]').each((_, element) => {
      const href = $(element).attr('href') || '';
      const liveUrl = absoluteUrl(href);
      const matchId = new URL(liveUrl).searchParams.get('liveId') || href.match(/[?&]liveId=([^&#]+)/)?.[1] || '';
      if (!liveUrl || !matchId || seen.has(matchId)) return;
      seen.add(matchId);

      const card = $(element).closest('article, li, [class*=match], [class*=Match], div').first();
      const text = card.text().replace(/\s+/g, ' ').trim();
      const { home, away } = titleTeams(href);
      const live = /đang phát|live|trực tiếp/i.test(text);
      const upcoming = /chưa phát|\bvs\b/i.test(text) && !live;
      matches.push({
        matchId: `vsc9_${matchId}`,
        source: 'vsc9',
        title: `${home} vs ${away}`,
        homeTeam: { name: home },
        awayTeam: { name: away },
        competition: { name: text.match(/(?:League|Cup|Championship|Liga|Premier)[^\n]*/i)?.[0]?.trim() || 'VSC9' },
        sport: 'football',
        sportCategory: 'football',
        matchTimeTimestamp: Date.now(),
        status: { isLive: live, isUpcoming: upcoming, isFinished: false, name: live ? 'LIVE' : 'NS', text: live ? 'Đang phát sóng' : 'Sắp diễn ra' },
        stream: { liveUrl, matchId },
        liveUrl,
      });
    });
    return matches;
  }

  valueOf(record, keys) {
    for (const key of keys) {
      const value = record?.[key];
      if (value !== undefined && value !== null && value !== '') {
        if (typeof value === 'object') return value.name || value.title || value.shortName || '';
        return value;
      }
    }
    return '';
  }

  collectApiMatches(payload) {
    const candidates = [];
    const visited = new Set();
    const visit = (value) => {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) return value.forEach(visit);
      const home = this.valueOf(value, ['homeTeam', 'home_team', 'homeName', 'home_name', 'team1', 'team_1']);
      const away = this.valueOf(value, ['awayTeam', 'away_team', 'awayName', 'away_name', 'team2', 'team_2']);
      const id = this.valueOf(value, ['liveId', 'live_id', 'matchId', 'match_id', 'fixtureId', 'fixture_id', 'id']);
      if (home && away && id) candidates.push(value);
      Object.values(value).forEach(visit);
    };
    visit(payload);
    return candidates;
  }

  normalizeApiMatch(item) {
    const liveId = String(this.valueOf(item, ['liveId', 'live_id', 'matchId', 'match_id', 'fixtureId', 'fixture_id', 'id']));
    const home = String(this.valueOf(item, ['homeTeam', 'home_team', 'homeName', 'home_name', 'team1', 'team_1']) || 'Đội nhà');
    const away = String(this.valueOf(item, ['awayTeam', 'away_team', 'awayName', 'away_name', 'team2', 'team_2']) || 'Đội khách');
    const slug = String(this.valueOf(item, ['slug', 'matchSlug', 'match_slug', 'seoSlug', 'seo_slug']));
    const competition = String(this.valueOf(item, ['leagueName', 'league_name', 'league', 'competitionName', 'competition_name', 'tournamentName']) || 'VSC9');
    const statusText = String(this.valueOf(item, ['statusText', 'status_text', 'status', 'matchStatus']) || 'LIVE');
    const isLive = /live|đang phát|playing|in.?play/i.test(statusText) || Number(this.valueOf(item, ['status', 'matchStatus'])) === 2;
    const liveUrl = slug
      ? `${BASE_URL}/truc-tiep/${slug}?liveId=${encodeURIComponent(liveId)}`
      : `${BASE_URL}/truc-tiep?liveId=${encodeURIComponent(liveId)}`;
    return {
      matchId: `vsc9_${liveId}`,
      source: 'vsc9',
      title: `${home} vs ${away}`,
      homeTeam: { name: home },
      awayTeam: { name: away },
      competition: { name: competition },
      sport: 'football',
      sportCategory: 'football',
      matchTimeTimestamp: Number(this.valueOf(item, ['startTime', 'start_time', 'kickoffTime', 'timestamp'])) || Date.now(),
      status: { isLive, isUpcoming: !isLive, isFinished: /finish|ft|ended/i.test(statusText), name: isLive ? 'LIVE' : 'NS', text: statusText },
      stream: { liveUrl, matchId: liveId },
      liveUrl,
    };
  }

  // Trang bị chặn bot thường trả 200 kèm HTML "Just a moment..."/captcha
  // thay vì JSON thật — check content-type/status thay vì chỉ tin response.data.
  looksBlocked(response) {
    if (!response) return true;
    if (response.status >= 400) return true;
    const ct = String(response.headers?.['content-type'] || '');
    if (ct.includes('text/html')) return true; // API JSON thật không bao giờ trả HTML
    return false;
  }

  async fetchViaApi(cookie) {
    // Confirmed from VSC9 Network: POST /api/home, JSON { type: 1 }.
    // type 1 returns the home/live feed.  The response shape is not stable,
    // so normalize any nested record that has two teams and a match id.
    const response = await this.client.post('/api/home', { type: 1 }, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: BASE_URL,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const diag = { status: response.status, contentType: response.headers?.['content-type'] || '' };
    if (this.looksBlocked(response)) {
      diag.blocked = true;
      console.warn(`[vsc9] POST /api/home bị chặn hoặc trả sai định dạng (status ${response.status}, content-type ${response.headers?.['content-type']})`);
      this.lastDiagnostics = { ...this.lastDiagnostics, api: diag };
      return [];
    }
    const all = this.collectApiMatches(response.data).map((item) => this.normalizeApiMatch(item));
    diag.rawRecordsFound = all.length;
    this.lastDiagnostics = { ...this.lastDiagnostics, api: diag };
    return [...new Map(all.map((match) => [match.matchId, match])).values()];
  }

  async fetchViaHtml(cookie) {
    const response = await this.client.get('/', {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const diag = { status: response.status };
    if (response.status >= 400) {
      console.warn(`[vsc9] GET / (fallback HTML) trả về status ${response.status}`);
      this.lastDiagnostics = { ...this.lastDiagnostics, html: diag };
      return [];
    }
    const parsed = this.parseMatches(response.data);
    diag.rawRecordsFound = parsed.length;
    diag.htmlLength = String(response.data || '').length;
    this.lastDiagnostics = { ...this.lastDiagnostics, html: diag };
    return parsed;
  }

  async fetchViaBrowser() {
    // Dùng khi cả API JSON lẫn HTML thô đều bị chặn (403 tầng WAF) — mở
    // Chromium headless thật để site không phân biệt được với người dùng
    // thường. Nặng hơn hẳn 2 cách trên (mở trình duyệt tốn vài giây) nên
    // chỉ dùng làm phương án cuối.
    const { html, status } = await fetchRenderedHtml(`${BASE_URL}/`, {
      userAgent: BROWSER_HEADERS['User-Agent'],
      timeoutMs: 25000,
    });
    const diag = { status, htmlLength: html?.length || 0 };
    if (status >= 400) {
      console.warn(`[vsc9] fetchViaBrowser: trang trả về status ${status}`);
      this.lastDiagnostics = { ...this.lastDiagnostics, browser: diag };
      return [];
    }
    const parsed = this.parseMatches(html);
    diag.rawRecordsFound = parsed.length;
    this.lastDiagnostics = { ...this.lastDiagnostics, browser: diag };
    return parsed;
  }

  async getMatchesByTab(tab = 'live') {
    return this.cached(`matches:${tab}`, async () => {
      this.lastDiagnostics = { baseUrl: BASE_URL, at: new Date().toISOString() };
      const cookie = await this.warmup();
      this.lastDiagnostics.gotCookie = !!cookie;

      let unique = [];
      try {
        unique = await this.fetchViaApi(cookie);
      } catch (err) {
        this.lastDiagnostics.api = { error: err.message };
        console.warn('[vsc9] fetchViaApi lỗi:', err.message);
      }

      // API rỗng (bị chặn/đổi định dạng) → thử quét trực tiếp HTML trang chủ.
      if (!unique.length) {
        try {
          unique = await this.fetchViaHtml(cookie);
        } catch (err) {
          this.lastDiagnostics.html = { error: err.message };
          console.warn('[vsc9] fetchViaHtml lỗi:', err.message);
        }
      }

      // Vẫn rỗng (khả năng cao là 403 chặn ở tầng WAF, header/cookie không
      // giúp được) → phương án cuối: mở trình duyệt headless thật.
      if (!unique.length) {
        try {
          unique = await this.fetchViaBrowser();
        } catch (err) {
          this.lastDiagnostics.browser = { error: err.message };
          console.warn('[vsc9] fetchViaBrowser lỗi:', err.message);
        }
      }

      const matches = tab === 'live' ? unique.filter((m) => m.status.isLive) : unique.filter((m) => !m.status.isLive);
      this.lastDiagnostics.totalMatchesFound = unique.length;
      this.lastDiagnostics.liveMatchesFound = matches.length;
      return { matches, hasMore: false, totalCount: matches.length };
    });
  }

  async getAllMatchesByTab(tab = 'live') {
    return this.getMatchesByTab(tab);
  }

  extractHlsUrls(html) {
    const input = cleanUrl(html);
    const found = input.match(/https?:[^'"\s<>\\]+?\.m3u8(?:\?[^'"\s<>\\]*)?/gi) || [];
    return [...new Set(found.map(cleanUrl))];
  }

  async getMatchDetail(idOrUrl) {
    const rawId = String(idOrUrl || '').replace(/^vsc9_/, '');
    const detailUrl = /^https?:\/\//i.test(rawId)
      ? rawId
      : `${BASE_URL}/truc-tiep?liveId=${encodeURIComponent(rawId)}`;
    const cookie = await this.warmup();
    let html = '';
    const response = await this.client.get(detailUrl, cookie ? { headers: { Cookie: cookie } } : undefined);
    if (response.status >= 400 || String(response.headers?.['content-type'] || '').includes('text/html') === false) {
      console.warn(`[vsc9] GET ${detailUrl} trả về status ${response.status}`);
    }
    html = response.data;

    // Trang chi tiết cũng bị chặn 403 giống trang chủ → fallback headless
    // browser trước khi bó tay không lấy được link m3u8.
    if (response.status >= 400 || !this.extractHlsUrls(html).length) {
      try {
        const rendered = await fetchRenderedHtml(detailUrl, { userAgent: BROWSER_HEADERS['User-Agent'], timeoutMs: 25000 });
        if (rendered.html) html = rendered.html;
      } catch (err) {
        console.warn('[vsc9] getMatchDetail fetchRenderedHtml lỗi:', err.message);
      }
    }

    const liveId = new URL(detailUrl).searchParams.get('liveId') || rawId;
    const { home, away } = titleTeams(detailUrl);
    const streams = this.extractHlsUrls(html).map((url, index) => ({
      id: `vsc9_${liveId}_${index + 1}`,
      streamerName: `VSC9 ${index + 1}`,
      name: `VSC9 ${index + 1}`,
      m3u8Url: url,
      playUrl: url,
      format: 'hls',
    }));
    return {
      matchId: `vsc9_${liveId}`,
      match: { matchId: `vsc9_${liveId}`, source: 'vsc9', title: `${home} vs ${away}`, homeTeam: { name: home }, awayTeam: { name: away }, stream: { liveUrl: detailUrl, matchId: liveId } },
      streams,
    };
  }
}

export default new Vsc9Service();
