import { createHttpClient } from '@/src/utils/httpClient';

// Domain này cũng thuộc dạng hay đổi domain mirror (đã thấy siteUrl thật
// trong config là vip3.saoketv40.xyz, khác domain người dùng gửi ban đầu) —
// override qua SAOKE_DOMAIN khi cần.
const SAOKE_BASE_URL = process.env.SAOKE_DOMAIN || process.env.SAOKE_BASE_URL || 'https://vip3.saoketv40.xyz';

const client = createHttpClient(
  {
    baseURL: SAOKE_BASE_URL,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8'
    },
    timeout: 8000
  },
  { maxAttempts: 2 }
);

// ---------------------------------------------------------------------------
// Giải mã payload Nuxt 3 (__NUXT_DATA__): 1 mảng "phẳng" JSON hợp lệ, trong
// đó số nguyên ở vị trí field/element nghĩa là "tham chiếu tới arr[i]" (chỉ
// đúng 1 lần dereference tại vị trí đó — giá trị lấy ra ở arr[i] là giá trị
// CUỐI CÙNG, kể cả khi giá trị đó tình cờ cũng là số nguyên (ví dụ timestamp
// hay cờ 0/1) — KHÔNG được dereference tiếp giá trị đã lấy ra, nếu không sẽ
// vòng lặp sai/tràn chỉ số). Đã tự viết + test kỹ bằng dữ liệu thật (Python)
// trước khi chuyển sang đây, xác nhận đúng.
const NUXT_REACTIVE_TAGS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef']);

function decodeNuxtPayload(rawJsonText) {
  const arr = JSON.parse(rawJsonText);

  // "Xử lý cấu trúc" 1 giá trị ĐÃ dereference xong — chỉ đi sâu vào list/dict
  // của CHÍNH giá trị này (mỗi field/element bên trong lại là 1 tham chiếu
  // mới, gọi resolveRef); giá trị nguyên thuỷ (string/number/bool/null) trả
  // thẳng, KHÔNG dereference thêm.
  function processValue(v) {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'string' && NUXT_REACTIVE_TAGS.has(v[0])) {
        return v.length > 1 ? resolveRef(v[1]) : null;
      }
      if (v.length && v[0] === 'Set') return [];
      return v.map((x) => resolveRef(x));
    }
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = resolveRef(v[k]);
      return out;
    }
    return v;
  }

  // "Giải tham chiếu" 1 slot field/element — nếu là số nguyên thì lấy
  // arr[v] rồi xử lý cấu trúc; ngược lại (đã là list/dict/nguyên thuỷ ngay
  // tại chỗ, hiếm khi xảy ra ở top-level nhưng vẫn xử lý cho chắc) xử lý
  // trực tiếp.
  function resolveRef(v) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < arr.length) {
      return processValue(arr[v]);
    }
    return processValue(v);
  }

  return resolveRef(0);
}

function extractNuxtPayload(html) {
  const marker = 'id="__NUXT_DATA__">';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const end = html.indexOf('</script>', from);
  if (end === -1) return null;
  try {
    return decodeNuxtPayload(html.slice(from, end));
  } catch (error) {
    console.error('Error decoding SaoKe __NUXT_DATA__ payload:', error.message);
    return null;
  }
}
// ---------------------------------------------------------------------------

// CẢNH BÁO (24/09/2026): 2 CDN thấy được ở nguồn này —
// stream.hdplaylink.com và edgemaxcdn.org — CHÍNH LÀ 2 CDN đã xác nhận
// chặn cứng bất kể Referer khi debug nguồn Chuối Chiến (xem lịch sử FIX
// trong src/utils/m3uPlaylist.js) — test bằng VLC desktop + trình duyệt
// thật, không phải do IP máy chủ CI. Rất có thể stream của Sao Kê Live TV
// cũng KHÔNG xem được từ file .m3u tĩnh với cùng lý do (nhiều khả năng cần
// cookie/token phiên riêng). Vẫn viết đầy đủ vì có thể nguồn này dùng thêm
// CDN khác cho 1 số trận, và để sẵn sàng nếu sau này 2 CDN này được gỡ chặn.
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
  const detailUrl = slug ? `${SAOKE_BASE_URL}/${slug}.html` : '';

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
    // Nguồn này KHÔNG hiện tỉ số/số phút trên trang chủ (dữ liệu payload
    // không có field score/elapsed nào) — để mặc định, không suy diễn bừa.
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
      liveUrl: detailUrl || `${SAOKE_BASE_URL}/`,
      streamerName: commentators[0]?.name || null,
      streamerAvatar: commentators[0]?.avatar || null
    },
    odds: null
  };
}

class SaoKeService {
  async fetchHomeMatches() {
    const { data: html } = await client.get('/');
    const payload = extractNuxtPayload(html);
    const raw = payload?.state?.['$shome-lives'];
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeMatch);
  }

  async getAllMatchesByTab(tab, sport = 'all') {
    try {
      const all = await this.fetchHomeMatches();
      let filtered = all;
      if (tab === 'live') filtered = all.filter((m) => m.status.isLive);
      else if (tab === 'upcoming') filtered = all.filter((m) => m.status.isUpcoming);
      if (sport !== 'all') filtered = filtered.filter((m) => m.sport === sport);

      // Theo đúng yêu cầu trước đó (chỉ lấy trận có BLV) — trận live mà
      // không BLV nào có link (hlsUrls rỗng) thì bỏ hẳn, không hiện placeholder.
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
