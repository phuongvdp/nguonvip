/** Sport category tabs for home page (align with Gavang / Xoilac / Phaohoa). */
export const SPORT_TABS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'football', label: 'Bóng đá' },
  { id: 'basketball', label: 'Bóng rổ' },
  { id: 'volleyball', label: 'Bóng chuyền' },
  { id: 'badminton', label: 'Cầu lông' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'esports', label: 'Esports' }
].filter(({ id }) => id !== 'esports');

const SPORT_ALIASES = {
  football: 'football',
  soccer: 'football',
  'bong-da': 'football',
  basketball: 'basketball',
  'bong-ro': 'basketball',
  volleyball: 'volleyball',
  'bong-chuyen': 'volleyball',
  badminton: 'badminton',
  'cau-long': 'badminton',
  tennis: 'tennis',
  esports: 'esports',
  esport: 'esports',
  lol: 'esports',
  dota2: 'esports',
  csgo: 'esports'
};

const SOURCE_LABELS = {
  gavang: 'Ga Vang TV',
  gavangtv: 'Ga Vang TV',
  phaohoa: 'Phao Hoa TV',
  xoilac: 'Xoi Lac TV',
  'xoilac-affcup': 'Xoilac AFF Cup 2026',
  '90phut': '90 Phut TV',
  vsc9: 'VuaSanCo (VSC9)',
  giovang: 'Gio Vang TV'
};

const SOURCE_SHORT = {
  gavang: 'Gà Vàng',
  gavangtv: 'Gà Vàng',
  phaohoa: 'Pháo Hoa',
  xoilac: 'Xôi Lạc',
  'xoilac-affcup': 'AFF Cup',
  '90phut': '90 Phút',
  vsc9: 'VSC9',
  giovang: 'Giờ Vàng'
};

// Thứ tự nhóm theo nguồn dùng chung cho danh sách trên trang quét lẫn file
// playlist .m3u, để cả hai nơi hiển thị nhất quán.
export const SOURCE_GROUP_ORDER = ['xoilac', 'phaohoa', 'gavang', 'giovang'];

// Danh sách nguồn dùng để vẽ công tắc bật/tắt trên giao diện. Giữ đồng bộ
// với SOURCE_GROUP_ORDER — mỗi nguồn 1 công tắc, người dùng tự chọn nguồn
// nào muốn hiện/ẩn, lưu lại trên trình duyệt (localStorage) nên vẫn còn
// nguyên sau khi tải lại trang.
export const SOURCE_TOGGLE_LIST = [
  { key: 'xoilac', label: 'Xôi Lạc' },
  { key: 'phaohoa', label: 'Pháo Hoa' },
  { key: 'gavang', label: 'Gà Vàng' },
  { key: 'giovang', label: 'Giờ Vàng' },
  { key: 'vsc9', label: 'VSC9' },
  { key: '90phut', label: '90 Phút' },
  { key: 'xoilac-affcup', label: 'AFF Cup' },
  { key: 'custom', label: 'Tùy chỉnh' }
].filter(({ key }) => !['90phut', 'xoilac-affcup', 'custom', 'vsc9'].includes(key));

// Bump the key once so an old browser setting cannot hide every source after
// the source list/status handling changes. New choices are still persisted.
const SOURCE_TOGGLE_STORAGE_KEY = 'player-get:enabled-sources:v2';

/** Mặc định: tất cả nguồn đều bật. */
export function getDefaultEnabledSources() {
  return SOURCE_TOGGLE_LIST.reduce((acc, s) => {
    acc[s.key] = true;
    return acc;
  }, {});
}

