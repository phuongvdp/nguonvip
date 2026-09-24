import { createHttpClient } from '@/src/utils/httpClient';

// Phá Làng TV — domain hiển thị đã đổi sang phalang.live (trước đây dò ra là
// phalang.tv, ĐÃ SAI — xem FIX 18/09/2026 bên dưới). API thật nằm trên
// domain RIÊNG do người dùng cung cấp qua tab Network của trình duyệt.
//   - POST /matches/graph  (BẮT BUỘC có body, kể cả body rỗng {} — GET trả
//     405, POST không kèm body trả 422 "Field required") -> { data: [...], total }
//     Trả về TOÀN BỘ trận (không chỉ live) — is_live là boolean có sẵn
//     ngay trong từng phần tử, tự lọc live/upcoming ở code bên dưới.
//   - GET  /match/{id}/live -> { type, source, hd_1, hd_2, ... } (link phát)
//     Trận CHƯA có link (chưa live) trả 404 "EntityNotFound" — đây là phản
//     hồi HỢP LỆ của API (không phải lỗi/bị chặn), KHÔNG log ra console.error
//     như lỗi thật để tránh làm ồn log Vercel mỗi lần quét.
//
// FIX (18/09/2026 — "nguồn Phá Làng không hiển thị trận live"): bắt được
// request THẬT từ trình duyệt (tab Network trang phalang.live/trang-chu) và
// phát hiện 2 chỗ sai so với code cũ:
//   1) Referer cũ trỏ nhầm sang phalang.tv (domain cũ/không còn đúng) — trang
//      thật đang chạy ở phalang.live, kèm Origin cross-site
//      "https://phalang.live" mà code cũ không hề gửi.
//   2) Body cũ gửi {} (rỗng hoàn toàn). API vẫn nhận (không lỗi) nhưng khi đó
//      rơi vào limit/sắp xếp MẶC ĐỊNH của server — không có gì đảm bảo mặc
//      định đó liệt kê đủ toàn bộ trận (đặc biệt trận đang live, đá từ trước
//      đó lâu, dễ bị rơi khỏi trang đầu nếu mặc định sort khác
//      order_asc=start_date). Request thật của trình duyệt LUÔN kèm
//      limit/page/order_asc/queries tường minh — nay gửi đúng cấu trúc đó
//      (queries: [] để lấy tất cả, không lọc is_hot như tab "Hot" trên web),
//      dùng limit lớn (200) + tự phân trang qua `total` trả về để chắc chắn
//      lấy hết mọi trận trong 1 lần quét, không chỉ trang đầu.
const PHALANG_API_BASE = process.env.PHALANG_API_BASE || 'https://api.plapi202624081158.com';
const PHALANG_SITE_ORIGIN = 'https://phalang.live';
const PHALANG_LIST_PAGE_SIZE = 200;
// FIX (24/09/2026 — "bị mất các trận International Friendly, UEFA Nations
// League... có trên trang chủ Phá Làng mà danh sách nguồn không có"): log thật
// từ GitHub Actions cho thấy: API báo total=4925 nhưng CHỈ TRẢ 50 trận/trang
// (bỏ qua limit=200 mình gửi lên). Vòng lặp cũ dừng ngay khi "batch <
// PHALANG_LIST_PAGE_SIZE" (50 < 200) nên chỉ lấy đúng 1 trang đầu = 50 trận
// sớm nhất -> mất gần hết trận còn lại. Cách sửa (xem fetchList()):
//   - Dùng số trận/trang THỰC TẾ API trả (không giả định = limit đã gửi).
//   - Danh sách sắp theo start_date TĂNG DẦN và rất dài (~4900 trận, ~100
//     trang) -> KHÔNG kéo hết; tìm nhị phân trang bắt đầu của "cửa sổ thời
//     gian" [bây giờ - 12h, bây giờ + 48h] rồi chỉ kéo các trang trong cửa sổ.
//   - Gộp 2 lần gọi live/upcoming trong cùng 1 lượt quét dùng chung 1 lần lấy.
const PHALANG_WINDOW_PAST_MS = 12 * 60 * 60 * 1000; // trận đang live có thể đã bắt đầu tới ~12h trước (tennis/bóng rổ...)
const PHALANG_WINDOW_FUTURE_MS = 48 * 60 * 60 * 1000; // playlist chỉ dùng 24h tới, dư ra để an toàn
const PHALANG_FULL_FETCH_MAX_PAGES = 10; // tổng nhỏ (<= 10 trang) thì kéo hết, khỏi tìm nhị phân
const PHALANG_WINDOW_MAX_PAGES = 40; // trần an toàn số trang kéo trong cửa sổ
const PHALANG_LIST_CACHE_MS = 30 * 1000;

