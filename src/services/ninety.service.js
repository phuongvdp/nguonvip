import * as cheerio from 'cheerio';
import { createHttpClient } from '@/src/utils/httpClient';
import { buildMatchSlug, extractSlugFromUrl, slugifyVi } from '@/src/utils/slug';

const BASE_URL = process.env.NINETY_DOMAIN || 'https://90phutzc.tv';

// Dùng chung API live score với Xoilac (confirmed từ Network tab)
const LIVE_SCORE_API = 'https://fb-api.sportliveapiz.com/football/match/detail_live';

// Status codes football (giống Xoilac)
const FOOTBALL_STATUS = [
  'Bất thường', 'Chưa bắt đầu', 'Hiệp 1', 'HT',
  'Hiệp 2', 'Hiệp phụ', 'Hiệp phụ', 'Pen',
  'Kết thúc', 'Trì hoãn', 'Gián đoạn', 'Cắt một nửa',
  'Hủy bỏ', 'Chưa xác định',
];
const FOOTBALL_PLAYING  = [2, 3, 4, 5, 6, 7];
const FOOTBALL_FINISHED = 8;

class NinetyService {
  constructor() {
    this.baseUrl = BASE_URL;

    // Client scrape HTML
    this.client = createHttpClient({
      baseURL: BASE_URL,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
        Referer: `${BASE_URL}/`,
      },
    });