/** Đọc trạng thái bật/tắt nguồn đã lưu trên trình duyệt (an toàn cho SSR). */
export function loadEnabledSources() {
  const defaults = getDefaultEnabledSources();
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(SOURCE_TOGGLE_STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}

/** Lưu trạng thái bật/tắt nguồn vào trình duyệt. */
export function saveEnabledSources(enabledSources) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SOURCE_TOGGLE_STORAGE_KEY,
      JSON.stringify(enabledSources || {})
    );
  } catch {
    // localStorage có thể bị chặn (chế độ ẩn danh...) — bỏ qua, không critical.
  }
}

/** True nếu nguồn của trận đang được bật (mặc định bật khi chưa có key). */
export function isSourceEnabled(match, enabledSources) {
  const key = getSourceKey(match);
  if (!enabledSources) return true;
  return enabledSources[key] !== false;
}

// Từ khoá nhận diện giải "cỏ"/nghiệp dư/giao hữu phong trào, hạng dưới —
// chỉnh sửa mảng này nếu muốn lọc chặt/lỏng hơn. So khớp không dấu, không
// phân biệt hoa thường trên tên giải đấu (competition.name). Áp dụng cho
// TẤT CẢ nguồn (kể cả Pháo Hoa/AFF Cup/90 Phút).
export const MINOR_LEAGUE_KEYWORDS = [
  'giao huu',       // friendly
  'phong trao',     // grassroots
  'nghiep du',      // amateur
  'giai co',        // "giải cỏ" (sân cỏ nhân tạo, phủi)
  'san co',
  'phu i',
  'phui',
  'futsal phong trao',
  'hang nhi',       // hạng nhì / league two (nhiều nước)
  'hang ba',        // hạng ba / league three
  'hang tu',
  'reserve',        // đội trẻ/dự bị
  'du bi',
  'cup lang',
  'cup xa',
  'giai xa',
  'giai phuong',
  'giai quan',
  'giai huyen',
  'thieu nien',     // giải thiếu niên nhi đồng
  'nhi dong',
  'giai tinh',      // giải tỉnh/thành phố phong trào
  'giai truong',    // giải trường học
  'giai noi bo',    // giải nội bộ công ty/cơ quan
  'cup doanh nghiep',
  'cup cong ty',
  'the thao hoc duong',
  'sinh vien',      // giải sinh viên
  'cong nhan',      // giải công nhân viên chức
  've lang',        // "về làng" — giao lưu phong trào
  'giai tre',       // giải trẻ (U-series các nước) — vd "Giải Trẻ Ukrainian"
  'hang 2',         // "Hạng 2 <nước>" — dạng số, khác với "hạng nhì" chữ ở trên
  'hang 3',
  'hang 4',
  'esiliiga',       // giải hạng dưới Estonia — vd "Hạng 3 Esiliiga"
  // Hạng 2/3/4+ của các giải nhà nghề lớn — chặn tường minh để KHÔNG bị
  // whitelist bên dưới "vồ nhầm" qua so khớp chuỗi con (vd tên giải hạng 2
  // Đức vẫn chứa chữ "bundesliga").
  'hang nhat',              // Giải hạng Nhất QG Việt Nam (dưới V-League)
  '2. bundesliga',
  'zweite bundesliga',
  '3. liga',
  'regionalliga',
  'segunda division',
  'segunda liga',
  'primera rfef',
  'la liga 2',
  'laliga 2',
  'laliga2',
  'smartbank',
  'ligue 2',
  'national 1',
  'national 2',
  'serie b',
  'serie c',
  'serie d',
  'league one',
  'league two',
  'national league',
  'championship',    // hạng 2 Anh (EFL Championship)
  'eerste divisie',  // hạng 2 Hà Lan (khác Eredivisie)
  'challenger pro league',
  'tff 1. lig',
  'tff 2. lig',
  'tff 3. lig',
  'j2 league',
  'j3 league',
  'k league 2',
  'thai league 2',
  'liga expansion',  // hạng 2 Mexico
  'primera b',
  'primera nacional',
  'segunda profesional'
];

