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
  'giao huu phong trao',  // grassroots friendly (không phải pro-level)
  'giao huu vo dich',     // grassroots/regional friendly
  'phong trao',           // grassroots
  'nghiep du',            // amateur
  'giai co',              // "giải cỏ" (sân cỏ nhân tạo, phủi)
  'san co',
  'phu i',
  'phui',
  'futsal phong trao',
  'hang nhi',             // hạng nhì / league two (nhiều nước)
  'hang ba',              // hạng ba / league three
  'hang tu',              // league four
  'hang nam',             // league five+
  'reserve',              // đội trẻ/dự bị
  'du bi',
  'cup lang',
  'cup xa',
  'giai xa',
  'giai phuong',
  'giai quan',
  'giai huyen',
  'thieu nien',           // giải thiếu niên nhi đồng
  'nhi dong',
  'giai tinh',            // giải tỉnh/thành phố phong trào
  'giai truong',          // giải trường học
  'giai noi bo',          // giải nội bộ công ty/cơ quan
  'cup doanh nghiep',
  'cup cong ty',
  'the thao hoc duong',
  'sinh vien',            // giải sinh viên
  'cong nhan',            // giải công nhân viên chức
  've lang',              // "về làng" — giao lưu phong trào
  'giai tre',             // giải trẻ (U-series các nước) — vd "Giải Trẻ Ukrainian"
  'hang 2',               // "Hạng 2 <nước>" — dạng số, khác với "hạng nhì" chữ ở trên
  'hang 3',
  'hang 4',
  'hang 5',
  'hang 6',
  'hang 7',
  'esiliiga',             // giải hạng dưới Estonia — vd "Hạng 3 Esiliiga"
  // Hạng 2/3/4+ của các giải nhà nghề lớn — chặn tường minh để KHÔNG bị
  // whitelist bên dưới "vồ nhầm" qua so khớp chuỗi con (vd tên giải hạng 2
  // Đức vẫn chứa chữ "bundesliga").
  'hang nhat',            // Giải hạng Nhất QG Việt Nam (dưới V-League)
  '2. bundesliga',
  'zweite bundesliga',
  '3. bundesliga',
  '4. bundesliga',        // Regionalliga Hạng 4 Đức
  '5. bundesliga',        // Oberliga Hạng 5 Đức
  '3. liga',
  '4. liga',
  'regionalliga',
  'oberliga',             // Hạng 4 Đức
  'segunda division',
  'segunda liga',
  'primera rfef',
  '4. division',          // Hạng 4 các giải khác
  'liga 2 belanda',       // Hạng 2 Hà Lan
  'primeira liga 2',      // Hạng 2 Bồ Đào Nha
  'liga portugal 2',      // Hạng 2 Bồ Đào Nha
  'liga 2',               // Hạng 2 Bồ Đào Nha, Portugal
  'laliga 2',
  'la liga 2',
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
  'championship',         // hạng 2 Anh (EFL Championship)
  'eerste divisie',       // hạng 2 Hà Lan (khác Eredivisie)
  'challenger pro league',
  'tff 1. lig',
  'tff 2. lig',
  'tff 3. lig',
  'j2 league',
  'j3 league',
  'jfl',                  // Japan Football League (hạng 3 Nhật)
  'k league 2',
  'thai league 2',
  'liga expansion',       // hạng 2 Mexico
  'primera b',
  'primera nacional',
  'segunda profesional',
  'super group 1',        // Grouping trong các giải hạng dưới
  'super group 2'
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
  'aff cup', 'aff championship', 'asean championship', 'aff',
  'uefa euro', 'vck euro',
  // Giao hữu CLB chuyên nghiệp (pro-level friendlies)
  'club friendlies', 'friendly',
  'international friendlies',
  // Các giải khác đáng xem
  'super cup', 'coppa italia', 'fa cup', 'dfb pokal', 'coupe de france',
  'carabao cup', 'efl cup', 'league cup',
  'intercontinental cup', 'toyota cup',
  'club world cup', 'fifa club world cup',
  'playoff',
  'qualification', 'vong loai',
  'semi-final', 'final', 'semifinal'
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
 * Trận đội tuyển quốc gia (không phải CLB) — nhận diện qua tên đội trùng
 * tên 1 quốc gia. Dùng để KHÔNG áp bộ lọc whitelist giải chuyên nghiệp
 * (PRO_LEAGUE_KEYWORDS) cho Xôi Lạc/Gà Vàng với các trận này: nhiều trận
 * đội tuyển (giao hữu quốc tế, vòng loại, cúp khu vực như AFF/SEA Games...)
 * bị nguồn Xôi Lạc ghi tên giải không khớp whitelist (hoặc để trống/khác
 * tên) nên bị lọc mất oan, dù nguồn khác (Pháo Hoa, Giờ Vàng — không lọc
 * theo whitelist) vẫn hiện bình thường. Ví dụ: "Thái Lan vs Singapore".
 */