    // Client gọi JSON API (live score)
    this.scoreClient = createHttpClient({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
      },
    });

    this.cache = new Map();
    this.CACHE_MATCH  = 5  * 60 * 1000;
    this.CACHE_STREAM = 10 * 60 * 1000;
  }

  // ─── utils ─────────────────────────────────────────────────────────────────

  getFullUrl(url) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  detectCdn(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('tencent') || u.includes('tlivecdn') || u.includes('liveplay')) return 'TENCENT';
    if (u.includes('alibaba') || u.includes('aliyun') || u.includes('alicdn'))      return 'ALIBABA';
    if (u.includes('cloudflare')) return 'CLOUDFLARE';
    if (u.includes('akamai'))     return 'AKAMAI';
    if (u.includes('.flv'))       return 'FLV';
    return 'HLS';
  }

  async cached(key, fn, ttl = this.CACHE_MATCH) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return hit.data;
    const data = await fn();
    this.cache.set(key, { data, ts: Date.now() });
    return data;
  }

  normalizeScorePair(text = '') {
    const m = String(text).match(/(\d+)\s*[-:]\s*(\d+)/);
    return m ? `${m[1]}-${m[2]}` : null;
  }

  // ─── Live Score API (sportliveapiz.com) ────────────────────────────────────

  /**
   * Fetch live scores → Map<fid, {score, status, stats}>
   * Dùng cùng API với Xoilac, confirmed từ Network tab của 90phutzc.tv
   */
  async fetchLiveScoreMap() {
    try {
      const res = await this.scoreClient.get(LIVE_SCORE_API);
      const results = res.data?.results || res.data || [];
      const map = new Map();
      if (!Array.isArray(results)) return map;

      for (const item of results) {
        const id = item.id;
        if (!id || !Array.isArray(item.score)) continue;

        const statusCode  = Number(item.status_id ?? item.score[1]);
        const homeScores  = Array.isArray(item.score[2]) ? item.score[2] : [];
        const awayScores  = Array.isArray(item.score[3]) ? item.score[3] : [];
        let homeScore = Number(homeScores[0] ?? 0);
        let awayScore = Number(awayScores[0] ?? 0);
        // Nếu có extra time / penalty dùng score index 5
        if (Number(homeScores[5]) > 0) homeScore = Number(homeScores[5]);
        if (Number(awayScores[5]) > 0) awayScore = Number(awayScores[5]);

        const halfHome  = Number(homeScores[1] ?? 0);
        const halfAway  = Number(awayScores[1] ?? 0);
        const cornerH   = Number(homeScores[3] ?? 0);
        const cornerA   = Number(awayScores[3] ?? 0);
        const yellowH   = Number(homeScores[4] ?? 0);
        const yellowA   = Number(awayScores[4] ?? 0);

        const isLive     = FOOTBALL_PLAYING.includes(statusCode);
        const isFinished = statusCode === FOOTBALL_FINISHED;
        const isHalfTime = statusCode === 3; // HT
        const statusName = FOOTBALL_STATUS[statusCode] || 'LIVE';
        const elapsed    = item.score[6] ? String(item.score[6]) : '';

        const payload = {
          score:  { home: homeScore, away: awayScore },
          stats:  {
            halfTimeScore: `${halfHome}-${halfAway}`,
            corners:       `${cornerH}-${cornerA}`,
            yellowCards:   `${yellowH}-${yellowA}`,
          },
          status: {
            isLive,
            isFinished,
            isHalfTime,
            isUpcoming: !isLive && !isFinished,
            name: isFinished ? 'FT' : (isHalfTime ? 'HT' : (isLive ? statusName : 'NS')),
            text: isFinished ? 'Kết thúc' : (isHalfTime ? 'HT' : (isLive ? statusName : 'Sắp diễn ra')),
            elapsedTime: isLive && elapsed ? `${elapsed}'` : '',
          },
        };

        // Lưu cả string lẫn gốc để match dễ hơn
        map.set(id, payload);
        map.set(String(id), payload);
      }

      return map;
    } catch (err) {
      console.error('[90phut] fetchLiveScoreMap error:', err.message);
      return new Map();
    }
  }

  // ─── HTML parsing ───────────────────────────────────────────────────────────

  /**
   * Parse danh sách trận từ HTML
   * Class đã xác nhận từ inspect: .main-grid-match, .gmd-*, a.redirectPopup
   */
  parseMatchesFromHtml(html, liveMap = new Map()) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const matches = [];

    // Confirmed selector từ inspect thực tế
    $('.main-grid-match').each((_, el) => {
      try {
        const $el = $(el);

        const fid        = $el.attr('data-fid') || '';
        const sportSlug  = $el.attr('data-sport') || 'football';
        const statusCode = $el.attr('data-status') || '';
        // data-status: 1=NS, 2=LIVE, 3=FT, 4=upcoming với giờ
        const isLive     = statusCode === '2' || $el.hasClass('data-live-match');
        const isFinished = statusCode === '3';
        const isHot      = ($el.attr('data-hot') || '').toLowerCase() === 'on';

        // Link — confirmed: a.redirectPopup
        const href      = $el.find('a.redirectPopup').first().attr('href') || '';
        const detailUrl = this.getFullUrl(href);
        const slug      = extractSlugFromUrl(href) || '';

        // Giải đấu — confirmed: .gmd-match-league / .gmd-tournament-header
        const leagueName = $el.attr('data-league')
          || $el.find('.gmd-match-league span').first().text().trim()
          || $el.find('.gmd-tournament-header span').first().text().trim()
          || 'Giải đấu';
        const leagueLogo = $el.find('.gmd-match-league img, .gmd-tournament-header img').first().attr('src') || '';

        // Đội — confirmed: .gmd-home_team, .gmd-away_team (giống Xoilac)
        const homeName = $el.find('.gmd-home_team .team-name-group p').first().text().trim()
          || $el.find('.gmd-home_team p').first().text().trim() || 'Home';
        const homeLogo = $el.find('.gmd-home_team img').first().attr('src') || '';

        const awayName = $el.find('.gmd-away_team .team-name-group p').first().text().trim()
          || $el.find('.gmd-away_team p').first().text().trim() || 'Away';
        const awayLogo = $el.find('.gmd-away_team img').first().attr('src') || '';

        // Tỉ số từ HTML (sẽ được override bởi liveMap nếu có)
        let homeScore = 0;
        let awayScore = 0;
        const midText  = $el.find('.gmd-mid_score').first().text().replace(/\s+/g, ' ').trim();
        const scorePair = this.normalizeScorePair(midText);
        if (scorePair) [homeScore, awayScore] = scorePair.split('-').map(Number);

        // Thời gian
        const timeText    = $el.find('.gmd-match-date span').first().text().trim();
        const elapsedTime = $el.find('.gmd-e_minutes, .t_time').first().text().trim();
        const isHalfTime  = isLive && /^HT$/i.test(elapsedTime);

        // Stats từ HTML
        const halfTimeScore = this.normalizeScorePair(
          $el.find('.half-court, .match-item__half-court').first().text()
        ) || '0-0';
        const corners     = this.normalizeScorePair($el.find('.corner-goal').first().text()) || '0-0';
        const yellowCards = this.normalizeScorePair($el.find('.yellow-cards').first().text()) || '0-0';

        // Ngày giờ
        let matchDate = new Date();
        if (timeText) {
          const parsed = Date.parse(timeText);
          if (!isNaN(parsed)) matchDate = new Date(parsed);
        }
        const timeStr = matchDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
        const dateStr = matchDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        const dd      = String(matchDate.getDate()).padStart(2, '0');
        const mm      = String(matchDate.getMonth() + 1).padStart(2, '0');
        const yyyy    = matchDate.getFullYear();

        // Override từ live score API nếu có
        const live = liveMap.get(fid) || liveMap.get(String(fid));
        if (live) {
          homeScore = live.score.home;
          awayScore = live.score.away;
        }

        // Build status
        let status;
        if (live?.status) {
          status = live.status;
        } else {
          let sName = 'NS', sText = 'Sắp diễn ra';
          if (isFinished)     { sName = 'FT';   sText = 'Kết thúc'; }
          else if (isHalfTime){ sName = 'HT';   sText = 'HT'; }
          else if (isLive)    { sName = 'LIVE'; sText = elapsedTime || 'LIVE'; }
          status = {
            isLive, isFinished, isHalfTime,
            isUpcoming: !isLive && !isFinished,
            name: sName, text: sText,
            elapsedTime: isLive ? (elapsedTime || '') : '',
          };
        }

        if (!homeName && !awayName) return;

        matches.push({
          matchId:   `nt_${fid || slug}`,
          originalId: fid,
          slug:      slug || `${slugifyVi(homeName)}-vs-${slugifyVi(awayName)}-ngay-${dd}-${mm}-${yyyy}`,
          source:    '90phut',
          sport:     sportSlug,
          sportName: sportSlug === 'football' ? 'BÓNG ĐÁ' : sportSlug.toUpperCase(),
          sportIcon: 'fa-futbol',
          competition: {
            name: leagueName,
            logo: this.getFullUrl(leagueLogo),
            icon: this.getFullUrl(leagueLogo),
          },
          homeTeam: { name: homeName, logo: this.getFullUrl(homeLogo) },
          awayTeam: { name: awayName, logo: this.getFullUrl(awayLogo) },
          score:     { home: homeScore, away: awayScore },
          status,
          stats:     { halfTimeScore, corners, yellowCards },
          matchTime:          matchDate.getTime(),
          matchTimeTimestamp: matchDate.getTime(),
          timeFormatted: `${timeStr} - ${dd}/${mm}`,
          dateStr, timeStr, isHot, detailUrl,
          stream:      { liveUrl: detailUrl || `${BASE_URL}/truc-tiep/${slug}/` },
          commentators: [],
          streamers:    [],
          streamUrl:    '',
        });
      } catch (_) { /* bỏ qua item lỗi */ }
    });

    return matches;
  }

  // ─── Stream parsing từ trang chi tiết ─────────────────────────────────────

  parseStreamsFromDetailHtml(html) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const streams = [];
    const seen = new Set();

    const addStream = (url, name = 'Server', idx = 0, embedUrl = '') => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      const isFlv = url.includes('.flv');
      streams.push({
        id:            `nt_stream_${idx}`,
        streamerId:    `nt_${idx}`,
        name,
        streamerName:  name,
        avatar:        '',
        streamerAvatar:'',
        link:           url,
        m3u8Url:        isFlv ? '' : url,
        flvUrl:         isFlv ? url : '',
        playMode:       isFlv ? 'flv' : 'hls',
        cdn:            this.detectCdn(url),
        quality:        'HD',
        embedUrl:       embedUrl || '',
      });
    };

    let idx = 0;

    // 1. Scan tất cả script tìm m3u8/flv
    const STREAM_RE = [
      /["'`](https?:\/\/[^"'`\s]+\.m3u8[^"'`\s]*)/gi,
      /["'`](https?:\/\/[^"'`\s]+\.flv[^"'`\s]*)/gi,
      /file\s*:\s*["'`]([^"'`]+\.m3u8[^"'`]*)/gi,
      /src\s*:\s*["'`]([^"'`]+\.m3u8[^"'`]*)/gi,
      /url\s*:\s*["'`]([^"'`]+\.m3u8[^"'`]*)/gi,
      /hlsUrl\s*[=:]\s*["'`]([^"'`]+)/gi,
      /streamUrl\s*[=:]\s*["'`]([^"'`]+)/gi,
      /playUrl\s*[=:]\s*["'`]([^"'`]+)/gi,
      /source\s*:\s*["'`]([^"'`]+\.m3u8[^"'`]*)/gi,
      /"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi,
    ];

    $('script').each((_, el) => {
      const txt = $(el).html() || '';
      if (!txt.includes('m3u8') && !txt.includes('.flv') && !txt.includes('file')) return;
      for (const re of STREAM_RE) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(txt)) !== null) {
          const url = m[1];
          if (url && url.startsWith('http')) addStream(url, `Server ${idx + 1}`, idx++);
        }
      }
    });

    // 2. BLV / server buttons trong DOM — giống Xoilac
    const LINK_SELECTORS = [
      '.list-blv a[data-link]',
      '.list-blv a[data-stream]',
      '.blv-list a',
      '.server-list a',
      'a[data-stream]',
      'a[data-link]',
      'a[data-m3u8]',
      '[class*="channel"] a',
      '[class*="server"] a',
    ];
    for (const sel of LINK_SELECTORS) {
      $(sel).each((_, el) => {
        const $a  = $(el);
        const url = $a.attr('data-stream') || $a.attr('data-link') || $a.attr('data-m3u8') || '';
        const name = $a.text().trim() || $a.attr('title') || `Server ${idx + 1}`;
        if (url && url.startsWith('http')) addStream(url, name, idx++);
      });
    }

    // 3. iframe embed
    $('iframe[src], iframe[data-src]').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (!src || !src.startsWith('http') || seen.has(src)) return;
      seen.add(src);
      streams.push({
        id:            `nt_embed_${i}`,
        streamerId:    `nt_embed_${i}`,
        name:          `Kênh ${i + 1}`,
        streamerName:  `Kênh ${i + 1}`,
        avatar: '', streamerAvatar: '',
        link: src, m3u8Url: '', flvUrl: '',
        playMode: 'embed', cdn: 'EMBED', quality: 'HD',
        embedUrl: src,
      });
    });

    return streams;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async getMatchesByTab(tab = 'live', sport = 'football', page = 1) {
    return this.cached(`tab:${tab}:${sport}:${page}`, async () => {
      try {
        // 90phut dùng homepage + filter param
        const PATH = {
          live:           '/',
          today:          '/',
          hot:            '/',
          upcoming:       '/?filter=upcoming',
          tomorrow:       '/?filter=upcoming',
          commentator:    '/',
          'with-stream':  '/',
        };
        const path = PATH[tab] || '/';
        const url  = page > 1 ? `${path}${path.includes('?') ? '&' : '?'}page=${page}` : path;

        // Fetch HTML và live scores song song
        const [htmlRes, liveMap] = await Promise.all([
          this.client.get(url),
          this.fetchLiveScoreMap(),
        ]);

        const html = typeof htmlRes.data === 'string' ? htmlRes.data : '';
        let matches = this.parseMatchesFromHtml(html, liveMap);

        // Filter theo tab
        const todayStr    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

        if (tab === 'live')     matches = matches.filter((m) => m.status.isLive);
        if (tab === 'today')    matches = matches.filter((m) => m.dateStr === todayStr);
        if (tab === 'tomorrow') matches = matches.filter((m) => m.dateStr === tomorrowStr);
        if (tab === 'upcoming') matches = matches.filter((m) => m.status.isUpcoming);
        if (tab === 'hot')      matches = matches.filter((m) => m.isHot);

        // Filter sport
        if (sport && sport !== 'all') {
          matches = matches.filter((m) => m.sport === sport);
        }

        return { matches, hasMore: false, totalCount: matches.length };
      } catch (err) {
        console.error(`[90phut] getMatchesByTab(${tab}) error:`, err.message);
        return { matches: [], hasMore: false, totalCount: 0 };
      }
    });
  }

  async getAllMatchesByTab(tab = 'live', sport = 'all') {
    return this.cached(`all:${tab}:${sport}`, async () => {
      const seen = new Set();
      const all  = [];
      for (let page = 1; page <= 5; page++) {
        const { matches, hasMore } = await this.getMatchesByTab(tab, sport, page);
        for (const m of matches) {
          const key = m.matchId || m.slug;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          all.push(m);
        }
        if (!hasMore) break;
      }
      return { matches: all, hasMore: false, totalCount: all.length };
    });
  }

  async findMatchBySlugOrId(slugOrId, sport = 'football') {
    if (!slugOrId) return null;
    const key = String(slugOrId).replace(/^nt_/, '').replace(/\/+$/, '').trim();
    for (const tab of ['live', 'today', 'upcoming', 'hot']) {
      const { matches } = await this.getMatchesByTab(tab, sport);
      const found = matches.find(
        (m) => m.slug === key || m.originalId === key
          || m.matchId === `nt_${key}` || m.matchId === slugOrId,
      );
      if (found) return found;
    }
    return null;
  }

  async getStreams(detailUrl) {
    if (!detailUrl) return [];
    return this.cached(`streams:${detailUrl}`, async () => {
      try {
        const pageUrl = detailUrl.startsWith('http') ? detailUrl : this.getFullUrl(detailUrl);
        const res     = await this.client.get(pageUrl);
        const html    = typeof res.data === 'string' ? res.data : String(res.data || '');
        return this.parseStreamsFromDetailHtml(html);
      } catch (err) {
        console.error(`[90phut] getStreams(${detailUrl}) error:`, err.message);
        return [];
      }
    }, this.CACHE_STREAM);
  }

  async getMatchDetail(slugOrId, sport = 'football') {
    if (!slugOrId) return null;
    return this.cached(`detail:${slugOrId}`, async () => {
      try {
        let match = await this.findMatchBySlugOrId(slugOrId, sport);
        if (!match) {
          const slug = String(slugOrId).replace(/^nt_/, '');
          match = {
            matchId:   `nt_${slug}`,
            slug,
            source:    '90phut',
            sport,
            detailUrl: `${BASE_URL}/truc-tiep/${slug}/`,
          };
        }

        const detailUrl = match.detailUrl || `${BASE_URL}/truc-tiep/${match.slug}/`;
        const streams   = await this.getStreams(detailUrl);
        if (streams.length && !match.streamUrl) match.streamUrl = streams[0].link || '';

        return { match, streams, matchId: match.matchId };
      } catch (err) {
        console.error(`[90phut] getMatchDetail(${slugOrId}) error:`, err.message);
        return null;
      }
    }, this.CACHE_STREAM);
  }

  async getCounts(sport = 'football') {
    return this.cached(`counts:${sport}`, async () => {
      try {
        const [liveRes, upRes, hotRes] = await Promise.allSettled([
          this.getMatchesByTab('live', sport),
          this.getMatchesByTab('upcoming', sport),
          this.getMatchesByTab('hot', sport),
        ]);
        const live     = liveRes.status === 'fulfilled'  ? liveRes.value.matches  : [];
        const upcoming = upRes.status  === 'fulfilled'   ? upRes.value.matches    : [];
        const hot      = hotRes.status === 'fulfilled'   ? hotRes.value.matches   : [];

        const todayStr    = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
        const all = [...live, ...upcoming];

        return {
          live:         live.length,
          upcoming:     upcoming.length,
          hot:          hot.length,
          today:        all.filter((m) => m.dateStr === todayStr).length || live.length,
          tomorrow:     all.filter((m) => m.dateStr === tomorrowStr).length,
          tomorrow_date: tomorrowStr,
          commentator:  0,
        };
      } catch (err) {
        console.error('[90phut] getCounts error:', err.message);
        return { live: 0, upcoming: 0, hot: 0, today: 0, tomorrow: 0, commentator: 0 };
      }
    });
  }

  // Alias — tương thích với pattern PhaoHoa
  async getStreamLinks(matchId, sport = 'football') {
    const detail = await this.getMatchDetail(matchId, sport);
    return detail?.streams || [];
  }

  async getMatchLiveSnapshot(slugOrId, sport = 'football') {
    const detail = await this.getMatchDetail(slugOrId, sport);
    return detail?.match || null;
  }
}

const ninetyService = new NinetyService();
export default ninetyService;