// Tên giải đấu "rỗng"/mặc định mà các nguồn scrape trả về khi không nhận
// diện được giải thật sự (ví dụ Xôi Lạc fallback về "Giải đấu" khi không
// tìm thấy tên giải trên trang) — luôn coi là trận không rõ nguồn gốc.
const GENERIC_COMPETITION_NAMES = ['giai dau', 'giai bong da', 'khac', 'n/a', 'update'];

// Whitelist các giải VĐQG hạng 1 + giải/cúp quốc tế chính thức — CHỈ trận
// nào khớp 1 trong các mục này mới được coi là "giải chuyên nghiệp". Khớp
// theo chuỗi con, không dấu, không phân biệt hoa thường trên competition.name.
// Danh sách không thể đầy đủ 100% mọi quốc gia — nếu thấy thiếu giải nào
// bạn hay xem, cứ báo tên giải đó để bổ sung thêm.
export const PRO_LEAGUE_KEYWORDS = [
  // --- Châu Âu (hạng 1) ---
  'ngoai hang anh', 'premier league', 'epl',
  'la liga', 'laliga', 'vdqg tay ban nha',
  'serie a',
  'bundesliga',
  'ligue 1',
  'primeira liga', 'liga portugal', 'vdqg bo dao nha',
  'eredivisie',
  'jupiler pro league', 'belgian pro league',
  'super lig',
  'scottish premiership',
  'osterreichische bundesliga', 'austrian bundesliga',
  'swiss super league',
  'super league greece', 'greek super league',
  'russian premier league',
  'ukrainian premier league',
  'eliteserien',
  'allsvenskan',
  'superliga',
  'veikkausliiga',
  'ekstraklasa',
  'liga i',
  'hnl',              // Croatia
  // --- Nam Mỹ ---
  'brasileirao serie a', 'brasileiro serie a', 'campeonato brasileiro',
  'liga profesional argentina', 'primera division argentina',
  'liga betplay',
  'primera division',   // hạng 1 ở đa số nước Nam Mỹ (Peru, Ecuador, Uruguay, Chile, Paraguay, Venezuela, Bolivia...)
  'copa libertadores',
  'copa sudamericana',
  // --- Bắc Mỹ ---
  'major league soccer', 'mls',
  'liga mx',
  // --- Châu Á ---
  'saudi pro league', 'saudi professional league', 'roshn saudi league',
  'j1 league', 'j-league 1', 'jleague',
  'k league 1', 'k-league 1',
  'chinese super league',
  'qatar stars league',
  'uae pro league', 'arabian gulf league', 'adnoc pro league',
  'thai league 1', 'thai league',
  'v-league', 'v.league', 'vleague', 'giai vdqg', 'vo dich quoc gia',
  'liga 1',              // Indonesia (và Romania)
  'super league malaysia', 'malaysia super league',
  'indian super league',
  // --- Châu Phi ---
  'egyptian premier league',
  'caf champions league',
  // --- Cúp quốc gia lớn (vẫn là trận chuyên nghiệp) ---
  'fa cup', 'carabao cup', 'efl cup', 'league cup',
  'copa del rey', 'dfb pokal', 'coppa italia', 'coupe de france', 'taca de portugal',
  // --- Giải/cúp quốc tế cấp đội tuyển & CLB ---
  'world cup', 'fifa world cup', 'vong loai world cup',
  'uefa champions league', 'champions league', 'cup c1',
  'europa league', 'cup c2',
  'europa conference league', 'conference league', 'cup c3',
  'copa america',
  'afc champions league', 'afc cup',
  'afcon', 'african cup of nations', 'cup of nations',
  'uefa nations league', 'nations league',
  'asian cup',
  'aff cup', 'aff championship', 'asean championship',
  'uefa euro', 'vck euro'
];

function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function normalizedCompetitionName(match) {
  const name = match?.competition?.name || match?.tournament || '';
  return stripDiacritics(name).trim();
}