function phalangStartMs(m) {
  const t = m?.start_date ? Date.parse(`${m.start_date}Z`) : NaN; // start_date là UTC không kèm 'Z' (xem normalizeMatch)
  return Number.isFinite(t) ? t : NaN;
}

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

// FIX (24/09/2026 — "nguồn Phá Làng nhiều trận giải bé, giải cỏ quá, các nguồn
// khác OK rồi"): /matches/graph trả TOÀN BỘ trận (kể cả giải trẻ/dự bị/hạng
// thấp/ảo), trong khi các nguồn khác đã tự lọc sẵn.
// ĐỔI HƯỚNG (24/09/2026 — "muốn hướng 2"): bản đầu dùng danh sách giải LỚN
// (allowlist) nên liên tục loại nhầm giải thật (Nations League, Gulf Cup...).
// Giờ ngược lại: GIỮ TẤT CẢ, chỉ LOẠI trận bóng đá thuộc giải nhỏ rõ ràng
// (blocklist MINOR_LEAGUE_RE: giải trẻ U15-U23/youth, dự bị/reserve, hạng 3+,
// giải nghiệp dư/khu vực/hạng dưới Đức, bóng đá ảo/esoccer...). Các môn khác
// giữ nguyên. Một trận bóng đá luôn được GIỮ nếu:
//   1) API đánh dấu is_hot, HOẶC
//   2) là giao hữu (kiểm tra cả tên giải + tiêu đề), HOẶC
//   3) liên quan Việt Nam (đội tuyển/SEA Games/AFF/V-League...) — giữ cả U23/hạng dưới, HOẶC
//   4) tên giải chứa từ khoá trong PHALANG_KEEP_LEAGUES.
// Tinh chỉnh (đều dùng từ khoá KHÔNG DẤU, chữ thường, cách nhau bằng dấu phẩy):
//   - PHALANG_LEAGUE_FILTER=off      -> tắt lọc, lấy hết như cũ
//   - PHALANG_BLOCK_LEAGUES=a,b      -> thêm từ khoá giải muốn LOẠI
//   - PHALANG_KEEP_LEAGUES=a,b       -> thêm từ khoá giải luôn GIỮ (ưu tiên hơn blocklist)
// Mỗi lần quét in log số trận bị bỏ + tên các giải bị bỏ để dễ tinh chỉnh.
const MINOR_LEAGUE_RE = new RegExp([
  // giải trẻ / dự bị
  '\\bu-?(1\\d|2[0-3])\\b', '\\bunder ?(1\\d|2[0-3])\\b', 'youth', 'junior', 'juvenil', 'primavera', 'reserve', 'academy', '\\bdu bi\\b', '\\btre\\b',
  'premier league 2', 'development league',
  // nghiệp dư / hạng thấp / khu vực
  'amateur', 'regional', 'oberliga', 'landesliga', 'kreisliga', 'verbandsliga', 'serie d',
  '\\bhang (3|4|5|ba|tu|nam)\\b', '\\bdivision [3-9]\\b', '\\bleague (two|2)\\b',
  // bóng đá ảo / giải giả lập
  'esoccer', 'e-?soccer', 'e-?football', 'efootball', 'cyber', 'virtual', 'simulated', 'fifa ?2\\d', 'fc ?2\\d', 'battle'
].join('|'));

// Trận giao hữu luôn được giữ, kiểm tra trên CẢ tên giải lẫn tiêu đề trận và
// bỏ qua luật loại giải trẻ (xem FIX "bị mất các trận giao hữu").
const FRIENDLY_RE = /giao huu|giao luu|friendl|\bclub friendly\b|\bint(?:ernational)? ?cf\b|quoc te|international/;

const VIETNAM_RE = /viet ?nam|sea games|\baff\b|asean|v-?league/;

