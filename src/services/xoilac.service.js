import * as cheerio from 'cheerio';
import { createHttpClient } from '@/src/utils/httpClient';
import { parseKickoffDate } from '@/src/utils/dateParse';

// LƯU Ý: domain gốc trong code là xoilacxtx.tv, nhưng trang này hiện khai báo
// canonical/CDN trỏ sang xoilacxtl.tv (đổi domain do bị chặn). Có thể đây là
// nguyên nhân chính khiến nguồn Xôi Lạc không quét ra link. Override qua biến
// môi trường XOILAC_BASE_URL trên Vercel khi domain đổi, không cần sửa code.
const XOILAC_BASE_URL = process.env.XOILAC_DOMAIN || process.env.XOILAC_BASE_URL || 'https://xoilacxtx.tv';

const LIVE_SCORE_APIS = {
  football: 'https://fb-api.sportliveapiz.com/football/match/detail_live',
  basketball: 'https://bkb.sportflowlivez.com/basketball/match/detail_live',
  tennis: 'https://tn.sportflowlivez.com/tennis/match/detail_live',
  badminton: 'https://badminton.sportflowlivez.com/badminton/match/detail_live',
  volleyball: 'https://volleyball.sportflowlivez.com/volleyball/match/detail_live',
  esports: 'https://esports.sportflowlivez.com/esports/match/detail_live'
};

// From Xoilac sport_data.*.status / status_playing
const FOOTBALL_STATUS = [
  'Bất thường',
  'Chưa bắt đầu',
  'Hiệp 1',
  'HT',
  'Hiệp 2',
  'Hiệp phụ',
  'Hiệp phụ',
  'Pen',
  'Kết thúc',
  'Trì hoãn',
  'Gián đoạn',
  'Cắt một nửa',
  'Hủy bỏ',
  'Chưa xác định'
];
const FOOTBALL_PLAYING = [2, 3, 4, 5, 6, 7];
const FOOTBALL_FINISHED = 8;

const BASKETBALL_STATUS = [
  'Bất thường',
  'Chưa bắt đầu',
  'Hiệp 1',
  'Hết hiệp 1',
  'Hiệp 2',
  'Hết hiệp 2',
  'Hiệp 3',
  'Hết hiệp 3',
  'Hiệp 4',
  'Hiệp phụ',
  'Kết thúc',
  'Gián đoạn',
  'Hủy bỏ',
  'Phần mở rộng',
  'Cắt một nửa',
  'Chưa xác định'
];
const BASKETBALL_PLAYING = [2, 3, 4, 5, 6, 7, 8, 9];
const BASKETBALL_FINISHED = 10;
const BASKETBALL_BREAK = [3, 5, 7]; // hết hiệp 1/2/3

// sport_data.esports
const ESPORTS_PLAYING = [2];
const ESPORTS_FINISHED = 3;

// sport_data.tennis / badminton / volleyball (status objects)
const RACKET_PLAYING = {
  tennis: [3, 51, 52, 53, 54, 55],
  badminton: [3, 51, 331, 52, 332, 53, 333, 54, 334, 55],
  volleyball: [3, 432, 434, 436, 438, 440]
};
const RACKET_FINISHED = 100;

/** Convert Xoilac's mixed timestamp/text markup to a reliable kickoff Date.
 *  (Dùng chung với các nguồn khác — xem src/utils/dateParse.js) */