/** True when a match's competition name looks like a minor/amateur league,
 *  or the source couldn't even identify a real competition name for it. */
export function isMinorLeagueMatch(match) {
  const normalized = normalizedCompetitionName(match);
  if (!normalized) return true;
  if (GENERIC_COMPETITION_NAMES.includes(normalized)) return true;
  return MINOR_LEAGUE_KEYWORDS.some((kw) => normalized.includes(stripDiacritics(kw)));
}

/** True khi tên giải khớp với 1 giải VĐQG hạng 1 / cúp quốc tế đã biết. */
export function isRecognizedProCompetition(match) {
  const normalized = normalizedCompetitionName(match);
  if (!normalized) return false;
  return PRO_LEAGUE_KEYWORDS.some((kw) => normalized.includes(stripDiacritics(kw)));
}

/**
 * True khi trận nên bị loại khỏi danh sách.
 * - Mọi nguồn: loại trận rơi vào danh sách "cỏ"/phong trào/hạng dưới đã
 *   nhận diện rõ tên (MINOR_LEAGUE_KEYWORDS), hoặc không có tên giải.
 * - Riêng Gà Vàng & Xôi Lạc (2 nguồn hay lẫn trận nhỏ nhất): CHỈ giữ lại
 *   trận thuộc giải đã được nhận diện là chuyên nghiệp (PRO_LEAGUE_KEYWORDS)
 *   — bất cứ giải nào không khớp whitelist (hạng 2/3/4, giải lạ, không rõ
 *   nguồn...) đều bị loại theo đúng yêu cầu "chỉ để lại giải chuyên nghiệp".
 */
export function isJunkMatch(match) {
  if (isMinorLeagueMatch(match)) return true;

  const key = getSourceKey(match);
  if (key === 'gavang' || key === 'xoilac') {
    return !isRecognizedProCompetition(match);
  }

  return false;
}

export function normalizeSport(sport) {
  if (!sport) return 'other';
  const key = String(sport).toLowerCase().trim();
  return SPORT_ALIASES[key] || 'other';
}

export function getSourceKey(match) {
  const raw = match?.source || 'gavang';
  if (raw === 'gavangtv') return 'gavang';
  return raw;
}

export function getSourceLabel(matchOrSource) {
  const key = typeof matchOrSource === 'string'
    ? (matchOrSource === 'gavangtv' ? 'gavang' : matchOrSource)
    : getSourceKey(matchOrSource);
  const customLabel = typeof matchOrSource === 'object' ? matchOrSource?.sourceLabel : '';
  return SOURCE_LABELS[key] || customLabel || key;
}

export function getSourceShortLabel(matchOrSource) {
  const key = typeof matchOrSource === 'string'
    ? (matchOrSource === 'gavangtv' ? 'gavang' : matchOrSource)
    : getSourceKey(matchOrSource);
  const customLabel = typeof matchOrSource === 'object' ? matchOrSource?.sourceLabel : '';
  return SOURCE_SHORT[key] || customLabel || key;
}

export function getApiSource(match) {
  const key = getSourceKey(match);
  if (key === 'phaohoa') return 'phaohoa';
  if (key === 'xoilac') return 'xoilac';
  if (key === 'xoilac-affcup') return 'affcup';
  if (key === '90phut') return 'ninety';
  if (key === 'vsc9') return 'vsc9';
  if (key === 'giovang') return 'giovang';
  return 'gavang';
}

export function isM3u8Url(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.m3u8(\?|$)/i.test(url);
}

export function isFlvUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.flv(\?|$)/i.test(url);
}

/** Many Xoilac CDNs expose HLS twin of the FLV path. */
export function flvToM3u8Candidate(url) {
  if (!isFlvUrl(url)) return '';
  return url.replace(/\.flv(?=\?|$)/i, '.m3u8');
}

