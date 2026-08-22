const cheerio = require('cheerio');
const { GAVANG_URLS } = require('../config/constants');
const { parseMatchCards } = require('../utils/htmlParser');
const { createHttpClient } = require('../utils/httpClient');
const { extractSlugFromUrl, buildMatchSlug } = require('../utils/slug');
const { fetchRenderedHtml } = require('../utils/browserFetch');

class CrawlerService {
  constructor() {
    this.client = createHttpClient({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
        'Origin': GAVANG_URLS.BASE_URL,
        'Referer': GAVANG_URLS.BASE_URL + '/'
      }
    });
    // Chẩn đoán lần chạy getLiveMatches/getMatchesByTab gần nhất — trả kèm
    // trong response API khi count = 0, đỡ phải mò log Vercel mới biết
    // đang tắc ở bước nào (pagination filter-matches hay fallback content).
    this.lastDiagnostics = null;
  }

  /**
   * Fetch live/today match content update JSON
   */
  async fetchLiveContent(sport) {
    try {
      const isBB = sport === 'basketball';
      const base = GAVANG_URLS.BASE_URL;
      const url = isBB
        ? `${base}/app/uploads/match-content/update-bb-content-live.json`
        : `${base}/app/uploads/match-content/update-content-live.json`;
      const response = await this.client.get(`${url}?_t=${Date.now()}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching live content:', error.message);
      throw new Error(`Failed to fetch live content from Gà Vàng TV: ${error.message}`);
    }
  }

  /**
   * Fetch initial match content update JSON
   */
  async fetchInitialContent(sport) {
    try {
      const isBB = sport === 'basketball';
      const base = GAVANG_URLS.BASE_URL;
      const url = isBB
        ? `${base}/app/uploads/match-content/update-bb-content-initial.json`
        : `${base}/app/uploads/match-content/update-content-initial.json`;
      const response = await this.client.get(`${url}?_t=${Date.now()}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching initial content:', error.message);
      throw new Error(`Failed to fetch initial content from Gà Vàng TV: ${error.message}`);
    }
  }

  /**
   * Get list of currently live matches (paginated via filter-matches).
   * Upstream live_content HTML only has the first ~20 cards.
   */
  async getLiveMatches(sport) {
    const sportKey = sport || 'football';
    const pageSize = 20;
    const maxPages = 40;
    const all = [];
    const seen = new Set();
    this.lastDiagnostics = { baseUrl: GAVANG_URLS.BASE_URL, at: new Date().toISOString(), sport: sportKey };

    // FIX "Gà Vàng: lúc hiện đủ trận, lúc lại không hiện trận nào": trước
    // đây try/catch bọc NGUYÊN cả vòng lặp phân trang — 1 trang bất kỳ lỗi
    // tạm thời (timeout mạng, site chậm...) làm mất TOÀN BỘ kết quả các
    // trang trước đó đã lấy thành công (biến `all` bị vứt luôn khi catch),
    // rồi rơi xuống fallback fetchLiveContent() vốn chỉ đọc được ~20 thẻ
    // đầu — kết quả thất thường: có lần đủ trận (không trang nào lỗi), có
    // lần gần như trống (chỉ 1 trang giữa chừng lỗi mạng thoáng qua). Giờ
    // lỗi ở 1 trang chỉ DỪNG phân trang (break) chứ không xoá dữ liệu các
    // trang trước — chỉ thật sự rơi xuống fallback khi CHƯA lấy được trang
    // nào cả (all.length === 0).
    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      let matches;
      let has_more;
      try {
        ({ matches, has_more } = await this.getLoadMoreMatches({
          tab: 'live',
          sport: sportKey,
          offset
        }));
      } catch (error) {
        this.lastDiagnostics.pagination = { matchesFound: all.length, stoppedAtPage: page, error: error.message };
        console.warn(`getLiveMatches: trang ${page} lỗi, dùng ${all.length} trận đã lấy được trước đó:`, error.message);
        break;
      }

      for (const m of matches || []) {
        const key = m.matchId || m.stream?.liveUrl;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push({ ...m, sport: m.sport || sportKey });
      }

      if (!has_more || !(matches || []).length) {
        this.lastDiagnostics.pagination = { matchesFound: all.length };
        break;
      }
    }

    // The filter endpoint itself is the authoritative live tab.  Gà Vàng
    // periodically changes the card class/status text, so do not let a
    // parser miss turn every returned card into a non-live match.
    if (all.length) {
      return all.map((m) => ({
        ...m,
        status: {
          ...(m.status || {}),
          isLive: true,
          isUpcoming: false,
          isFinished: false,
          name: m.status?.name || 'LIVE'
        }
      }));
    }

    try {
      const data = await this.fetchLiveContent(sportKey);
      const liveMatches = parseMatchCards(data.live_content || '').map((m) => ({
        ...m,
        sport: sportKey,
        status: {
          ...(m.status || {}),
          isLive: true,
          isUpcoming: false,
          isFinished: false,
          name: m.status?.name || 'LIVE'
        }
      }));

      this.lastDiagnostics.fallbackLiveContent = {
        htmlLength: String(data.live_content || '').length,
        matchesFound: liveMatches.length
      };

      if (liveMatches.length) return liveMatches;
      
      // Extra fallback: try all content buckets if live_content is empty
      console.warn('live_content empty, trying other buckets');
      const allBuckets = [
        parseMatchCards(data.today_content || ''),
        parseMatchCards(data.hot_content || ''),
        parseMatchCards(data.commentator_content || '')
      ];
      
      const combined = allBuckets.flat().map(m => ({ ...m, sport: sportKey }));
      this.lastDiagnostics.fallbackOtherBuckets = { matchesFound: combined.length };
      return combined;
    } catch (error) {
      this.lastDiagnostics.fallbackLiveContent = { error: error.message };
      console.error('All fallbacks failed for getLiveMatches:', error.message);
      return [];
    }
  }

  /**
   * Get list of matches for an arbitrary tab (paginated via filter-matches),
   * e.g. 'live', 'upcoming', 'today', 'tomorrow', 'hot'.
   */
  async getMatchesByTab(tab, sport) {
    const sportKey = sport || 'football';
    const targetTab = tab || 'live';
    const pageSize = 20;
    const maxPages = 40;
    const all = [];
    const seen = new Set();
    this.lastDiagnostics = { baseUrl: GAVANG_URLS.BASE_URL, at: new Date().toISOString(), sport: sportKey, tab: targetTab };

    // Cùng fix "lúc hiện lúc không" như getLiveMatches() ở trên — lỗi 1
    // trang chỉ dừng phân trang, không xoá các trang trước đã lấy được.
    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      let matches;
      let has_more;
      try {
        ({ matches, has_more } = await this.getLoadMoreMatches({
          tab: targetTab,
          sport: sportKey,
          offset
        }));
      } catch (error) {
        this.lastDiagnostics.pagination = { matchesFound: all.length, stoppedAtPage: page, error: error.message };
        console.warn(`getMatchesByTab(${targetTab}): trang ${page} lỗi, dùng ${all.length} trận đã lấy được trước đó:`, error.message);
        break;
      }

      for (const m of matches || []) {
        const key = m.matchId || m.stream?.liveUrl;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push({ ...m, sport: m.sport || sportKey });
      }

      if (!has_more || !(matches || []).length) {
        this.lastDiagnostics.pagination = { matchesFound: all.length };
        break;
      }
    }

    if (all.length) return all;

    // Fallback to the single-shot content buckets when filter-matches is unreachable.
    if (targetTab === 'live') return this.getLiveMatches(sportKey);
    if (targetTab === 'upcoming') return this.getUpcomingMatches(sportKey);
    if (targetTab === 'today') return this.getTodayMatches(sportKey);
    if (targetTab === 'tomorrow') return this.getTomorrowMatches(sportKey);
    if (targetTab === 'hot') return this.getHotMatches(sportKey);
    return [];
  }

  /**
   * Get list of today's matches
   */
  async getTodayMatches(sport) {
    const data = await this.fetchLiveContent(sport);
    const matches = parseMatchCards(data.today_content || '');
    return matches.map(m => ({ ...m, sport: sport || 'football' }));
  }

  /**
   * Get list of upcoming matches
   */
  async getUpcomingMatches(sport) {
    const data = await this.fetchLiveContent(sport);
    const matches = parseMatchCards(data.upcoming_content || '');
    return matches.map(m => ({ ...m, sport: sport || 'football' }));
  }

  /**
   * Get matches that have commentators/streamers
   */
  async getCommentatorMatches(sport) {
    const data = await this.fetchLiveContent(sport);
    const matches = parseMatchCards(data.commentator_content || '');
    return matches.map(m => ({ ...m, sport: sport || 'football' }));
  }

  /**
   * Get hot matches
   */
  async getHotMatches(sport) {
    const data = await this.fetchLiveContent(sport);
    const matches = parseMatchCards(data.hot_content || '');
    return matches.map(m => ({ ...m, sport: sport || 'football' }));
  }

  /**
   * Get tomorrow's matches
   */
  async getTomorrowMatches(sport) {
    const data = await this.fetchLiveContent(sport);
    const matches = parseMatchCards(data.tomorrow_cards || '');
    return matches.map(m => ({ ...m, sport: sport || 'football' }));
  }

  /**
   * Get counts of matches in all categories
   */
  async getCounts(sport) {
    const data = await this.fetchLiveContent(sport);
    return {
      counts: data.counts || {},
      tomorrow_count: data.tomorrow_count || 0,
      tomorrow_date: data.tomorrow_date || ''
    };
  }

  /**
   * Load more matches via Gà Vàng filter-matches API
   */
  async getLoadMoreMatches({ date, league, offset, tab, sport } = {}) {
    let targetTab = tab || 'all';
    if (sport === 'basketball') {
      if (targetTab === 'all') targetTab = 'bb-all';
      else if (targetTab === 'live') targetTab = 'bb-live';
      else if (targetTab === 'upcoming') targetTab = 'bb-upcoming';
      else if (targetTab === 'hot') targetTab = 'bb-hot';
      else if (targetTab === 'with-stream') targetTab = 'bb-with-stream';
      else if (targetTab === 'tomorrow') targetTab = 'bb-tomorrow';
      else if (!String(targetTab).startsWith('bb-')) {
        targetTab = `bb-${targetTab}`;
      }
    }

    const payload = {
      date: date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }),
      league: league || null,
      offset: offset || 0,
      tab: targetTab,
      initial_load: false
    };

    try {
      const baseUrl = GAVANG_URLS.BASE_URL;
      console.log(`[gavang] Fetching from ${baseUrl}/wp-json/ba/v1/filter-matches, tab=${targetTab}, offset=${offset}`);
      
      const response = await this.client.post(
        `${baseUrl}/wp-json/ba/v1/filter-matches`,
        payload,
        {
          headers: {
            'content-type': 'application/json',
            accept: 'application/json'
          }
        }
      );

      const json = response.data;
      if (!json?.success || !json.data) {
        const reason = json?.message || 'No data returned';
        console.warn(`[gavang] API returned success=false: ${reason}`);
        throw new Error(`API returned: ${reason}`);
      }

      const matches = parseMatchCards(json.data.cards_html || '').map((m) => ({
        ...m,
        sport: sport || 'football'
      }));

      console.log(`[gavang] Got ${matches.length} matches, has_more=${json.data.has_more}`);
      return {
        matches,
        has_more: !!json.data.has_more,
        count: json.data.count || matches.length
      };
    } catch (error) {
      const status = error.response?.status;
      const bodySnippet = typeof error.response?.data === 'string' ? error.response.data.slice(0, 200) : JSON.stringify(error.response?.data || {}).slice(0, 200);
      console.error(`[gavang] Error in getLoadMoreMatches: ${error.message}${status ? ` (status ${status}, body: ${bodySnippet})` : ''}`);
      throw new Error(`Failed to load matches: ${error.message}${status ? ` (HTTP ${status})` : ''}`);
    }
  }

  /**
   * Fetch a stream detail page and extract the Match ID (uuid)
   */
  async getMatchIdFromUrl(liveUrl) {
    if (!liveUrl) throw new Error('URL is required');
    try {
      const response = await this.client.get(liveUrl);
      const $ = cheerio.load(response.data);
      const matchUuid = $('.match-container').attr('data-match-uuid');
      if (!matchUuid) {
        throw new Error('Could not find data-match-uuid on this page');
      }
      return matchUuid;
    } catch (error) {
      console.error('Error extracting Match ID from page:', error.message);
      throw new Error(`Failed to extract Match ID from ${liveUrl}: ${error.message}`);
    }
  }

  /**
   * Get stream links by Match ID.
   * 404 / missing file → [] (no streamers).
   * 429/5xx/network → throw so API returns 500 and clients can retry.
   */
  async getStreamLinksByMatchId(matchId) {
    if (!matchId) throw new Error('Match ID is required');

    const isNotFound = (error) => {
      const status = error?.response?.status;
      return status === 404 || status === 410;
    };
    const isTransient = (error) => {
      if (!error) return false;
      if (!error.response) return true;
      const status = error.response.status;
      return status === 408 || status === 425 || status === 429 || status >= 500;
    };

    const fetchStreamerJson = async (path) => {
      const url = `${GAVANG_URLS.BASE_URL}${path}`;
      const response = await this.client.get(url);
      return response.data;
    };

    let responseData = null;
    let footballError = null;

    try {
      responseData = await fetchStreamerJson(`/app/uploads/match-streamers/${matchId}.json`);
    } catch (error) {
      footballError = error;
      if (isTransient(error)) {
        throw new Error(`Transient error fetching streamers for ${matchId}: ${error.message}`);
      }
      if (!isNotFound(error)) {
        // Unknown client error — still try basketball path below
        console.warn(`Football streamers error for ${matchId}:`, error.message);
      }
    }

    if (!responseData) {
      try {
        responseData = await fetchStreamerJson(`/app/uploads/bb-match-streamers/${matchId}.json`);
      } catch (bbError) {
        if (isTransient(bbError)) {
          throw new Error(`Transient error fetching bb-streamers for ${matchId}: ${bbError.message}`);
        }
        if (!isNotFound(bbError) && !isNotFound(footballError)) {
          console.error(`Failed to fetch streamers for match ${matchId}:`, bbError.message);
        }
        return [];
      }
    }

    if (!responseData || !responseData.html) {
      return [];
    }

    const $ = cheerio.load(responseData.html);
    const streams = [];

    $('.commentator-card').each((index, element) => {
      const card = $(element);
      const m3u8Url = card.attr('data-stream-url') || '';
      const flvUrl = card.attr('data-stream-url-flv') || '';
      const cdn = card.attr('data-cdn') || '';
      const streamerName = card.attr('data-stream-name') || card.find('span').first().text().trim() || '';
      const streamerId = card.attr('data-streamer-id') || '';

      const img = card.find('img');
      const avatar = img.attr('data-src') || img.attr('src') || '';

      streams.push({
        streamerId,
        streamerName,
        streamerAvatar: avatar && !avatar.startsWith('data:image') ? avatar : '',
        m3u8Url,
        flvUrl,
        cdn
      });
    });

    return streams;
  }

  /**
   * FIX Gà Vàng "resource unavailable": trang gavangtv.* giờ nạp khung phát
   * trực tiếp bằng JavaScript phía client sau khi trang tải xong (không còn
   * nằm sẵn trong HTML tĩnh như trước — kiểm tra thực tế 15/08/2026 cho
   * thấy trang trận chỉ có "Đang tải..." trong HTML gốc, link thật gọi
   * riêng qua JS). getStreamLinksByMatchId() ở trên chỉ đọc HTML TĨNH
   * (cheerio, không chạy JS) nên không còn thấy được `.commentator-card`
   * hay link stream nữa với nhiều trận, dù trận vẫn đang live thật.
   *
   * Hàm này mở trình duyệt Chromium headless thật (xem browserFetch.js) để
   * trang tự chạy JS như người dùng thật, rồi đọc lại DOM đã render đầy đủ.
   * Thử theo 2 bước, từ rẻ tới đắt:
   *   1) Vẫn tìm `.commentator-card` như cũ nhưng trên DOM ĐÃ RENDER (giữ
   *      nguyên được streamerName/avatar/cdn nếu site còn dùng class đó).
   *   2) Nếu không thấy (site đổi hẳn tên class/cấu trúc) — quét toàn bộ
   *      HTML đã render tìm thẳng link .m3u8/.flv bằng regex (không phụ
   *      thuộc tên class, chỉ cần link còn xuất hiện đâu đó trong DOM).
   */
  async getStreamsViaBrowser(liveUrl) {
    if (!liveUrl) return [];
    let html = '';
    try {
      const rendered = await fetchRenderedHtml(liveUrl, {
        timeoutMs: 25000,
        waitForSelector: '.commentator-card, video, iframe',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      });
      html = rendered.html || '';
    } catch (err) {
      console.warn('[gavang] getStreamsViaBrowser: fetchRenderedHtml lỗi:', err.message);
      return [];
    }
    if (!html) return [];

    const streams = [];
    const $$ = cheerio.load(html);
    $$('.commentator-card').each((index, element) => {
      const card = $$(element);
      const m3u8Url = card.attr('data-stream-url') || '';
      const flvUrl = card.attr('data-stream-url-flv') || '';
      if (!m3u8Url && !flvUrl) return;
      streams.push({
        streamerId: card.attr('data-streamer-id') || '',
        streamerName: card.attr('data-stream-name') || card.find('span').first().text().trim() || `BLV ${index + 1}`,
        m3u8Url,
        flvUrl,
        cdn: card.attr('data-cdn') || ''
      });
    });

    if (!streams.length) {
      const clean = (u) => String(u || '').replace(/\\\//g, '/').trim();
      const m3u8Urls = [...new Set((html.match(/https?:[^'"\s<>\\]+?\.m3u8(?:\?[^'"\s<>\\]*)?/gi) || []).map(clean))];
      const flvUrls = [...new Set((html.match(/https?:[^'"\s<>\\]+?\.flv(?:\?[^'"\s<>\\]*)?/gi) || []).map(clean))];
      m3u8Urls.forEach((url, i) => streams.push({ streamerName: `BLV ${i + 1}`, m3u8Url: url, flvUrl: '' }));
      flvUrls.forEach((url, i) => streams.push({ streamerName: `BLV ${m3u8Urls.length + i + 1}`, m3u8Url: '', flvUrl: url }));
    }

    return streams;
  }

  /**
   * Điểm vào chính để lấy stream của 1 trận Gà Vàng — gộp cả 2 cách:
   *   1) Cách cũ (nhanh, ~1 request): tra theo matchId qua JSON tĩnh.
   *   2) Dự phòng (chậm hơn, ~2-4s mở trình duyệt): render trang thật bằng
   *      headless browser khi cách 1 không ra link nào — xem
   *      getStreamsViaBrowser() ở trên để biết lý do cần bước này.
   */
  async getStreamsForLiveUrl(liveUrl, matchId) {
    let streams = [];
    try {
      let id = matchId;
      if (!id && liveUrl) id = await this.getMatchIdFromUrl(liveUrl).catch(() => '');
      if (id) streams = await this.getStreamLinksByMatchId(id).catch(() => []);
    } catch {
      streams = [];
    }

    if (streams.length) return streams;
    if (!liveUrl) return [];

    return this.getStreamsViaBrowser(liveUrl);
  }

  /**
   * Lightweight live snapshot for watch-page polling (one upstream fetch).
   * Returns score / stats / status (+ teams) without streamer JSON.
   */
  async getMatchLiveSnapshot(slugOrId, sport = 'football') {
    if (!slugOrId) return null;
    const key = decodeURIComponent(String(slugOrId)).replace(/\/+$/, '').trim();

    const data = await this.fetchLiveContent(sport);
    const htmlChunks = [
      data.live_content,
      data.today_content,
      data.hot_content,
      data.upcoming_content,
      data.commentator_content,
      data.tomorrow_cards,
      data.tomorrow_content
    ];

    const seen = new Set();
    const all = [];
    for (const html of htmlChunks) {
      for (const m of parseMatchCards(html || '')) {
        if (!m?.matchId || seen.has(m.matchId)) continue;
        seen.add(m.matchId);
        if (!m.slug) m.slug = buildMatchSlug(m);
        all.push({ ...m, sport: sport || 'football' });
      }
    }

    let match = all.find((m) => m.matchId === key || m.slug === key);
    if (!match) {
      match = all.find((m) => extractSlugFromUrl(m.stream?.liveUrl) === key);
    }
    return match || null;
  }

  /**
   * Find a match by SEO slug or matchId across live content buckets.
   */
  async findMatchBySlugOrId(slugOrId, sport = 'football') {
    if (!slugOrId) return null;
    const key = decodeURIComponent(String(slugOrId)).replace(/\/+$/, '').trim();

    const buckets = await Promise.all([
      this.getLiveMatches(sport).catch(() => []),
      this.getTodayMatches(sport).catch(() => []),
      this.getHotMatches(sport).catch(() => []),
      this.getUpcomingMatches(sport).catch(() => []),
      this.getCommentatorMatches(sport).catch(() => []),
      this.getTomorrowMatches(sport).catch(() => [])
    ]);

    const seen = new Set();
    const all = [];
    for (const list of buckets) {
      for (const m of list) {
        if (!m?.matchId || seen.has(m.matchId)) continue;
        seen.add(m.matchId);
        if (!m.slug) m.slug = buildMatchSlug(m);
        all.push(m);
      }
    }

    let match = all.find((m) => m.matchId === key || m.slug === key);
    if (match) return match;

    // Slug may be passed while matchId is still the uuid from streamer JSON path
    match = all.find((m) => extractSlugFromUrl(m.stream?.liveUrl) === key);
    if (match) return match;

    // Fallback: treat key as live page slug and resolve uuid from upstream page
    try {
      const liveUrl = key.startsWith('http')
        ? key
        : `${GAVANG_URLS.BASE_URL}/truc-tiep/${key}/`;
      const matchId = await this.getMatchIdFromUrl(liveUrl);
      match = all.find((m) => m.matchId === matchId);
      if (match) return match;

      // Minimal stub so player still works when card list missed the match
      return {
        matchId,
        slug: extractSlugFromUrl(liveUrl) || key,
        stream: { liveUrl },
        homeTeam: { name: 'Home', logo: '' },
        awayTeam: { name: 'Away', logo: '' },
        score: { home: 0, away: 0 },
        status: { isLive: true, name: 'LIVE', elapsedTime: '' },
        competition: { name: '', logo: '' },
        stats: { halfTimeScore: '0-0', corners: '0-0', yellowCards: '0-0' }
      };
    } catch {
      return null;
    }
  }

  /**
   * Full watch-page payload: match info + m3u8 stream servers.
   */
  async getMatchDetail(slugOrId, sport = 'football') {
    const match = await this.findMatchBySlugOrId(slugOrId, sport);
    if (!match) return null;

    let matchId = match.matchId;
    if (!matchId && match.stream?.liveUrl) {
      matchId = await this.getMatchIdFromUrl(match.stream.liveUrl);
      match.matchId = matchId;
    }

    const streams = matchId ? await this.getStreamLinksByMatchId(matchId) : [];
    if (!match.slug) match.slug = buildMatchSlug(match);

    return { match, streams, matchId };
  }
}

module.exports = new CrawlerService();