function stripDiacritics(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function envKeywordsRe(name) {
  const words = String(process.env[name] || '')
    .split(',')
    .map((w) => stripDiacritics(w).trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return words.length ? new RegExp(words.join('|')) : null;
}

const KEEP_LEAGUES_RE = envKeywordsRe('PHALANG_KEEP_LEAGUES') || envKeywordsRe('PHALANG_MAJOR_LEAGUES'); // MAJOR: tên biến cũ, giữ để tương thích
const BLOCK_LEAGUES_RE = envKeywordsRe('PHALANG_BLOCK_LEAGUES');

function isNotableMatch(match) {
  if (match?.sport !== 'football') return true; // chỉ lọc bóng đá
  if (match?.isHot) return true;

  const league = stripDiacritics(match?.competition?.name || '');
  const text = `${league} | ${stripDiacritics(match?.title || '')}`;

  if (FRIENDLY_RE.test(text)) return true;
  if (VIETNAM_RE.test(text)) return true;
  if (KEEP_LEAGUES_RE && KEEP_LEAGUES_RE.test(league)) return true;

  if (MINOR_LEAGUE_RE.test(text)) return false;
  if (BLOCK_LEAGUES_RE && BLOCK_LEAGUES_RE.test(league)) return false;
  return true; // mặc định GIỮ — chỉ loại khi khớp rõ giải nhỏ
}

export function filterPhalangMatches(matches = []) {
  if (String(process.env.PHALANG_LEAGUE_FILTER || '').toLowerCase() === 'off') {
    return { kept: matches, dropped: [] };
  }
  const kept = [];
  const dropped = [];
  for (const m of matches) (isNotableMatch(m) ? kept : dropped).push(m);
  return { kept, dropped };
}

class PhalangService {
  constructor() {
    this.client = createHttpClient({
      baseURL: PHALANG_API_BASE,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        Origin: PHALANG_SITE_ORIGIN,
        Referer: `${PHALANG_SITE_ORIGIN}/trang-chu`
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

    // FIX (18/09/2026 — "thời gian các trận bị lệch 7h"): start_date trả về
    // dạng "YYYY-MM-DDTHH:mm:ss" KHÔNG có múi giờ. Lần trước ĐOÁN đây là giờ
    // Việt Nam sẵn (gán '+07:00') — SAI, thực tế API trả giờ UTC, cộng thêm
    // +07:00 khi hiển thị (qua timeZone: 'Asia/Ho_Chi_Minh' bên dưới) làm giờ
    // bị cộng dồn 2 lần -> lệch hẳn 7 tiếng so với giờ thật. Đổi lại đúng như
    // ghi chú đã lường trước: coi start_date là UTC (gán 'Z') rồi mới quy đổi
    // sang giờ VN lúc format.
    const matchDate = m.start_date ? new Date(`${m.start_date}Z`) : new Date();
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
      // FIX (23/09/2026 — "nguồn Phá Làng: trận chưa thi đấu không xuất
      // hiện trong all.m3u"): trước đây liveUrl luôn để '' (rỗng). Ở chế độ
      // build tĩnh (không server, xem FIX 20/09/2026 trong m3uPlaylist.js),
      // matchesToPlaylistEntries() dùng đúng field này làm giá trị TẠM cho
      // trận chưa có link phát — rỗng thì bị coi là "không có gì để ghi" và
      // BỎ QUA hẳn (continue), nên mọi trận Phá Làng chưa live (gần như
      // luôn thiếu source_live) biến mất khỏi playlist, dù có giờ đá rõ
      // ràng. Phá Làng không trả về link trang riêng cho từng trận trong
      // /matches/graph, nên dùng tạm trang chủ (không phải link phát thật —
      // chỉ cần KHÁC RỖNG để không bị continue; đúng như comment ở
      // matchesToPlaylistEntries: giá trị này chỉ để hiển thị/tham khảo cho
      // tới khi trận live thật và có source_live).
      stream: { liveUrl: `${PHALANG_SITE_ORIGIN}/trang-chu#${m.id}`, streamerName: m.blv || null, streamerAvatar: null },
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

  /** Body giống hệt trình duyệt thật gửi lên /matches/graph (xem FIX 18/09/2026
   *  ở đầu file) — queries rỗng = không lọc theo is_hot/… như tab "Hot" trên
   *  web, lấy TOÀN BỘ trận để tự lọc live/upcoming ở code bên dưới. */
  buildListBody(page) {
    return {
      limit: PHALANG_LIST_PAGE_SIZE,
      page,
      order_asc: 'start_date',
      queries: []
    };
  }

  async fetchPage(page) {
    const { data } = await this.client.post(
      '/matches/graph',
      this.buildListBody(page),
      { params: { _t: Date.now() } }
    );
    const batch = Array.isArray(data?.data) ? data.data : [];
    const total = Number.isFinite(data?.total) ? data.total : batch.length;
    return { batch, total };
  }

  /** Lấy danh sách trận (dùng chung 30s giữa các lần gọi live/upcoming trong 1 lượt quét). */
  fetchList() {
    const now = Date.now();
    if (this._listCache && now - this._listCache.at < PHALANG_LIST_CACHE_MS) return this._listCache.promise;
    const promise = this.fetchListUncached().then((list) => {
      if (!list.length) this._listCache = null; // lỗi/rỗng -> không cache, lần sau thử lại
      return list;
    });
    this._listCache = { at: now, promise };
    return promise;
  }

  async fetchListUncached() {
    try {
      const pages = new Map(); // cache trang đã kéo trong lần này (tránh gọi lại khi tìm nhị phân)
      let requests = 0;
      const getPage = async (n) => {
        if (!pages.has(n)) {
          requests += 1;
          pages.set(n, await this.fetchPage(n));
        }
        return pages.get(n);
      };

      const first = await getPage(1);
      const total = first.total;
      const pageSize = first.batch.length; // số trận/trang THỰC TẾ (API có thể bỏ qua limit đã gửi)
      if (!pageSize) return [];
      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      // Tổng nhỏ -> kéo hết như cũ.
      if (totalPages <= PHALANG_FULL_FETCH_MAX_PAGES) {
        const all = [...first.batch];
        for (let n = 2; n <= totalPages; n++) all.push(...(await getPage(n)).batch);
        console.log(`[phalang] API total=${total}, ${pageSize} trận/trang -> kéo hết ${all.length} trận (${requests} request)`);
        return all;
      }

      const lastTimeOf = (page) => phalangStartMs(page.batch[page.batch.length - 1]);
      const firstTimeOf = (page) => phalangStartMs(page.batch[0]);
      const nowMs = Date.now();
      const lo = nowMs - PHALANG_WINDOW_PAST_MS;
      const hi = nowMs + PHALANG_WINDOW_FUTURE_MS;

      // Kiểm tra danh sách có thật sự sắp TĂNG DẦN theo giờ (trang đầu <= trang cuối).
      const lastPage = await getPage(totalPages);
      const ascending = firstTimeOf(first) <= lastTimeOf(lastPage);

      let startPage = 1;
      if (ascending) {
        // Tìm nhị phân trang NHỎ NHẤT có trận cuối >= lo (mọi trang trước đó toàn trận cũ hơn cửa sổ).
        let left = 1;
        let right = totalPages;
        while (left < right) {
          const mid = Math.floor((left + right) / 2);
          const t = lastTimeOf(await getPage(mid));
          if (Number.isFinite(t) && t < lo) left = mid + 1;
          else right = mid;
        }
        startPage = left;
      } else {
        console.warn('[phalang] CẢNH BÁO: danh sách API không sắp tăng dần theo giờ — kéo tuần tự từ trang 1, có thể sót trận.');
      }

      const all = [];
      let n = startPage;
      for (; n <= totalPages && n < startPage + PHALANG_WINDOW_MAX_PAGES; n++) {
        const page = await getPage(n);
        all.push(...page.batch);
        if (ascending) {
          const t = lastTimeOf(page);
          if (Number.isFinite(t) && t > hi) { n += 1; break; } // đã vượt cửa sổ tương lai
        }
      }
      const truncated = n <= totalPages && !(all.length && ascending && lastTimeOf({ batch: [all[all.length - 1]] }) > hi);
      console.log(
        `[phalang] API total=${total}, ${pageSize} trận/trang, ${totalPages} trang -> lấy trang ${startPage}-${n - 1} ` +
        `(${all.length} trận trong cửa sổ, ${requests} request)`
      );
      if (truncated) {
        console.warn(`[phalang] CẢNH BÁO: chạm trần ${PHALANG_WINDOW_MAX_PAGES} trang trong cửa sổ — có thể sót trận sắp đá.`);
      }
      return all;
    } catch (error) {
      console.error('Error fetching Phalang list:', error.message);
      return [];
    }
  }

  /** Interface giống các nguồn khác: gộp mọi type thành 1 danh sách, tự lọc theo tab ở code. */
  async getAllMatchesByTab(tab) {
    const raw = await this.fetchList();
    const normalized = raw.map((m) => this.normalizeMatch(m));
    // Lọc giải bé/giải cỏ (bóng đá) — xem filterPhalangMatches() phía trên.
    const { kept: all, dropped } = filterPhalangMatches(normalized);
    console.log(`[phalang] tab=${tab}: API trả ${raw.length} trận, sau lọc giải bé còn ${all.length}`);
    if (dropped.length) {
      const leagues = [...new Set(dropped.map((m) => m.competition?.name || '(không rõ giải)'))].slice(0, 15);
      console.log(`[phalang] tab=${tab}: bỏ ${dropped.length}/${normalized.length} trận giải bé — ${leagues.join(' | ')}`);
    }

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
      // 404 EntityNotFound = trận chưa có link phát (chưa live/nguồn chưa
      // cập nhật) — phản hồi HỢP LỆ của API, không phải lỗi thật, không log
      // ồn console mỗi lần quét. Chỉ log các lỗi khác (mạng, 5xx...).
      if (error.response?.status !== 404) {
        console.error('Error fetching Phalang stream links:', error.message);
      }
      return [];
    }
  }
}

const phalangService = new PhalangService();
export default phalangService;