class XoilacService {
  constructor() {
    this.baseUrl = XOILAC_BASE_URL;
    this.client = createHttpClient({
      baseURL: this.baseUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    this.scoreClient = createHttpClient({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        Referer: `${XOILAC_BASE_URL}/`
      }
    });
  }

  resolveLiveApiSport(sport = 'football') {
    const key = String(sport || 'football').toLowerCase();
    if (key === 'basketball' || key === 'bong-ro') return 'basketball';
    if (key === 'football' || key === 'bong-da') return 'football';
    if (key === 'tennis') return 'tennis';
    if (key === 'badminton' || key === 'cau-long') return 'badminton';
    if (key === 'volleyball' || key === 'bong-chuyen') return 'volleyball';
    if (key === 'esports' || key === 'csgo' || key === 'dota2' || key === 'lol') return 'esports';
    if (key === 'all' || !key) return 'football';
    return key;
  }

  putLiveMapEntry(map, id, payload) {
    if (id == null || id === '') return;
    map.set(id, payload);
    map.set(String(id), payload);
  }

  /**
   * Fetch live score map keyed by match fid from upstream detail_live API.
   */
  async fetchLiveScoreMap(sport = 'football') {
    const apiSport = this.resolveLiveApiSport(sport);
    const url = LIVE_SCORE_APIS[apiSport];
    if (!url) return new Map();

    try {
      const response = await this.scoreClient.get(url, {
        headers: {
          Origin: this.baseUrl,
          Referer: `${this.baseUrl}/`
        }
      });
      const results = response.data?.results || response.data || [];
      const map = new Map();
      if (!Array.isArray(results)) return map;

      if (apiSport === 'esports') {
        for (const item of results) {
          const id = item.match_id || item.id;
          if (!id) continue;
          const statusCode = Number(item.status_id);
          const isLive = ESPORTS_PLAYING.includes(statusCode);
          const isFinished = statusCode === ESPORTS_FINISHED;
          const homeScore = Number(item.home?.score ?? item.score?.[0] ?? 0);
          const awayScore = Number(item.away?.score ?? item.score?.[1] ?? 0);
          this.putLiveMapEntry(map, id, {
            score: { home: homeScore, away: awayScore },
            stats: { halfTimeScore: '0-0', corners: '0-0', yellowCards: '0-0' },
            status: {
              isLive,
              isFinished,
              isHalfTime: false,
              isUpcoming: !isLive && !isFinished,
              name: isFinished ? 'FT' : (isLive ? 'LIVE' : 'NS'),
              text: isFinished ? 'Kết thúc' : (isLive ? 'LIVE' : 'Sắp diễn ra'),
              elapsedTime: '',
              code: String(statusCode)
            }
          });
        }
        return map;
      }

      const isBasketball = apiSport === 'basketball';
      const isRacket = ['tennis', 'badminton', 'volleyball'].includes(apiSport);
      const statusNames = isBasketball ? BASKETBALL_STATUS : FOOTBALL_STATUS;
      const playingCodes = isBasketball
        ? BASKETBALL_PLAYING
        : (isRacket ? (RACKET_PLAYING[apiSport] || []) : FOOTBALL_PLAYING);
      const finishedCode = isBasketball
        ? BASKETBALL_FINISHED
        : (isRacket ? RACKET_FINISHED : FOOTBALL_FINISHED);

      for (const item of results) {
        const id = item.id || item.score?.[0];
        if (!id || !Array.isArray(item.score)) continue;

        const statusCode = Number(item.status_id ?? item.score[1]);

        // Football:  [id, status, homeScores[], awayScores[], ...]
        // Basketball:[id, status, flag, homeQuarters[], awayQuarters[], ...]
        let homeScores = [];
        let awayScores = [];
        let homeScore = 0;
        let awayScore = 0;

        if (isBasketball) {
          homeScores = Array.isArray(item.score[3])
            ? item.score[3]
            : (Array.isArray(item.score[2]) ? item.score[2] : []);
          awayScores = Array.isArray(item.score[4])
            ? item.score[4]
            : (Array.isArray(item.score[3]) && Array.isArray(item.score[2]) ? item.score[3] : []);
          homeScore = homeScores.slice(0, 5).reduce((s, n) => s + Number(n || 0), 0);
          awayScore = awayScores.slice(0, 5).reduce((s, n) => s + Number(n || 0), 0);
        } else {
          homeScores = Array.isArray(item.score[2]) ? item.score[2] : [];
          awayScores = Array.isArray(item.score[3]) ? item.score[3] : [];
          homeScore = Number(homeScores[0] ?? 0);
          awayScore = Number(awayScores[0] ?? 0);
          if (Number(homeScores[5]) > 0) homeScore = Number(homeScores[5]);
          if (Number(awayScores[5]) > 0) awayScore = Number(awayScores[5]);
        }

        const statusName = Array.isArray(statusNames)
          ? (statusNames[statusCode] || 'LIVE')
          : 'LIVE';
        const isFinished = statusCode === finishedCode;
        const isHalfTime = isBasketball
          ? BASKETBALL_BREAK.includes(statusCode)
          : (!isRacket && statusCode === 3);
        const isLive = playingCodes.includes(statusCode);

        const displayName = isFinished
          ? 'FT'
          : (isHalfTime
            ? (isBasketball ? statusName : 'HT')
            : (isRacket && isLive ? (statusName === 'LIVE' ? 'LIVE' : statusName) : statusName));

        this.putLiveMapEntry(map, id, {
          score: { home: homeScore, away: awayScore },
          stats: {
            halfTimeScore: `${homeScores[1] ?? 0}-${awayScores[1] ?? 0}`,
            corners: isBasketball || isRacket ? '0-0' : `${homeScores[4] ?? 0}-${awayScores[4] ?? 0}`,
            yellowCards: isBasketball || isRacket ? '0-0' : `${homeScores[3] ?? 0}-${awayScores[3] ?? 0}`
          },
          status: {
            isLive,
            isFinished,
            isHalfTime,
            isUpcoming: !isLive && !isFinished,
            name: displayName,
            text: isFinished
              ? 'Kết thúc'
              : (isLive ? displayName : 'Sắp diễn ra'),
            elapsedTime: '',
            code: String(statusCode)
          }
        });
      }
      return map;
    } catch (err) {
      console.warn(`Xoilac live score fetch failed (${apiSport}):`, err.message);
      return new Map();
    }
  }

  async enrichMatchesWithLiveScores(matches, sport = 'football') {
    if (!matches?.length) return matches;

    const apiSport = this.resolveLiveApiSport(sport);
    const sportsToFetch =
      sport === 'all'
        ? Object.keys(LIVE_SCORE_APIS)
        : (LIVE_SCORE_APIS[apiSport] ? [apiSport] : []);

    if (!sportsToFetch.length) return matches;

    const maps = {};
    await Promise.all(
      sportsToFetch.map(async (s) => {
        maps[s] = await this.fetchLiveScoreMap(s);
      })
    );

    return matches.map((match) => {
      const matchSport = this.resolveLiveApiSport(match.sport || apiSport);
      const scoreMap = maps[matchSport];
      if (!scoreMap?.size) return match;

      const live = scoreMap.get(match.originalId) || scoreMap.get(String(match.originalId || '').replace(/^xl_/, ''));
      if (!live) return match;

      return {
        ...match,
        score: live.score,
        stats: {
          ...(match.stats || {}),
          ...live.stats
        },
        status: {
          ...match.status,
          ...live.status
        }
      };
    });
  }

  normalizeScorePair(text) {
    const match = String(text || '').match(/(\d+)\s*[-:]\s*(\d+)/);
    return match ? `${match[1]}-${match[2]}` : null;
  }

  parseMatchesFromHtml(html) {
    if (!html) return [];
    const $ = cheerio.load(html);
    const matches = [];

    $('.main-grid-match').each((i, el) => {
      const fid = $(el).attr('data-fid') || $(el).attr('id');
      const leagueName = $(el).attr('data-league') || $(el).find('.gmd-match-league span').text().trim();
      const compIcon = $(el).find('.gmd-match-league img').attr('src') || '';

      const runtimeStr = $(el).attr('data-runtime');

      const sportSlug = $(el).attr('data-sport') || 'football';
      const hotAttr = ($(el).attr('data-hot') || '').toString().toLowerCase();
      const isHot = hotAttr.includes('1') || hotAttr.includes('on') || $(el).hasClass('match-hot') || $(el).find('.grid-match--is-hot').length > 0;
      const statusCode = $(el).attr('data-status');
      const isLive = $(el).hasClass('data-live-match') || statusCode === '2';
      const isFinished = statusCode === '3';

      const href = $(el).find('a.redirectPopup').attr('href') || $(el).find('a[href*="/truc-tiep/"]').attr('href') || '';

      const homeName = $(el).find('.gmd-home_team .team-name-group p, .gmd-home_team p').text().trim() ||
                       $(el).find('.home-team-name').text().trim();
      const homeLogo = $(el).find('.gmd-home_team img').attr('src') || '';

      const awayName = $(el).find('.gmd-away_team .team-name-group p, .gmd-away_team p').text().trim() ||
                       $(el).find('.away-team-name').text().trim();
      const awayLogo = $(el).find('.gmd-away_team img').attr('src') || '';

      const timeFormatted = $(el).find('.gmd-match-date span, .gmd-match-date, .match-time').first().text().trim();
      const matchDate = parseKickoffDate(runtimeStr, timeFormatted) || new Date();
      const matchTimestampSeconds = Math.floor(matchDate.getTime() / 1000);

      // Live stats block (HT / corners / yellow) — not H2H history
      const statsRoot = $(el).find('.grid-match__footer-left .match-item__goal-scoring').first().parent();
      const hasLiveStats = statsRoot.length > 0 && !statsRoot.hasClass('grid-match--flag-h2h');
      const halfTimeScore = hasLiveStats
        ? (this.normalizeScorePair(statsRoot.find('.half-court, .match-item__half-court').first().text()) || '0-0')
        : '0-0';
      const corners = hasLiveStats
        ? (this.normalizeScorePair(statsRoot.find('.corner-goal, .match-item__corner-goal').first().text()) || '0-0')
        : '0-0';
      const yellowCards = hasLiveStats
        ? (this.normalizeScorePair(statsRoot.find('.yellow-cards').first().text()) || '0-0')
        : '0-0';

      // Live/FT score — often filled by JS; fall back to HT when available
      let homeScore = 0;
      let awayScore = 0;
      const midScoreText = $(el).find('.gmd-mid_score').text().replace(/\s+/g, ' ').trim();
      const liveScore = this.normalizeScorePair(midScoreText);
      if (liveScore) {
        const [h, a] = liveScore.split('-').map(Number);
        homeScore = h;
        awayScore = a;
      } else if ((isLive || isFinished) && hasLiveStats) {
        const [h, a] = halfTimeScore.split('-').map(Number);
        homeScore = h || 0;
        awayScore = a || 0;
      }

      // Center clock text may say "HT" when site JS marks half-time
      const elapsedTime = $(el).find('.gmd-e_minutes, .t_time').text().replace(/\s+/g, ' ').trim();
      const isHalfTime = isLive && /^HT$/i.test(elapsedTime);

      let statusName = 'NS';
      let statusText = 'Sắp diễn ra';
      if (isFinished) {
        statusName = 'FT';
        statusText = 'Kết thúc';
      } else if (isHalfTime) {
        statusName = 'HT';
        statusText = 'HT';
      } else if (isLive) {
        statusName = 'LIVE';
        statusText = 'LIVE';
      }

      // Odds rows: [[h1, a1, u1], [h2, a2, u2]]
      const odds = [];
      $(el).find('.grid-match__odds-item').each((_, row) => {
        const vals = $(row).find('p').map((__, p) => $(p).text().trim()).get();
        if (vals.length >= 3) odds.push(vals.slice(0, 3));
      });
      const hasOdds = odds.some((row) => row.some((v) => v && v !== '-'));

      // Commentators
      const commentators = [];
      $(el).find('.grid-match__footer-center a.commentator').each((_, node) => {
        const name = $(node).find('span').last().text().trim() || $(node).text().replace(/\s+/g, ' ').trim();
        const avatar =
          $(node).find('image').attr('xlink:href') ||
          $(node).find('image').attr('href') ||
          $(node).find('img').attr('src') ||
          '';
        if (name) commentators.push({ name, avatar });
      });
      if (!commentators.length) {
        $(el).find('.grid-match__footer-center span').each((_, node) => {
          const name = $(node).text().replace(/\s+/g, ' ').trim();
          if (name && name.length < 40) commentators.push({ name, avatar: '' });
        });
      }

      const timeStr = matchDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' });
      const dateStr = matchDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

      const sportInfoMap = {
        football: { name: 'BÓNG ĐÁ', icon: 'fa-futbol' },
        basketball: { name: 'BÓNG RỔ', icon: 'fa-basketball' },
        volleyball: { name: 'BÓNG CHUYỀN', icon: 'fa-volleyball' },
        tennis: { name: 'TENNIS', icon: 'fa-baseball-bat-ball' },
        esports: { name: 'ESPORTS', icon: 'fa-gamepad' },
        csgo: { name: 'CSGO', icon: 'fa-gamepad' },
        dota2: { name: 'DOTA2', icon: 'fa-gamepad' }
      };

      const sportInfo = sportInfoMap[sportSlug] || { name: 'BÓNG ĐÁ', icon: 'fa-futbol' };
      const primaryCommentator = commentators[0] || null;

      if (homeName && awayName) {
        matches.push({
          matchId: `xl_${fid || i}`,
          originalId: fid,
          source: 'xoilac',
          sport: sportSlug,
          sportName: sportInfo.name,
          sportIcon: sportInfo.icon,
          competition: {
            name: leagueName || 'Giải đấu',
            icon: compIcon,
            logo: compIcon
          },
          homeTeam: {
            name: homeName,
            logo: homeLogo
          },
          awayTeam: {
            name: awayName,
            logo: awayLogo
          },
          score: {
            home: homeScore,
            away: awayScore
          },
          status: {
            isLive: isLive,
            isFinished,
            isHalfTime,
            name: statusName,
            text: statusText,
            elapsedTime: isHalfTime ? '' : elapsedTime,
            code: statusCode
          },
          stats: {
            halfTimeScore,
            corners,
            yellowCards
          },
          odds: hasOdds ? odds : null,
          matchTime: matchDate.getTime(),
          // BUG: từng gán nhầm bằng matchTimestampSeconds (đơn vị GIÂY) —
          // trong khi mọi service khác (giovang/ninety/phaohoa/vsc9) đều
          // lưu field này theo MILI-GIÂY. Lệch đơn vị x1000 làm toàn bộ
          // trận Xôi Lạc bị coi như xảy ra năm 1970 khi gộp sort chung ở
          // playlistBuilder.service.js -> phá vỡ thứ tự ngày/giờ của cả
          // danh sách. matchDate.getTime() ở trên đã đúng mili-giây sẵn.
          matchTimeTimestamp: matchDate.getTime(),
          dateStr: dateStr,
          timeStr: timeStr,
          timeFormatted: timeFormatted,
          isHot: isHot,
          commentators,
          streamers: commentators,
          stream: primaryCommentator
            ? {
                streamerName: primaryCommentator.name,
                streamerAvatar: primaryCommentator.avatar || '',
                liveUrl: href ? (href.startsWith('http') ? href : `${this.baseUrl}${href}`) : ''
              }
            : {
                streamerName: '',
                streamerAvatar: '',
                liveUrl: href ? (href.startsWith('http') ? href : `${this.baseUrl}${href}`) : ''
              },
          detailUrl: href ? (href.startsWith('http') ? href : `${this.baseUrl}${href}`) : '',
          slug: (() => {
            try {
              const { extractSlugFromUrl } = require('@/src/utils/slug');
              const full = href ? (href.startsWith('http') ? href : `${this.baseUrl}${href}`) : '';
              return extractSlugFromUrl(full) || '';
            } catch {
              return '';
            }
          })()
        });
      }
    });

    return matches;
  }

  async getAllMatches() {
    try {
      const response = await this.client.get('/');
      const matches = this.parseMatchesFromHtml(response.data);
      return this.enrichMatchesWithLiveScores(matches, 'all');
    } catch (err) {
      console.error('Error fetching Xoilac matches:', err.message);
      return [];
    }
  }

  tabToFilterKey(tab = 'all') {
    const map = {
      live: 'now',
      now: 'now',
      hot: 'hot',
      commentator: 'commentator',
      'with-stream': 'commentator',
      today: 'today',
      tomorrow: 'tomorrow',
      upcoming: 'all',
      all: 'all'
    };
    return map[tab] || 'all';
  }

  /**
   * Official filter API used by Xoilac tabs:
   * GET /sport/{sport}/filter/{now|hot|commentator|today|tomorrow|all}
   * Response: { success, data: { count, htmls: [htmlChunk, ...] } }
   */
  async fetchMatchesByFilter(filter = 'all', sport = 'football') {
    const sportSlug = this.resolveSportPaneId(sport || 'football');
    const filterKey = filter || 'all';
    const url = `/sport/${sportSlug}/filter/${filterKey}`;

    const response = await this.client.get(url, {
      headers: {
        Accept: '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${this.baseUrl}/`
      }
    });

    const payload = response.data;
    if (!payload?.success || !payload.data) {
      throw new Error(`Unexpected Xoilac filter response for ${filterKey}`);
    }

    const htmls = Array.isArray(payload.data.htmls)
      ? payload.data.htmls
      : (payload.data.html ? [payload.data.html] : []);

    const matches = [];
    for (const chunk of htmls) {
      matches.push(...this.parseMatchesFromHtml(chunk || ''));
    }

    // Dedupe by matchId (chunks shouldn't overlap, but be safe)
    const seen = new Set();
    const unique = [];
    for (const m of matches) {
      if (seen.has(m.matchId)) continue;
      seen.add(m.matchId);
      unique.push(m);
    }

    const enriched = await this.enrichMatchesWithLiveScores(unique, sportSlug);
    // After live-score merge, keep only truly in-play for "now"
    const byKickoff = (a, b) =>
      (a.matchTimeTimestamp || Number.MAX_SAFE_INTEGER) - (b.matchTimeTimestamp || Number.MAX_SAFE_INTEGER);
    if (filterKey === 'now') {
      return enriched.filter((m) => m.status?.isLive).sort(byKickoff);
    }
    return enriched.sort(byKickoff);
  }

  filterMatches(matches, tab = 'all', sport = 'all') {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

    let filtered = matches || [];

    if (sport && sport !== 'all') {
      const paneId = this.resolveSportPaneId(sport);
      filtered = filtered.filter((m) =>
        m.sport === sport ||
        m.sport === paneId ||
        (sport === 'basketball' && m.sport === 'basketball') ||
        (sport === 'football' && m.sport === 'football')
      );
    }

    if (tab === 'live') {
      filtered = filtered.filter((m) => m.status?.isLive);
    } else if (tab === 'upcoming') {
      filtered = filtered.filter((m) => !m.status?.isLive && !m.status?.isFinished);
    } else if (tab === 'hot') {
      filtered = filtered.filter((m) => m.isHot);
    } else if (tab === 'commentator' || tab === 'with-stream') {
      filtered = filtered.filter((m) => (m.commentators && m.commentators.length > 0) || (m.streamers && m.streamers.length > 0));
    } else if (tab === 'today') {
      filtered = filtered.filter((m) => m.dateStr === todayStr);
    } else if (tab === 'tomorrow') {
      filtered = filtered.filter((m) => m.dateStr === tomorrowStr);
    }

    return filtered;
  }

  /**
   * Filter API returns the full tab list on initial fetch — no extra pages.
   */
  async getLoadMoreMatches({ sport = 'football', page = 1, tab = 'all' } = {}) {
    return {
      matches: [],
      has_more: false,
      count: 0,
      page: Math.max(1, parseInt(page, 10) || 1),
      next_page: null,
      total_pages: 1,
      tab,
      sport
    };
  }

  async getMatchesByTab(tab = 'all', sport = 'football') {
    const sportSlug = !sport || sport === 'all' ? 'football' : sport;
    const filterKey = this.tabToFilterKey(tab);

    try {
      // Prefer official filter endpoint (full today/tomorrow/hot/BLV/all/live lists)
      return await this.fetchMatchesByFilter(filterKey, sportSlug);
    } catch (err) {
      console.warn(`Xoilac filter ${filterKey} failed, fallback homepage:`, err.message);
      const allMatches = await this.getAllMatches();
      return this.filterMatches(allMatches, tab, sportSlug);
    }
  }

  resolveSportPaneId(sport = 'football') {
    const map = {
      football: 'football',
      'bong-da': 'football',
      basketball: 'basketball',
      'bong-ro': 'basketball',
      tennis: 'tennis',
      badminton: 'badminton',
      'cau-long': 'badminton',
      volleyball: 'volleyball',
      'bong-chuyen': 'volleyball',
      esports: 'esports',
      lol: 'esports',
      dota2: 'esports',
      csgo: 'esports'
    };
    return map[sport] || sport || 'football';
  }

  /**
   * Official tab counts from homepage `.list-filter` inside each sport pane
   * (#football, #basketball, ...). LIVE is 0 in SSR and filled by live-score API.
   */
  parseOfficialFilterCounts(html, sport = 'football') {
    const $ = cheerio.load(html || '');
    const empty = { live: 0, hot: 0, commentator: 0, today: 0, tomorrow: 0, all: 0 };

    const readFilter = ($root) => {
      const counts = { ...empty };
      $root.find('a[data-filter]').each((_, a) => {
        const key = $(a).attr('data-filter');
        const num = parseInt($(a).find('.num').first().text().trim(), 10);
        if (!Number.isFinite(num)) return;
        if (key === 'now') counts.live = num;
        else if (key === 'hot') counts.hot = num;
        else if (key === 'commentator') counts.commentator = num;
        else if (key === 'today') counts.today = num;
        else if (key === 'tomorrow') counts.tomorrow = num;
        else if (key === 'all') counts.all = num;
      });
      return counts;
    };

    if (!sport || sport === 'all') {
      const totals = { ...empty };
      $('#football, #basketball, #tennis, #badminton, #volleyball, #esports').each((_, pane) => {
        const c = readFilter($(pane).find('.list-filter').first());
        totals.live += c.live;
        totals.hot += c.hot;
        totals.commentator += c.commentator;
        totals.today += c.today;
        totals.tomorrow += c.tomorrow;
        totals.all += c.all;
      });
      return totals;
    }

    const paneId = this.resolveSportPaneId(sport);
    const $pane = $(`#${paneId}`);
    if ($pane.length) {
      return readFilter($pane.find('.list-filter').first());
    }
    // Fallback: first list-filter (football)
    return readFilter($('.list-filter').first());
  }

  parseSportMatchIds(html) {
    const match = String(html || '').match(/var ids\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return {};
    try {
      return JSON.parse(match[1]);
    } catch {
      return {};
    }
  }

  countLiveFromMap(map, allowedIds = null) {
    const set = Array.isArray(allowedIds) && allowedIds.length ? new Set(allowedIds.map(String)) : null;
    const seen = new Set();
    let n = 0;
    for (const [id, live] of map.entries()) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!live?.status?.isLive) continue;
      if (set && !set.has(key)) continue;
      n += 1;
    }
    return n;
  }