export function isPlayableStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (isM3u8Url(url) || isFlvUrl(url)) return true;
  // Chấp nhận URL CDN stream hợp lệ không có phần mở rộng .m3u8/.flv
  // (Tencent liveplay, Alibaba/AliCDN, phaohoa, và các CDN phổ biến khác)
  const u = url.toLowerCase();
  const knownCdn =
    u.includes('tlivecdn') ||
    u.includes('liveplay') ||
    u.includes('tencent') ||
    u.includes('aliyun') ||
    u.includes('alicdn') ||
    u.includes('phaohoa') ||
    u.includes('bpmedialive') ||
    u.includes('procdnlive') ||
    u.includes('scorecast') ||
    u.includes('xl365') ||
    u.includes('golivenow') ||
    u.includes('vncdn') ||
    u.includes('livestreambong') ||
    u.includes('/live/') ||
    u.includes('/stream/') ||
    u.includes('/hls/');
  return knownCdn;
}

/**
 * Normalize stream objects for the live playlist page.
 * Accepts HLS (.m3u8) and FLV (Xoilac). Prefers m3u8; derives m3u8 twin from flv when needed.
 */
export function normalizeStreamList(list = []) {
  return (list || [])
    .map((s) => {
      const raw = s.m3u8Url || s.link || s.streamUrl || s.flvUrl || '';
      const flvUrl = s.flvUrl || (isFlvUrl(raw) ? raw : '');
      let m3u8Url = '';
      if (isM3u8Url(s.m3u8Url)) m3u8Url = s.m3u8Url;
      else if (isM3u8Url(raw)) m3u8Url = raw;
      else if (flvUrl) m3u8Url = flvToM3u8Candidate(flvUrl);

      // Prefer real HLS; else keep FLV as playable copy target
      const playUrl = (isM3u8Url(s.m3u8Url) && s.m3u8Url)
        || (isM3u8Url(raw) && raw)
        || flvUrl
        || m3u8Url
        || raw;

      const format = isM3u8Url(playUrl) ? 'hls' : (isFlvUrl(playUrl) ? 'flv' : 'url');

      return {
        ...s,
        m3u8Url: playUrl,
        flvUrl: flvUrl || (isFlvUrl(playUrl) ? playUrl : ''),
        playUrl,
        format,
        streamerName: s.streamerName || s.name || 'Server',
        streamerAvatar: s.streamerAvatar || s.avatar || '',
        cdn: s.cdn || ''
      };
    })
    .filter((s) => isPlayableStreamUrl(s.playUrl || s.m3u8Url));
}

/** Extract streams already present on Phaohoa list cards. */
export function streamsFromMatchCard(match) {
  if (Array.isArray(match?.streams) && match.streams.length) {
    const list = normalizeStreamList(match.streams);
    return list.length ? list : null;
  }

  if (match?.source !== 'phaohoa') return null;

  const fromCommentators = (match.commentators || match.streamers || [])
    .filter((c) => c.streamUrl || c.link || c.m3u8Url)
    .map((c) => ({
      id: c.id,
      name: c.name,
      streamerName: c.name,
      avatar: c.avatar,
      streamerAvatar: c.avatar,
      link: c.streamUrl || c.link || c.m3u8Url,
      m3u8Url: c.streamUrl || c.link || c.m3u8Url,
      cdn: c.cdn || ''
    }));

  if (fromCommentators.length) {
    const list = normalizeStreamList(fromCommentators);
    return list.length ? list : null;
  }

  if (match.streamUrl && isPlayableStreamUrl(match.streamUrl)) {
    return normalizeStreamList([{
      name: 'Server 1',
      streamerName: 'Server 1',
      link: match.streamUrl,
      m3u8Url: match.streamUrl
    }]);
  }

  return null;
}

export function matchCacheKey(match) {
  return match?.matchId || match?.stream?.liveUrl || '';
}

/**
 * Different sources report matchTimeTimestamp in different units
 * (Gà Vàng/Xoilac: seconds, Pháo Hoa: milliseconds). Normalize to ms
 * so sorting/filtering across sources lines up correctly.
 */