const NATIONAL_TEAM_NAMES = [
  'viet nam', 'thai lan', 'thailand', 'singapore', 'malaysia', 'indonesia',
  'philippines', 'myanmar', 'campuchia', 'cambodia', 'lao', 'laos', 'brunei',
  'timor leste', 'trung quoc', 'china', 'nhat ban', 'japan', 'han quoc',
  'korea republic', 'south korea', 'north korea', 'trieu tien', 'an do', 'india',
  'uc', 'australia', 'iraq', 'iran', 'saudi arabia', 'qatar', 'uae',
  'united arab emirates', 'jordan', 'oman', 'bahrain', 'kuwait', 'syria',
  'lebanon', 'palestine', 'yemen', 'afghanistan', 'uzbekistan', 'turkmenistan',
  'tajikistan', 'kyrgyzstan', 'mongolia', 'nepal', 'bangladesh', 'sri lanka',
  'maldives', 'bhutan', 'pakistan', 'hong kong', 'macau', 'macao', 'chinese taipei',
  'anh', 'england', 'phap', 'france', 'duc', 'germany', 'tay ban nha', 'spain',
  'y', 'italy', 'bo dao nha', 'portugal', 'ha lan', 'netherlands', 'bi', 'belgium',
  'thuy si', 'switzerland', 'ao', 'austria', 'ba lan', 'poland', 'nga', 'russia',
  'ukraina', 'ukraine', 'thuy dien', 'sweden', 'na uy', 'norway', 'dan mach',
  'denmark', 'croatia', 'serbia', 'hy lap', 'greece', 'tho nhi ky', 'turkiye',
  'turkey', 'scotland', 'wales', 'ireland', 'iceland', 'phan lan', 'finland',
  'brazil', 'argentina', 'uruguay', 'chile', 'colombia', 'peru', 'ecuador',
  'paraguay', 'bolivia', 'venezuela', 'mexico', 'hoa ky', 'usa', 'united states',
  'canada', 'costa rica', 'panama', 'jamaica', 'ai cap', 'egypt', 'morocco',
  'ma rop', 'algeria', 'tunisia', 'nigeria', 'ghana', 'senegal', 'cameroon',
  'nam phi', 'south africa', 'new zealand'
];

function isCountryTeamName(name) {
  const n = stripDiacritics(name || '').trim();
  if (!n) return false;
  return NATIONAL_TEAM_NAMES.some((c) => n === c || n.includes(c));
}

export function isNationalTeamMatch(match) {
  return isCountryTeamName(match?.homeTeam?.name) && isCountryTeamName(match?.awayTeam?.name);
}