  async getLiveCount(sport = 'football', sportIds = {}) {
    const paneId = this.resolveSportPaneId(sport);

    const countFor = async (apiSport, idKey) => {
      const map = await this.fetchLiveScoreMap(apiSport);
      return this.countLiveFromMap(map, sportIds[idKey]);
    };

    if (sport === 'all') {
      const keys = Object.keys(LIVE_SCORE_APIS);
      const parts = await Promise.all(keys.map((k) => countFor(k, k)));
      return parts.reduce((a, b) => a + b, 0);
    }

    if (LIVE_SCORE_APIS[paneId]) {
      return countFor(paneId, paneId);
    }
    return null;
  }

  async getCounts(sport = 'football') {
    const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const sportKey = sport || 'football';

    try {
      const response = await this.client.get('/');
      const html = response.data;
      const counts = this.parseOfficialFilterCounts(html, sportKey);
      const sportIds = this.parseSportMatchIds(html);

      // 1) detail_live ∩ fixture ids (same idea as Xoilac badges)
      const liveFromApi = await this.getLiveCount(sportKey, sportIds);
      if (liveFromApi != null) {
        counts.live = liveFromApi;
      }

      // 2) Sync with LIVE tab list so badge never says 0 while cards are shown
      try {
        const liveList = await this.getMatchesByTab('live', sportKey);
        const listLive = (liveList || []).filter((m) => m.status?.isLive).length;
        if (listLive > 0 || liveFromApi == null) {
          counts.live = Math.max(counts.live || 0, listLive);
        }
        // If API under-counts vs list (e.g. esports HTML live), prefer list
        if (listLive > (counts.live || 0)) {
          counts.live = listLive;
        }
      } catch {
        // keep api/SSR value
      }

      return {
        ...counts,
        tomorrow_date: tomorrowStr
      };
    } catch (err) {
      console.error('Error getting Xoilac counts:', err.message);
      return { live: 0, hot: 0, commentator: 0, today: 0, tomorrow: 0, all: 0, tomorrow_date: tomorrowStr };
    }
  }