export function toMatchTimeMs(ts) {
  if (!ts) return 0;
  return ts < 99999999999 ? ts * 1000 : ts;
}

/** True when a match's kickoff falls within the next `hours` (default 24h). */
export function isWithinNextHours(match, hours = 24) {
  const ms = toMatchTimeMs(match?.matchTimeTimestamp);
  if (!ms) return false;
  const now = Date.now();
  return ms > now && ms <= now + hours * 60 * 60 * 1000;
}

/** True when a match hasn't started and isn't finished yet (any source). */
export function isUpcomingMatch(match) {
  const status = match?.status || {};
  if (status.isLive || status.isFinished) return false;
  if (status.isUpcoming) return true;
  // Sources without an explicit isUpcoming flag (e.g. Xoilac): infer from time.
  return isWithinNextHours(match, 24 * 7);
}

/**
 * True khi trận đang được đánh dấu "sắp diễn ra" nhưng giờ bóng lăn đã qua
 * (tức dữ liệu đã cũ / nguồn chưa cập nhật trạng thái sang live/FT).
 * Dùng để hiện badge "Đang kiểm tra..." hoặc ẩn nút xem thay vì hiện stream lỗi.
 */
export function isStaleUpcoming(match) {
  const status = match?.status || {};
  if (status.isLive || status.isFinished) return false;
  const ms = toMatchTimeMs(match?.matchTimeTimestamp);
  if (!ms) return false;
  // Coi là stale nếu giờ dự kiến đã qua nhưng vẫn chưa được đánh dấu live
  return ms < Date.now();
}

// Thời lượng "live" hợp lý tối đa theo môn — quá mốc này mà vẫn được đánh
// dấu live thì nhiều khả năng trận đã kết thúc từ lâu và nguồn (hay gặp
// nhất: Gà Vàng) chưa cập nhật lại trạng thái, chứ không phải trận thật sự
// đang kéo dài. Để dư dả (hiệp phụ, luân lưu, delay bình luận viên...).
const MAX_LIVE_DURATION_HOURS = {
  football: 3.5,
  basketball: 3,
  volleyball: 3,
  badminton: 2.5,
  tennis: 6, // Grand Slam 5 set có thể kéo rất dài
  esports: 5
};
const DEFAULT_MAX_LIVE_DURATION_HOURS = 4;

/**
 * True khi trận đang đánh dấu "live" nhưng đã trôi qua quá lâu so với giờ
 * bóng lăn ban đầu để còn thực sự đang diễn ra — dữ liệu cũ nhiều khả năng
 * do nguồn quên cập nhật trạng thái sang "kết thúc". Dùng để tự lọc bỏ thay
 * vì hiện nhầm 1 trận đã xong từ lâu là "đang live".
 */
export function isStaleLiveMatch(match) {
  const status = match?.status || {};
  if (!status.isLive) return false;
  const ms = toMatchTimeMs(match?.matchTimeTimestamp);
  if (!ms) return false; // không có giờ bóng lăn thì không đủ căn cứ để coi là cũ
  const sportKey = normalizeSport(match?.sport);
  const maxHours = MAX_LIVE_DURATION_HOURS[sportKey] ?? DEFAULT_MAX_LIVE_DURATION_HOURS;
  return Date.now() - ms > maxHours * 60 * 60 * 1000;
}

/** Giờ bóng lăn thực (HH:mm dd/MM) tính từ matchTimeTimestamp, dùng chung
 *  cho cả trận sắp diễn ra lẫn trận live không đọc được phút thi đấu. */
function formatKickoffTime(match) {
  const ts = match?.matchTimeTimestamp || match?.matchTime;
  if (!ts) return '';
  const ms = toMatchTimeMs(ts);
  const date = new Date(ms);
  const timeStr = date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh'
  });
  const dateStr = date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh'
  });
  return `${timeStr} ${dateStr}`;
}