/**
 * True khi trận nên bị loại khỏi danh sách.
 * - Mọi nguồn: loại trận rơi vào danh sách "cỏ"/phong trào/hạng dưới đã
 *   nhận diện rõ tên (MINOR_LEAGUE_KEYWORDS), hoặc không có tên giải.
 * - Riêng Gà Vàng & Xôi Lạc (2 nguồn hay lẫn trận nhỏ nhất): CHỈ giữ lại
 *   trận thuộc giải đã được nhận diện là chuyên nghiệp (PRO_LEAGUE_KEYWORDS)
 *   — bất cứ giải nào không khớp whitelist (hạng 2/3/4, giải lạ, không rõ
 *   nguồn...) đều bị loại theo đúng yêu cầu "chỉ để lại giải chuyên nghiệp".
 *   NGOẠI LỆ: trận giữa 2 đội TUYỂN QUỐC GIA (isNationalTeamMatch) luôn
 *   được giữ lại (miễn không dính MINOR_LEAGUE_KEYWORDS ở trên) — các nguồn
 *   hay ghi sai/thiếu tên giải cho trận đội tuyển khiến chúng bị lọc oan.
 */
export function isJunkMatch(match) {
  // Trận đội tuyển quốc gia (tên đội trùng tên nước) luôn được giữ lại,
  // bỏ qua toàn bộ lọc minor-league/whitelist bên dưới — các nguồn hay ghi
  // sai/thiếu/lệch tên giải cho dạng trận này (giao hữu quốc tế, vòng loại,
  // cúp khu vực...) khiến chúng bị lọc oan dù là trận đáng xem.
  if (isNationalTeamMatch(match)) return false;

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

/**
 * FIX "resource unavailable": nhiều CDN của Gà Vàng/Xôi Lạc (Tencent,
 * Alibaba/Aliyun, VNBong, streambylivepulse...) kiểm tra header Referer —
 * thiếu đúng Referer, CDN từ chối request dù link còn hiệu lực và trận vẫn
 * đang đá. File .m3u trước đây chỉ ghi mỗi dòng URL trần, không kèm
 * Referer, nên VLC/TiviMate/Perfect Player mở thẳng link bị CDN chặn.
 * Giovang/Pháo Hoa không đòi hỏi header này nên trước giờ không bị lộ ra.
 * Hàm này trả về Referer đúng theo từng nguồn để ghi kèm dòng
 * #EXTVLCOPT:http-referrer trong m3uPlaylist.js.
 */
export function getSourceReferer(match) {
  const key = getSourceKey(match);
  if (key === 'gavang') {
    return (process.env.GAVANG_DOMAIN || process.env.GAVANG_BASE_URL || 'https://gavangtv.nl') + '/';
  }
  if (key === 'xoilac') {
    return (process.env.XOILAC_DOMAIN || process.env.XOILAC_BASE_URL || 'https://xoilacxtx.tv') + '/';
  }
  return '';
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

/** Giờ bóng lăn thực (dd/MM HH:mm) tính từ matchTimeTimestamp, dùng chung
 *  cho cả trận sắp diễn ra lẫn trận live không đọc được phút thi đấu.
 *
 *  QUAN TRỌNG: NGÀY phải đứng TRƯỚC giờ trong chuỗi trả về (không phải
 *  "HH:mm dd/MM" như trước) — vì chuỗi này được dùng làm phần đầu tên
 *  kênh trong file .m3u (xem m3uPlaylist.js). Rất nhiều app IPTV tự sắp
 *  xếp danh sách kênh theo TÊN (so sánh chuỗi ký tự) thay vì theo đúng
 *  thứ tự dòng trong file — nếu giờ đứng trước ngày, 1 trận "00:00
 *  15/08" sẽ bị app xếp LÊN TRƯỚC trận "18:00 14/08" chỉ vì so sánh
 *  chuỗi thấy "0" < "1" ở đầu, dù file gốc đã sort đúng theo thời gian
 *  thực. Đặt ngày trước để so sánh chuỗi cũng ra đúng thứ tự ngày trước,
 *  giờ sau — khớp với sort thời gian thực bất kể app có tự sort theo
 *  tên hay không.
 *
 *  QUAN TRỌNG: hàm này LUÔN trả về ngày-giờ đá (không bao giờ trả về
 *  "LIVE"/phút thi đấu) — dùng làm phần ĐẦU tên kênh trong .m3u để giữ
 *  đúng thứ tự sort-theo-tên ở mọi trạng thái trận (live/sắp đá đều
 *  giống nhau). Nhãn LIVE/phút thi đấu hiển thị THÊM vào sau, xem
 *  getLiveBadge() — không được gộp chung vào 1 hàm rồi thay thế phần
 *  ngày-giờ như formatMatchTime() làm cho web, vì làm vậy sẽ khiến tên
 *  trận live bắt đầu bằng "18'" thay vì ngày-giờ, phá sort-theo-tên y hệt
 *  lỗi ngày/giờ đã fix trước đó — nhưng lần này xảy ra riêng với các
 *  trận live. */
export function formatKickoffTime(match) {
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
  return `${dateStr} ${timeStr}`;
}

/** Nhãn LIVE ngắn gọn ("18'", "HT", "LIVE"...) dùng để GẮN THÊM cạnh
 *  ngày-giờ trong tên kênh .m3u (xem getPlaylistLabel() trong
 *  m3uPlaylist.js) — không thay thế ngày-giờ như formatMatchTime(). Trả
 *  về '' khi trận không phải đang live. */
export function getLiveBadge(match) {
  const status = match?.status || {};
  if (!status.isLive) return '';
  // Chỉ hiện nhãn LIVE tĩnh — KHÔNG hiện số phút thi đấu (ví dụ "34'")
  // trong tên trận, dù ở web hay trong file .m3u. Vẫn giữ các nhãn không
  // phải số phút như "HT" (nghỉ giữa hiệp) nếu nguồn có trả về.
  const looksLikeMinuteClock = (v) => /^\d{1,3}(\+\d{1,2})?['’]?$/i.test(String(v || '').trim());

  const raw = String(status.elapsedTime || '').trim();
  if (raw && !looksLikeMinuteClock(raw)) return raw;

  const fallback = String(status.text || status.name || '').trim();
  if (fallback && !looksLikeMinuteClock(fallback)) return fallback;

  return 'LIVE';
}

export function formatMatchTime(match) {
  const status = match?.status || {};
  const kickoff = formatKickoffTime(match);

  // Trận đang live: hiện GIỜ BÓNG LĂN (kickoff) trước — vì UI đã có sẵn 1
  // badge đỏ "LIVE" riêng ngay cạnh (xem MatchCard/MatchListRow), nên nếu
  // hàm này cũng trả về "LIVE" thì người xem thấy 2 chữ LIVE cạnh nhau mà
  // KHÔNG thấy giờ bắt đầu trận đâu cả — đúng lỗi đã gặp. Ưu tiên:
  //   1) Giờ bóng lăn (kickoff) — luôn có ý nghĩa, không đổi giữa các lần
  //      làm mới cache nên không sợ hiện sai.
  //   2) Nếu có thêm nhãn không phải số phút (vd "HT" nghỉ giữa hiệp) thì
  //      nối thêm sau giờ bóng lăn, dạng "21:00 · HT".
  //   3) Chỉ khi HOÀN TOÀN không có kickoff (nguồn không trả giờ) mới rơi
  //      xuống nhãn live tĩnh ("LIVE") để badge không bao giờ trống.
  if (status.isLive) {
    const badge = getLiveBadge(match);
    const meaningfulBadge = badge && badge !== 'LIVE' ? badge : '';
    if (kickoff) return meaningfulBadge ? `${kickoff} · ${meaningfulBadge}` : kickoff;
    if (badge) return badge;
    if (match?.timeFormatted) return match.timeFormatted;
    return 'LIVE';
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