  detectCdn(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('tencent') || u.includes('tlivecdn')) return 'TENCENT';
    if (u.includes('alibaba') || u.includes('aliyun')) return 'ALIBABA';
    if (u.includes('golivenow')) return 'GOLIVE';
    if (u.includes('livestreambong') || u.includes('vncdn')) return 'VNBONG';
    if (u.includes('fast5cdn') || u.includes('mv-')) return 'FASTCDN';
    if (u.includes('streambylivepulse') || u.includes('procdnlive') || u.includes('bpmedialive')) return 'PULSE';
    if (u.includes('scorecast') || u.includes('xl365')) return 'XL365';
    return 'HLS';
  }

  /**
   * Xoilac embed types: 1/3/4/6/10 → m3u8 (often bad TLS cert), 5/7/8/9 → flv.
   * Prefer FLV types 7/8 (streambylivepulse — valid cert) then m3u8 mirrors.
   */
  expandEmbedCandidates(embedUrl) {
    const raw = String(embedUrl || '').trim();
    if (!raw) return [];
    const urls = new Set();
    const m = raw.match(/^(https?:\/\/[^/]+\/ajax\/chanel\/type\/)\d+(\/link\/[^/?#]+.*)$/i);
    if (m) {
      // FLV with valid cert first
      for (const t of [7, 8, 5, 9, 1, 3, 4, 6, 10]) {
        urls.add(`${m[1]}${t}${m[2]}`);
      }
    } else {
      urls.add(raw);
    }
    return [...urls];
  }

  /**
   * Parse list_stream = [[embed,...],[embed,...]] from match HTML.
   */
  parseListStream(html) {
    const m = String(html || '').match(/var\s+list_stream\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return [];
    try {
      const parsed = JSON.parse(m[1].replace(/'/g, '"'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  parsePlayerLinkMeta($) {
    const links = [];
    $('#tv_links a.player-link').each((i, el) => {
      const href = $(el).attr('href') || '';
      const name = $(el).text().replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
      const linkId = $(el).attr('data-link');
      const fullUrl = href
        ? (href.startsWith('http') ? href : `${this.baseUrl}${href}`)
        : '';
      links.push({
        index: Number.isFinite(Number(linkId)) ? Number(linkId) : i,
        name: name || `Server ${i + 1}`,
        href: fullUrl,
        dataLink: linkId
      });
    });
    return links;
  }

  /**
   * Resolve embed page → playable urlStream (prefer m3u8).
   */
  async resolveEmbedStream(embedUrl) {
    if (!embedUrl) return null;
    try {
      const response = await this.client.get(embedUrl, {
        headers: {
          Referer: `${this.baseUrl}/`,
          Accept: 'text/html,application/xhtml+xml,*/*'
        }
      });
      const html = typeof response.data === 'string' ? response.data : String(response.data || '');
      const urlStream = (html.match(/var\s+urlStream\s*=\s*"([^"]+)"/) || [])[1] || '';
      const isFlv = /var\s+isFlv\s*=\s*true/.test(html);
      if (!urlStream) return null;
      if (urlStream.includes('youtube.com')) return null;

      const isM3u8 = /\.m3u8(\?|$)/i.test(urlStream) || (!isFlv && !/\.flv(\?|$)/i.test(urlStream));
      return {
        url: urlStream,
        isFlv: !!isFlv && !/\.m3u8(\?|$)/i.test(urlStream),
        isM3u8,
        embedUrl
      };
    } catch (err) {
      console.warn('Xoilac embed resolve failed:', embedUrl, err.message);
      return null;
    }
  }

  /**
   * Resolve best playable URL for one BLV channel (Xoilac shows 1 button per BLV).
   * Tries FLV pulse first (valid TLS), then other types — returns a single pick.
   */
  async resolveBestForChannel(embedUrls = []) {
    const seen = new Set();
    const candidates = [];
    for (const embedUrl of embedUrls) {
      for (const candidate of this.expandEmbedCandidates(embedUrl)) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        const typeNum = Number((String(candidate).match(/\/type\/(\d+)\//) || [])[1] || 0);
        let tier = 50;
        if (typeNum === 7 || typeNum === 8) tier = 0;
        else if (typeNum === 5 || typeNum === 9) tier = 10;
        else if ([1, 3, 4, 6, 10].includes(typeNum)) tier = 20;
        candidates.push({ embedUrl: candidate, tier });
      }
    }
    candidates.sort((a, b) => a.tier - b.tier);

    // Cap attempts per channel
    const limited = candidates.slice(0, 6);
    for (const item of limited) {
      const info = await this.resolveEmbedStream(item.embedUrl);
      if (!info?.url) continue;
      const isM3u8 = /\.m3u8(\?|$)/i.test(info.url);
      const isFlv = /\.flv(\?|$)/i.test(info.url) || info.isFlv;
      if (!isM3u8 && !isFlv) continue;
      return {
        url: info.url,
        isFlv,
        isM3u8,
        embedUrl: item.embedUrl,
        cdn: this.detectCdn(info.url)
      };
    }
    return null;
  }

  /**
   * Fetch match page → one stream per Xoilac BLV button (same as site UI).
   */
  async getStreams(detailUrl) {
    if (!detailUrl) return [];
    try {
      const pageUrl = detailUrl.startsWith('http') ? detailUrl : `${this.baseUrl}${detailUrl}`;
      const response = await this.client.get(pageUrl);
      const html = typeof response.data === 'string' ? response.data : String(response.data || '');
      const $ = cheerio.load(html);
      const linkMeta = this.parsePlayerLinkMeta($);
      const listStream = this.parseListStream(html);

      if (!listStream.length && !linkMeta.length) return [];

      const maxLinks = Math.max(listStream.length, linkMeta.length);
      const channels = [];

      for (let i = 0; i < maxLinks; i++) {
        const meta = linkMeta.find((l) => l.index === i) || linkMeta[i] || {
          index: i,
          name: `Server ${i + 1}`,
          href: ''
        };
        const embeds = Array.isArray(listStream[i])
          ? listStream[i].filter(Boolean)
          : [];
        if (!embeds.length) continue;
        channels.push({ meta, embeds });
      }

      // Resolve each BLV in parallel — one playable URL each
      const resolved = await Promise.all(
        channels.map(async (ch) => {
          const best = await this.resolveBestForChannel(ch.embeds);
          return { ...ch, best };
        })
      );

      const streams = [];
      for (const item of resolved) {
        const best = item.best;
        if (!best?.url) continue;
        const isFlv = !!best.isFlv;
        streams.push({
          id: `xl_stream_${item.meta.index}`,
          streamerId: item.meta.dataLink || item.meta.index,
          title: item.meta.name,
          name: item.meta.name,
          streamerName: item.meta.name,
          avatar: '',
          streamerAvatar: '',
          liveUrl: item.meta.href || pageUrl,
          link: best.url,
          m3u8Url: best.isM3u8 ? best.url : '',
          flvUrl: isFlv ? best.url : '',
          playMode: isFlv ? 'flv' : 'hls',
          cdn: best.cdn || '',
          quality: 'HD',
          embedUrl: best.embedUrl
        });
      }

      return streams;
    } catch (err) {
      console.error(`Error fetching streams for ${detailUrl}:`, err.message);
      return [];
    }
  }

  /**
   * Find match across filter tabs by slug / xl_id / fid.
   */
  async findMatchBySlugOrId(slugOrId, sport = 'football') {
    if (!slugOrId) return null;
    const key = decodeURIComponent(String(slugOrId)).replace(/\/+$/, '').trim();
    const cleanId = key.replace(/^xl_/, '');
    const { extractSlugFromUrl, buildMatchSlug } = require('@/src/utils/slug');

    const matchesKey = (m) =>
      m.matchId === key
      || m.matchId === `xl_${cleanId}`
      || String(m.originalId) === cleanId
      || m.slug === key
      || extractSlugFromUrl(m.detailUrl) === key
      || extractSlugFromUrl(m.stream?.liveUrl) === key;

    const ensureSlug = (m) => {
      if (!m.slug) {
        m.slug = extractSlugFromUrl(m.detailUrl || m.stream?.liveUrl) || buildMatchSlug(m);
      }
      return m;
    };

    // Prefer live first (fast path for watch pages)
    const priorityTabs = ['live', 'today', 'hot'];
    const restTabs = ['commentator', 'upcoming', 'tomorrow', 'all'];

    for (const tab of priorityTabs) {
      try {
        const list = await this.getMatchesByTab(tab, sport);
        const hit = (list || []).map(ensureSlug).find(matchesKey);
        if (hit) return hit;
      } catch {
        // continue
      }
    }

    const settled = await Promise.allSettled(
      restTabs.map((tab) => this.getMatchesByTab(tab, sport).catch(() => []))
    );

    for (const res of settled) {
      if (res.status !== 'fulfilled') continue;
      for (const m of res.value || []) {
        if (!m?.matchId) continue;
        ensureSlug(m);
        if (matchesKey(m)) return m;
      }
    }

    return null;
  }

  async getMatchDetail(slugOrId, sport = 'football') {
    const { buildMatchSlug, extractSlugFromUrl } = require('@/src/utils/slug');
    let match = await this.findMatchBySlugOrId(slugOrId, sport);

    // Fallback: treat as live page slug and build stub for stream resolve
    if (!match) {
      const key = decodeURIComponent(String(slugOrId)).replace(/\/+$/, '').trim();
      const detailUrl = key.startsWith('http')
        ? key
        : `${this.baseUrl}/truc-tiep/${key}/`;
      match = {
        matchId: `xl_${key}`,
        slug: extractSlugFromUrl(detailUrl) || key,
        source: 'xoilac',
        sport: sport || 'football',
        sportName: 'BÓNG ĐÁ',
        homeTeam: { name: 'Home', logo: '' },
        awayTeam: { name: 'Away', logo: '' },
        score: { home: 0, away: 0 },
        status: { isLive: true, name: 'LIVE', elapsedTime: '' },
        stats: { halfTimeScore: '0-0', corners: '0-0', yellowCards: '0-0' },
        competition: { name: '', logo: '' },
        detailUrl,
        stream: { liveUrl: detailUrl }
      };
    }

    if (!match.slug) {
      match.slug = extractSlugFromUrl(match.detailUrl || match.stream?.liveUrl) || buildMatchSlug(match);
    }

    const detailUrl = match.detailUrl || match.stream?.liveUrl;
    const streams = detailUrl ? await this.getStreams(detailUrl) : [];
    return { match, streams, matchId: match.matchId };
  }

  async getMatchLiveSnapshot(slugOrId, sport = 'football') {
    const match = await this.findMatchBySlugOrId(slugOrId, sport);
    return match || null;
  }
}

const xoilacService = new XoilacService();
export default xoilacService;
