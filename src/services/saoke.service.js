import { createHttpClient } from '@/src/utils/httpClient';

// Domain trang xem (chỉ dùng để build link "trang chi tiết" hiển thị tạm
// khi chưa có link phát) — cũng thuộc dạng hay đổi domain mirror, override
// qua SAOKE_DOMAIN khi cần.
const SAOKE_SITE_URL = process.env.SAOKE_DOMAIN || process.env.SAOKE_BASE_URL || 'https://vip3.saoketv40.xyz';

// FIX (24/09/2026 — "thiếu nhiều trận so với trên web", rồi "chỉ quét được
// 4 trận"): bản đầu đọc payload Nuxt (__NUXT_DATA__) nhúng sẵn trong HTML
// trang chủ — nhưng payload đó CHỈ chứa 1 danh sách rút gọn (16 trận lúc
// lấy mẫu, có lúc chỉ còn 4), không phải toàn bộ lịch. Người dùng tự bắt
// được đúng API JSON THẬT mà chính trang web gọi để lấy danh sách đầy đủ:
// GET https://skapi.66887979.xyz/v2/saoke/home-data — trả về ĐẦY ĐỦ hơn
// nhiều (22 trận lúc kiểm tra, so với 16 của bản Nuxt payload), là JSON
// thuần, KHÔNG cần giải mã gì cả (khác hẳn __NUXT_DATA__ trước đây) — bỏ
// toàn bộ phần giải mã Nuxt phức tạp, gọi thẳng API này cho gọn và đủ hơn.
const SAOKE_API_BASE_URL = process.env.SAOKE_API_DOMAIN || 'https://skapi.66887979.xyz';

const client = createHttpClient(
  {
    baseURL: SAOKE_API_BASE_URL,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      Referer: `${SAOKE_SITE_URL}/`
    },
    timeout: 15000
  },
  { maxAttempts: 3, retryDelayMs: 1000 }
);

function detectCdn(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('hdplaylink')) return 'HDPLAYLINK';
  if (u.includes('edgemaxcdn')) return 'EDGEMAX';
  if (u.includes('cloudflare')) return 'CLOUDFLARE';
  return 'HLS';
}

function pickBestHls(hlsUrls) {
  if (!Array.isArray(hlsUrls) || !hlsUrls.length) return '';
  const hd = hlsUrls.find((h) => /hd/i.test(h?.name || ''));
  return (hd || hlsUrls[0])?.url || '';
}

function buildCommentators(blvs) {
  const list = [];
  for (const b of Array.isArray(blvs) ? blvs : []) {
    const url = pickBestHls(b?.hlsUrls);
    if (!url) continue;
    list.push({
      id: b?.keyId || b?.name || `blv_${list.length}`,
      name: b?.name || 'BLV',
      avatar: null,
      streamUrl: url,
      isLive: true,
      cdn: detectCdn(url)
    });
  }
  return list;
}

function mapStreams(match) {
  const list = [];
  const seen = new Set();
  for (const c of match?.commentators || []) {
    const url = c.streamUrl || '';
    if (!url || seen.has(url)) continue;
    seen.add(url);
    list.push({
      id: c.id,
      streamerId: c.id,
      name: c.name,
      streamerName: c.name,
      avatar: c.avatar,
      streamerAvatar: c.avatar,
      link: url,
      m3u8Url: url,
      playUrl: url,
      format: 'hls',
      cdn: c.cdn,
      quality: 'HD'
    });
  }
  return list;
}

