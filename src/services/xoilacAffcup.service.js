import * as cheerio from 'cheerio';
import { createHttpClient } from '@/src/utils/httpClient';
import { buildMatchSlug, extractSlugFromUrl, slugifyVi } from '@/src/utils/slug';

const XOILAC_AFFCUP_BASE_URL = process.env.AFFCUP_DOMAIN || 'https://xoilacbongda-affcup2026b.live';

/**
 * Service để tương tác với Xoilac AFF Cup 2026
 * ✨ Features:
 * - HTML Scraping với multiple selectors (fallback)
 * - Smart caching (5 phút)
 * - Stream detection (M3U8, FLV)
 * - CDN detection (Tencent, Alibaba, Cloudflare, etc)
 * - Error handling & Retry logic
 * - Vietnamese locale support
 */
class XoilacAffcupService {
  constructor() {
    this.baseUrl = XOILAC_AFFCUP_BASE_URL;
    this.client = createHttpClient({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': `${this.baseUrl}/`,
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0'
      }
    });

    // Cache setup
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
    this.retryAttempts = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Lấy từ cache hoặc execute function
   */
  async cacheResult(key, fn, ttl = this.cacheTTL) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < ttl) {
      return cached.data;
    }

    const result = await fn();
    this.cache.set(key, { data: result, time: Date.now() });
    return result;
  }

  /**
   * Retry logic
   */
  async retryRequest(fn, attempts = this.retryAttempts) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === attempts - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * (i + 1)));
      }
    }
  }

  /**
   * Phát hiện loại CDN từ URL stream
   */
  detectCdn(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('tencent') || u.includes('tlivecdn') || u.includes('liveplay')) return 'TENCENT';
    if (u.includes('alibaba') || u.includes('aliyun') || u.includes('alicdn')) return 'ALIBABA';
    if (u.includes('cloudflare')) return 'CLOUDFLARE';
    if (u.includes('akamai')) return 'AKAMAI';
    if (u.includes('flv')) return 'FLV';
    return 'HLS';
  }

  /**
   * Helper: Extract text với fallback selectors
   */
  extractText($el, selectors) {
    if (typeof selectors === 'string') {
      return $el.find(selectors).text().trim();
    }
    for (const selector of selectors) {
      const text = $el.find(selector).text().trim();
      if (text) return text;
    }
    return '';
  }

  /**
   * Helper: Extract number với fallback
   */
  extractNumber($el, selectors, defaultValue = 0) {
    const text = this.extractText($el, selectors);
    const num = parseInt(text);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Parse một phần tử trận đấu từ HTML
   */
  parseMatchElement($, el, index) {
    try {
      const $el = $(el);

      // Lấy ID - multiple fallbacks
      const matchId = $el.data('match-id') 
        || $el.attr('id') 
        || $el.attr('data-id')
        || `aff_${index}`;

      // Lấy tên đội - multiple selectors
      const homeTeam = this.extractText($el, [
        '.home-team',
        '.team-home',
        '[data-team="home"]',
        '.team:first',
        'tr:first td:first',
        '.left-team',
        '.team1'
      ]);

      const awayTeam = this.extractText($el, [
        '.away-team',
        '.team-away',
        '[data-team="away"]',
        '.team:last',
        'tr:first td:last',
        '.right-team',
        '.team2'
      ]);

      // Nếu không tìm được tên đội, skip
      if (!homeTeam || !awayTeam) return null;

      // Lấy tỷ số
      const homeScore = this.extractNumber($el, [
        '.score-home',
        '.home-score',
        '.score:first',
        '[data-score="home"]',
        'td:nth-child(2)'
      ]);

      const awayScore = this.extractNumber($el, [
        '.score-away',
        '.away-score',
        '.score:last',
        '[data-score="away"]',
        'td:nth-child(3)'
      ]);

      // Lấy trạng thái
      const status = this.extractText($el, [
        '.status',
        '.match-status',
        '.state',
        '[data-status]',
        '.badge'
      ]);

      // Lấy thời gian
      const time = this.extractText($el, [
        '.time',
        '.match-time',
        '.duration',
        '.elapsed',
        '[data-time]'
      ]);

      // Lấy URL detail
      let detailUrl = $el.find('a[href]').attr('href') || '';
      if (!detailUrl) {
        detailUrl = $el.attr('data-href') || $el.attr('href') || '';
      }

      // Lấy tournament
      const tournament = this.extractText($el, [
        '.tournament',
        '.league-name',
        '.competition',
        '.cup-name',
        '[data-tournament]'
      ]) || 'AFF Cup 2026';

      // Determine status
      const isLive = /live|đang|trực tiếp|playing|on-going/i.test(status);
      const isFinished = /kết thúc|ft|finished|completed|end/i.test(status);
      const isUpcoming = !isLive && !isFinished;

      return {
        matchId: `affcup_${matchId}`,
        originalId: matchId,
        slug: `${slugifyVi(homeTeam)}-vs-${slugifyVi(awayTeam)}`,
        source: 'xoilac-affcup',
        sport: 'football',
        sportName: 'BÓNG ĐÁ',
        sportIcon: 'fa-futbol',
        competition: {
          name: tournament,
          logo: ''
        },
        homeTeam: {
          name: homeTeam,
          logo: ''
        },
        awayTeam: {
          name: awayTeam,
          logo: ''
        },
        score: {
          home: homeScore,
          away: awayScore
        },
        status: {
          isLive,
          isFinished,
          isUpcoming,
          isHalfTime: /ht|half/i.test(status),
          name: isFinished ? 'FT' : (isLive ? 'LIVE' : 'NS'),
          text: isFinished ? 'Kết thúc' : (isLive ? 'LIVE' : 'Sắp diễn ra'),
          elapsedTime: time || ''
        },
        stats: {
          halfTimeScore: '0-0',
          corners: '0-0',
          yellowCards: '0-0'
        },
        detailUrl: detailUrl.startsWith('http') ? detailUrl : `${this.baseUrl}${detailUrl}`,
        stream: {
          liveUrl: detailUrl.startsWith('http') ? detailUrl : `${this.baseUrl}${detailUrl}`
        }
      };
    } catch (err) {
      console.warn('Error parsing match element:', err.message);
      return null;
    }
  }

  /**
   * Parse trang chính để lấy danh sách trận đấu
   */
  async getMatchesFromHomePage() {
    return this.cacheResult('homepage_matches', async () => {
      try {
        const response = await this.retryRequest(() => this.client.get('/'));
        const html = typeof response.data === 'string' ? response.data : String(response.data || '');
        const $ = cheerio.load(html);
        const matches = [];

        // Tìm tất cả các phần tử chứa thông tin trận đấu - multiple selectors
        const matchSelectors = [
          '[data-match-id]',
          '.match-item',
          '.live-match',
          '.match-card',
          '.match-row',
          'tr[data-match]',
          '.match',
          '[class*="match"]'
        ];

        for (const selector of matchSelectors) {
          $(selector).each((idx, el) => {
            const match = this.parseMatchElement($, el, idx);
            if (match) matches.push(match);
          });
          
          if (matches.length > 0) break; // Stop at first successful selector
        }

        return matches;
      } catch (error) {
        console.error('Error fetching Xoilac AFF Cup matches from homepage:', error.message);
        return [];
      }
    });
  }

  /**
   * Parse trang list live để lấy trận đấu đang phát trực tiếp
   * Hỗ trợ caching và retry
   */
  async getMatchesByTab(tab = 'live', sport = 'football', page = 1) {
    const cacheKey = `tab_${tab}_${sport}_${page}`;

    return this.cacheResult(cacheKey, async () => {
      try {
        // Tùy chỉnh URL dựa vào tab yêu cầu
        let path = '/';
        if (tab === 'live') path = '/truc-tiep/';
        else if (tab === 'upcoming') path = '/schedule/';
        else if (tab === 'today') path = '/today/';
        else if (tab === 'hot') path = '/hot/';
        else if (tab === 'commentator') path = '/has-stream/';
        else if (tab === 'tomorrow') path = '/tomorrow/';
        else if (tab === 'with-stream') path = '/has-stream/';

        // Thêm pagination nếu cần
        if (page > 1) {
          path += path.includes('?') ? `&page=${page}` : `?page=${page}`;
        }

        const response = await this.retryRequest(() => this.client.get(path));
        const html = typeof response.data === 'string' ? response.data : String(response.data || '');
        const $ = cheerio.load(html);
        const matches = [];

        // Parse với helper function
        const matchSelectors = [
          '[data-match-id]',
          '.match-item',
          '.live-match',
          '.match-card',
          '.match-row',
          'tr[data-match]'
        ];

        for (const selector of matchSelectors) {
          $(selector).each((idx, el) => {
            const match = this.parseMatchElement($, el, idx);
            if (match) matches.push(match);
          });
          
          if (matches.length > 0) break;
        }

        return {
          matches,
          hasMore: matches.length >= 18,
          totalCount: matches.length
        };
      } catch (error) {
        console.error(`Error fetching Xoilac AFF Cup tab ${tab}:`, error.message);
        return { matches: [], hasMore: false, totalCount: 0 };
      }
    });
  }

  /**
   * Lấy tất cả trận đấu của một tab (paginated)
   * Tự động lấy tất cả trang
   */
  async getAllMatchesByTab(tab = 'live', sport = 'football', pageSize = 50) {
    const cacheKey = `all_tab_${tab}_${sport}`;

    return this.cacheResult(cacheKey, async () => {
      const all = [];
      const seen = new Set();
      let page = 1;
      const maxPages = 30;

      while (page <= maxPages) {
        try {
          const { matches, hasMore } = await this.getMatchesByTab(tab, sport, page);

          for (const m of matches || []) {
            const key = m.matchId || m.originalId;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            all.push(m);
          }

          if (!hasMore || !matches.length) {
            break;
          }
          page += 1;
        } catch (err) {
          console.warn(`Error fetching page ${page}:`, err.message);
          break;
        }
      }

      return { matches: all, hasMore: false, totalCount: all.length };
    });
  }

  /**
   * Parse stream URL từ HTML element
   */
  extractStreamUrl($el) {
    // Multiple fallback sources
    const sources = [
      $el.data('stream'),
      $el.data('link'),
      $el.data('url'),
      $el.attr('data-stream'),
      $el.attr('data-link'),
      $el.attr('data-url'),
      $el.find('a[href*="stream"]').attr('href'),
      $el.find('a[href*="link"]').attr('href'),
      $el.find('iframe').attr('src'),
      $el.find('video').attr('src'),
      $el.attr('href'),
      $el.attr('src')
    ];

    for (const source of sources) {
      if (source && typeof source === 'string' && !source.startsWith('javascript')) {
        return source.trim();
      }
    }
    return '';
  }

  /**
   * Parse trang chi tiết trận đấu để lấy streams
   */
  async getStreams(detailUrl) {
    if (!detailUrl) return [];

    try {
      const pageUrl = detailUrl.startsWith('http') ? detailUrl : `${this.baseUrl}${detailUrl}`;
      const cacheKey = `streams_${pageUrl}`;

      return this.cacheResult(cacheKey, async () => {
        try {
          const response = await this.retryRequest(() => this.client.get(pageUrl));
          const html = typeof response.data === 'string' ? response.data : String(response.data || '');
          const $ = cheerio.load(html);
          const streams = [];
          const seen = new Set();

          // Tìm tất cả các server/streams
          const streamSelectors = [
            '[data-stream]',
            '[data-link]',
            '.stream-item',
            '.server-item',
            '.player-item',
            '.blv-item',
            '.channel-item',
            '.stream',
            '[class*="stream"]',
            '[class*="server"]'
          ];

          for (const selector of streamSelectors) {
            $( selector).each((idx, el) => {
              const $el = $(el);
              const streamUrl = this.extractStreamUrl($el);

              if (!streamUrl || seen.has(streamUrl)) return;
              seen.add(streamUrl);

              // Kiểm tra loại stream
              const isFlv = /\.flv(\?|$)/i.test(streamUrl);
              const isM3u8 = /\.m3u8(\?|$)/i.test(streamUrl);

              if (!isFlv && !isM3u8) return;

              const name = this.extractText($el, [
                '.name',
                '.title',
                '.server-name',
                '.streamer-name',
                '.channel-name',
                '[data-name]'
              ]) || `Server ${streams.length + 1}`;

              streams.push({
                id: `affcup_stream_${streams.length}`,
                streamerId: streams.length,
                title: name,
                name: name,
                streamerName: name,
                avatar: '',
                streamerAvatar: '',
                liveUrl: pageUrl,
                link: streamUrl,
                m3u8Url: isM3u8 ? streamUrl : '',
                flvUrl: isFlv ? streamUrl : '',
                playMode: isFlv ? 'flv' : 'hls',
                cdn: this.detectCdn(streamUrl),
                quality: 'HD'
              });
            });

            if (streams.length > 0) break;
          }

          // Fallback: Regex patterns để tìm URLs
          if (!streams.length) {
            const urlPatterns = [
              /url\s*[:=]\s*["']([^"']+?\.(?:m3u8|flv))["']/gi,
              /["']?url["']?\s*[:=]\s*["']([^"']+?\.(?:m3u8|flv))["']/gi,
              /streamUrl\s*[:=]\s*["']([^"']+?\.(?:m3u8|flv))["']/gi,
              /window\.playUrl\s*=\s*["']([^"']+?\.(?:m3u8|flv))["']/gi,
              /hlsUrl\s*[:=]\s*["']([^"']+?\.(?:m3u8|flv))["']/gi,
              /flvUrl\s*[:=]\s*["']([^"']+?\.(?:m3u8|flv))["']/gi
            ];

            for (const pattern of urlPatterns) {
              let match;
              while ((match = pattern.exec(html))) {
                const url = match[1];
                if (!url || seen.has(url)) continue;
                
                const isFlv = /\.flv(\?|$)/i.test(url);
                const isM3u8 = /\.m3u8(\?|$)/i.test(url);
                if (!isFlv && !isM3u8) continue;

                seen.add(url);
                streams.push({
                  id: `affcup_stream_${streams.length}`,
                  streamerId: streams.length,
                  title: `Server ${streams.length + 1}`,
                  name: `Server ${streams.length + 1}`,
                  streamerName: `Server ${streams.length + 1}`,
                  avatar: '',
                  streamerAvatar: '',
                  liveUrl: pageUrl,
                  link: url,
                  m3u8Url: isM3u8 ? url : '',
                  flvUrl: isFlv ? url : '',
                  playMode: isFlv ? 'flv' : 'hls',
                  cdn: this.detectCdn(url),
                  quality: 'HD'
                });
              }

              if (streams.length > 0) break;
            }
          }

          return streams;
        } catch (err) {
          console.error(`Error fetching streams for ${pageUrl}:`, err.message);
          return [];
        }
      }, 2 * this.cacheTTL); // Cache streams for 10 minutes
    } catch (err) {
      console.error(`Error in getStreams: ${err.message}`);
      return [];
    }
  }

  /**
   * Tìm trận đấu theo slug hoặc ID
   */
  async findMatchBySlugOrId(slugOrId, sport = 'football') {
    if (!slugOrId) return null;
    const key = decodeURIComponent(String(slugOrId)).replace(/\/+$/, '').trim();
    const cleanId = key.replace(/^affcup_/, '');

    const matchesKey = (m) =>
      m.matchId === key
      || m.matchId === `affcup_${cleanId}`
      || String(m.originalId) === cleanId
      || m.slug === key
      || extractSlugFromUrl(m.detailUrl) === key;

    // Thử các tab theo thứ tự ưu tiên
    const priorityTabs = ['live', 'today', 'hot'];
    const restTabs = ['commentator', 'upcoming', 'tomorrow'];

    for (const tab of priorityTabs) {
      try {
        const { matches } = await this.getMatchesByTab(tab, sport);
        const hit = (matches || []).find(matchesKey);
        if (hit) return hit;
      } catch (err) {
        console.warn(`Error fetching tab ${tab}:`, err.message);
      }
    }

    const settled = await Promise.allSettled(
      restTabs.map((tab) => this.getMatchesByTab(tab, sport).catch(() => ({ matches: [] })))
    );

    for (const res of settled) {
      if (res.status !== 'fulfilled') continue;
      for (const m of res.value?.matches || []) {
        if (!m?.matchId) continue;
        if (matchesKey(m)) return m;
      }
    }

    return null;
  }

  /**
   * Lấy chi tiết trận đấu kèm streams
   */
  async getMatchDetail(slugOrId, sport = 'football') {
    let match = await this.findMatchBySlugOrId(slugOrId, sport);

    // Fallback: tạo stub nếu không tìm thấy
    if (!match) {
      const key = decodeURIComponent(String(slugOrId)).replace(/\/+$/, '').trim();
      const detailUrl = key.startsWith('http')
        ? key
        : `${this.baseUrl}/truc-tiep/${key}/`;
      match = {
        matchId: `affcup_${key}`,
        slug: extractSlugFromUrl(detailUrl) || key,
        source: 'xoilac-affcup',
        sport: 'football',
        sportName: 'BÓNG ĐÁ',
        homeTeam: { name: 'Home', logo: '' },
        awayTeam: { name: 'Away', logo: '' },
        score: { home: 0, away: 0 },
        status: { isLive: true, name: 'LIVE', elapsedTime: '' },
        stats: { halfTimeScore: '0-0', corners: '0-0', yellowCards: '0-0' },
        competition: { name: 'AFF Cup 2026', logo: '' },
        detailUrl,
        stream: { liveUrl: detailUrl }
      };
    }

    if (!match.slug) {
      match.slug = extractSlugFromUrl(match.detailUrl || match.stream?.liveUrl) 
        || buildMatchSlug(match);
    }

    const detailUrl = match.detailUrl || match.stream?.liveUrl;
    const streams = detailUrl ? await this.getStreams(detailUrl) : [];
    return { match, streams, matchId: match.matchId };
  }

  /**
   * Lấy snapshot trạng thái trực tiếp
   */
  async getMatchLiveSnapshot(slugOrId, sport = 'football') {
    const match = await this.findMatchBySlugOrId(slugOrId, sport);
    return match || null;
  }

  /**
   * Lấy số lượng trận đấu theo category
   * Cached result
   */
  async getCounts() {
    const cacheKey = 'match_counts';

    return this.cacheResult(cacheKey, async () => {
      try {
        const [liveRes, upcomingRes, todayRes, tomorrowRes] = await Promise.allSettled([
          this.getMatchesByTab('live'),
          this.getMatchesByTab('upcoming'),
          this.getMatchesByTab('today'),
          this.getMatchesByTab('tomorrow')
        ]);

        const liveCount = liveRes.status === 'fulfilled' ? liveRes.value.matches.length : 0;
        const upcomingCount = upcomingRes.status === 'fulfilled' ? upcomingRes.value.matches.length : 0;
        const todayCount = todayRes.status === 'fulfilled' ? todayRes.value.matches.length : 0;
        const tomorrowCount = tomorrowRes.status === 'fulfilled' ? tomorrowRes.value.matches.length : 0;

        return {
          live: liveCount,
          upcoming: upcomingCount,
          today: todayCount,
          tomorrow: tomorrowCount,
          hot: 0,
          commentator: 0
        };
      } catch (error) {
        console.error('Error fetching AFF Cup counts:', error.message);
        return {
          live: 0,
          upcoming: 0,
          hot: 0,
          commentator: 0,
          today: 0,
          tomorrow: 0
        };
      }
    }, 2 * this.cacheTTL); // Cache counts for 10 minutes
  }
}

const xoilacAffcupService = new XoilacAffcupService();
export default xoilacAffcupService;