export function formatMatchTime(match) {
  const status = match?.status || {};
  const kickoff = formatKickoffTime(match);

  // Trận đang live: ưu tiên hiện phút thi đấu thật (34', HT...) khi nguồn
  // đọc được. Nhiều nguồn (Gà Vàng, Xôi Lạc) không lấy được phút thi đấu và
  // chỉ trả về nhãn tĩnh "Live"/"LIVE" — trường hợp đó KHÔNG được coi là
  // "đã có giờ", phải rơi xuống hiện giờ bóng lăn thật để badge giờ không
  // bao giờ trống hoặc vô nghĩa với trận đang live.
  if (status.isLive) {
    if (kickoff) return kickoff;
    if (match?.timeFormatted) return match.timeFormatted;
    const raw = String(status.elapsedTime || '').trim();
    const looksLikeClock = raw && /^(\d{1,3}(\+\d{1,2})?['’]?|HT|FT)$/i.test(raw);
    if (looksLikeClock) return raw;
    return status.text || status.name || 'LIVE';
  }

  // Trận đã kết thúc: hiện rõ "Kết thúc" thay vì giờ bóng lăn lúc trước.
  if (status.isFinished) {
    return status.text || 'Kết thúc';
  }

  if (kickoff) return kickoff;
  if (match?.timeFormatted) return match.timeFormatted;
  return '';
}

export function getMatchTitle(match) {
  if (match?.title) return match.title;
  const home = match?.homeTeam?.name || 'Home';
  const away = match?.awayTeam?.name || 'Away';
  if (!match?.awayTeam?.name) return home;
  return `${home} vs ${away}`;
}

export function tagMatchSource(match, source) {
  return {
    ...match,
    source,
    sportCategory: normalizeSport(match.sport)
  };
}

/** Short "Sắp diễn ra" style label for a match that hasn't kicked off yet. */
export function formatUpcomingBadge(match) {
  const ms = toMatchTimeMs(match?.matchTimeTimestamp);
  if (!ms) return 'Sắp diễn ra';
  const diffMin = Math.round((ms - Date.now()) / 60000);
  if (diffMin <= 0) return 'Sắp diễn ra';
  if (diffMin < 60) return `Bắt đầu sau ${diffMin} phút`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return mins ? `Bắt đầu sau ${hours}h${mins}p` : `Bắt đầu sau ${hours}h`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON with exponential backoff.
 * Retries on network errors, 408/429/5xx, and success:false timeout-like messages.
 */
export async function fetchWithRetry(url, options = {}, maxAttempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      const retryableStatus =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      if (!response.ok) {
        if (retryableStatus && attempt < maxAttempts) {
          await sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
        return { success: false, data: [], message: `HTTP ${response.status}` };
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        if (attempt < maxAttempts) {
          await sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
        return { success: false, data: [], message: 'Invalid content-type' };
      }

      const json = await response.json();
      if (json && json.success === false && attempt < maxAttempts) {
        const msg = json.message || 'API failed';
        if (/timeout|failed to fetch|ECONN|network|503|502|500|429/i.test(msg)) {
          await sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
      }
      return json;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(500 * Math.pow(2, attempt - 1));
        continue;
      }
    }
  }

  return {
    success: false,
    data: [],
    message: lastError?.message || 'Fetch failed'
  };
}

/** Run async tasks with a concurrency limit. */
export async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export function filterBySportTab(matches, tabId) {
  if (!tabId || tabId === 'all') return matches;
  return matches.filter((m) => m.sportCategory === tabId);
}

export function countBySportTab(matches) {
  const counts = { all: matches.length };
  SPORT_TABS.forEach((tab) => {
    if (tab.id === 'all') return;
    counts[tab.id] = matches.filter((m) => m.sportCategory === tab.id).length;
  });
  return counts;
}