function normalizeMatch(m) {
  const matchDate = new Date(Number(m?.time) || Date.now());
  const isLive = m?.status === 'live';
  const isFinished = m?.status === 'finished' || m?.status === 'ft';
  const isUpcoming = !isLive && !isFinished;
  const commentators = isLive ? buildCommentators(m?.blvs) : [];

  const timeStr = matchDate.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh'
  });
  const dateStr = matchDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const dd = String(matchDate.getDate()).padStart(2, '0');
  const mm = String(matchDate.getMonth() + 1).padStart(2, '0');
  const slug = m?.slug || m?.nameNoUtf8 || m?._id || '';
  const detailUrl = slug ? `${SAOKE_SITE_URL}/${slug}.html` : '';

  return {
    matchId: `sk_${m?._id || slug}`,
    originalId: m?._id || slug,
    slug,
    detailUrl,
    source: 'saoke',
    sport: 'football',
    sportName: 'BÓNG ĐÁ',
    sportIcon: 'fa-futbol',
    competition: { name: m?.league?.name || '', logo: m?.league?.picture || '', icon: m?.league?.picture || '' },
    homeTeam: { name: m?.teamA?.name || 'Home', logo: m?.teamA?.picture || '' },
    awayTeam: { name: m?.teamB?.name || 'Away', logo: m?.teamB?.picture || '' },
    // Nguồn này không trả tỉ số/số phút qua API — để mặc định, không suy diễn bừa.
    score: { home: 0, away: 0 },
    status: {
      isLive,
      isFinished,
      isHalfTime: false,
      isUpcoming,
      name: isLive ? 'LIVE' : isFinished ? 'FT' : 'Sắp diễn ra',
      text: isLive ? 'LIVE' : isFinished ? 'Kết thúc' : 'Sắp diễn ra',
      elapsedTime: '',
      minutes: ''
    },
    stats: { halfTimeScore: '0-0', corners: '0-0', yellowCards: '0-0' },
    matchTime: matchDate.getTime(),
    matchTimeTimestamp: matchDate.getTime(),
    timeFormatted: `${timeStr} - ${dd}/${mm}`,
    dateStr,
    timeStr,
    isHot: !!m?.isHot,
    commentators,
    streamers: commentators,
    streamUrl: commentators[0]?.streamUrl || '',
    stream: {
      // Trận chưa live/không có BLV -> vẫn khác rỗng (trỏ trang chi tiết),
      // xem FIX 23/09/2026 trong phalang.service.js — cùng lý do, cùng cách sửa.
      liveUrl: detailUrl || `${SAOKE_SITE_URL}/`,
      streamerName: commentators[0]?.name || null,
      streamerAvatar: commentators[0]?.avatar || null
    },
    odds: null
  };
}

class SaoKeService {
  async fetchHomeMatches() {
    const { data } = await client.get('/v2/saoke/home-data');
    const lives = data?.data?.lives;
    if (!Array.isArray(lives)) return [];
    return lives.map(normalizeMatch);
  }

  async getAllMatchesByTab(tab, sport = 'all') {
    try {
      const all = await this.fetchHomeMatches();
      let filtered = all;
      if (tab === 'live') filtered = all.filter((m) => m.status.isLive);
      else if (tab === 'upcoming') filtered = all.filter((m) => m.status.isUpcoming);
      if (sport !== 'all') filtered = filtered.filter((m) => m.sport === sport);

      // Theo yêu cầu trước đó (chỉ lấy trận có BLV) — trận live không BLV
      // nào có link thì bỏ hẳn, không hiện placeholder.
      filtered = filtered.filter((m) => !m.status.isLive || m.commentators.length > 0);

      return { matches: filtered, hasMore: false, totalCount: filtered.length };
    } catch (error) {
      console.error(`Error fetching SaoKe tab ${tab}:`, error.message);
      return { matches: [], hasMore: false, totalCount: 0 };
    }
  }

  async getStreamLinks(matchId) {
    try {
      const all = await this.fetchHomeMatches();
      const cleanId = String(matchId).replace(/^sk_/, '');
      const match = all.find((m) => m.originalId === cleanId || m.matchId === matchId || m.slug === matchId);
      if (!match) return [];
      return mapStreams(match);
    } catch (error) {
      console.error('Error fetching SaoKe stream links:', error.message);
      return [];
    }
  }
}

const saokeService = new SaoKeService();
export default saokeService;
