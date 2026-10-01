// Danh sách nguồn + cách đọc biến SOURCE_DOMAINS (dùng chung cho:
//   scripts/expand-source-domains.mjs  — mở SOURCE_DOMAINS thành biến môi trường khi chạy workflow
//   scripts/check-domains.mjs          — quét domain, tự ghi domain mới vào SOURCE_DOMAINS)
//
// SOURCE_DOMAINS = MỘT biến GitHub (Settings > Secrets and variables > Actions > Variables)
// chứa domain của TẤT CẢ nguồn. Hai cách viết (chọn 1):
//   (a) mỗi dòng "tên=domain" (dễ sửa tay nhất; dòng bắt đầu bằng # là ghi chú):
//         giovang=https://giovang.blog
//         saoke=https://vip3.saoketv40.xyz
//         saoke-api=https://skapi.66887979.xyz
//   (b) JSON:  {"giovang":"https://giovang.blog","saoke":"https://vip3.saoketv40.xyz"}
// "tên" là key ngắn (giovang, saoke-api, ...) HOẶC đúng tên biến cũ (GIOVANG_DOMAIN, ...).
// Nguồn nào KHÔNG khai báo thì dùng biến riêng lẻ cũ (nếu có), rồi mới đến domain mặc định trong code.

// ---------------------------------------------------------------------------
// Cấu hình nguồn. role:
//   site   = trang web của nguồn (quét + TỰ TÌM domain mới nếu autoFix)
//   player = domain player/Referer   (chỉ quét + báo cáo)
//   api    = domain API              (chỉ quét + báo cáo; còn sống = có phản hồi HTTP bất kỳ)
// envVar phải TRÙNG tên biến code đang đọc (xem services/*.js, m3uPlaylist.js).
// ---------------------------------------------------------------------------
export const SOURCES = [
  { key: 'giovang', label: 'Giờ Vàng', role: 'site', envVar: 'GIOVANG_DOMAIN', defaultUrl: 'https://giovang.blog', keywords: ['giovang', 'giờ vàng', 'gio vang'], candidates: ['https://giovang.cv', 'https://giovang.blog', 'https://giovang.city'], autoFix: true },
  { key: 'khandaitv', label: 'Khán Đài', role: 'site', envVar: 'KHANDAITV_BASE_URL', defaultUrl: 'https://khandai3.link', keywords: ['khandai', 'khán đài', 'khan dai'], autoFix: true },
  { key: 'phaohoa', label: 'Pháo Hoa', role: 'site', envVar: 'PHAOHOA_BASE_URL', defaultUrl: 'https://phaohoa1.live', keywords: ['phaohoa', 'pháo hoa', 'phao hoa'], autoFix: true },
  { key: 'gavang', label: 'Gà Vàng', role: 'site', envVar: 'GAVANG_BASE_URL', defaultUrl: 'https://gavanglinkp.tv', keywords: ['gavang', 'gà vàng', 'ga vang'], autoFix: true },
  { key: 'gavang33', label: 'Gà Vàng 33', role: 'site', envVar: 'GAVANG33_DOMAIN', defaultUrl: 'https://gavang33.me', keywords: ['gavang', 'gà vàng', 'ga vang'], autoFix: true },
  { key: 'saoke', label: 'Sao Kê', role: 'site', envVar: 'SAOKE_BASE_URL', defaultUrl: 'https://vip3.saoketv40.xyz', keywords: ['saoke', 'sao kê', 'sao ke'], autoFix: true },
  { key: 'bonglau', label: 'Bông Lau', role: 'site', envVar: 'BONGLAU_DOMAIN', defaultUrl: 'https://lau05.bonglautv1.pro', keywords: ['bonglau', 'bong lau', 'bóng lậu', 'bóng lầu', 'bòng lau'], autoFix: true },
  { key: 'phalang', label: 'Phá Làng', role: 'site', envVar: 'PHALANG_DOMAIN', defaultUrl: 'https://phalang.live', keywords: ['phalang', 'phá làng', 'pha lang'], autoFix: true },
  // Chuối Chiên: code TỰ DÒ liveNN.chuoichientv.me; biến *_WATCH_DOMAIN sẽ ÉP cố định 1 domain
  // nên script KHÔNG tự ghi biến này (chỉ báo cáo).
  { key: 'chuoichientv', label: 'Chuối Chiên (trang xem)', role: 'site', envVar: 'CHUOICHIENTV_WATCH_DOMAIN', defaultUrl: 'https://live05.chuoichientv.me', keywords: ['chuoichien', 'chuối chiên', 'chuoi chien'], autoFix: false },
  { key: 'chuoichientv-player', label: 'Chuối Chiên (player/Referer)', role: 'player', envVar: 'CHUOICHIENTV_PLAYER_DOMAIN', defaultUrl: 'https://live.chuoichien.tv', autoFix: false },
  { key: 'saoke-player', label: 'Sao Kê (player/Referer)', role: 'player', envVar: 'SAOKE_PLAYER_DOMAIN', defaultUrl: 'https://sk.mediastation.live', autoFix: false },
  { key: 'bonglau-player', label: 'Bông Lau (player/Referer)', role: 'player', envVar: 'BONGLAU_PLAYER_DOMAIN', defaultUrl: 'https://live.chuoichien.tv', autoFix: false },
  { key: 'giovang-api', label: 'Giờ Vàng (API)', role: 'api', envVar: 'GIOVANG_LIVE_API_HOST', defaultUrl: 'https://live-api.keonhacaitp.one', autoFix: false },
  { key: 'saoke-api', label: 'Sao Kê (API)', role: 'api', envVar: 'SAOKE_API_DOMAIN', defaultUrl: 'https://skapi.66887979.xyz', autoFix: false },
  { key: 'gavang33-api', label: 'Gà Vàng 33 (API)', role: 'api', envVar: 'GAVANG33_API_DOMAIN', defaultUrl: 'https://gavangtv-api.adviceme.io', autoFix: false },
  { key: 'phalang-api', label: 'Phá Làng (API)', role: 'api', envVar: 'PHALANG_API_BASE', defaultUrl: 'https://api.plapi202624081158.com', autoFix: false },
  { key: 'chuoichientv-api', label: 'Chuối Chiên (API)', role: 'api', envVar: 'CHUOICHIENTV_API_BASE', defaultUrl: 'https://api-v2.chuoichientv.net/v2', autoFix: false },
  { key: 'bonglau-api', label: 'Bông Lau (API)', role: 'api', envVar: 'BONGLAU_API_BASE', defaultUrl: 'https://api-v2.chuoichientv.net/v2', autoFix: false }
];


const norm = (s) => String(s || '').trim().toLowerCase();
const stripSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

// tên (key ngắn / tên biến, không phân biệt hoa thường, "_" ~ "-") -> nguồn
const LOOKUP = new Map();
for (const e of SOURCES) {
  for (const name of [e.key, e.envVar]) {
    LOOKUP.set(norm(name), e);
    LOOKUP.set(norm(name).replace(/_/g, '-'), e);
  }
}
export function findEntry(name) {
  const n = norm(name);
  return LOOKUP.get(n) || LOOKUP.get(n.replace(/_/g, '-')) || null;
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export function suggestKey(name) {
  const n = norm(name).replace(/_/g, '-');
  let best = null;
  for (const e of SOURCES) {
    const d = editDistance(n, e.key);
    if (d <= 3 && (!best || d < best.d)) best = { key: e.key, d };
  }
  return best ? best.key : null;
}

/** Chuẩn hoá giá trị domain: thêm https:// nếu thiếu, bỏ "/" cuối. Trả '' nếu không hợp lệ. Giữ nguyên path (vd .../v2). */
export function normalizeDomainValue(raw) {
  let v = String(raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return '';
    return stripSlash(`${u.origin}${u.pathname === '/' ? '' : u.pathname}`);
  } catch { return ''; }
}

/**
 * Đọc nội dung biến SOURCE_DOMAINS.
 * @returns {{ map: Record<string,string>, keyNames: Record<string,string>, warnings: string[], format: 'empty'|'json'|'lines' }}
 *   map: TÊN BIẾN (GIOVANG_DOMAIN...) -> domain đã chuẩn hoá; keyNames: tên BIẾN -> tên người dùng đã viết
 */
export function parseSourceDomains(text) {
  const out = { map: {}, keyNames: {}, warnings: [], format: 'empty' };
  const raw = String(text ?? '').trim();
  if (!raw) return out;

  const pairs = [];
  if (raw.startsWith('{')) {
    out.format = 'json';
    let obj;
    try { obj = JSON.parse(raw); } catch (err) {
      out.warnings.push(`SOURCE_DOMAINS không phải JSON hợp lệ (${err.message}) — bỏ qua toàn bộ biến này`);
      return out;
    }
    for (const [k, v] of Object.entries(obj || {})) pairs.push([k, typeof v === 'string' ? v : '']);
  } else {
    out.format = 'lines';
    // Tách theo DÒNG trước, bỏ ghi chú (dòng bắt đầu bằng # và đuôi " # ..."), rồi mới cho phép
    // viết nhiều cặp trên 1 dòng bằng dấu , hoặc ; — để ghi chú có dấu phẩy không làm vỡ dòng.
    for (const lineRaw of raw.split(/\r?\n/)) {
      const line = lineRaw.trim();
      if (!line || line.startsWith('#')) continue;
      for (const part of line.replace(/\s+#.*$/, '').split(/[;,]+/)) {
        const item = part.trim();
        if (!item) continue;
        const idx = item.indexOf('=');
        if (idx < 0) { out.warnings.push(`bỏ qua dòng không có dấu "=": ${item.slice(0, 60)}`); continue; }
        pairs.push([item.slice(0, idx).trim(), item.slice(idx + 1).trim()]);
      }
    }
  }

  for (const [name, rawValue] of pairs) {
    const entry = findEntry(name);
    if (!entry) {
      const hint = suggestKey(name);
      out.warnings.push(`tên không nhận ra: "${name}"${hint ? ` — ý bạn là "${hint}"?` : ''}`);
      continue;
    }
    if (!String(rawValue).trim()) continue; // để trống = coi như chưa khai báo
    const value = normalizeDomainValue(rawValue);
    if (!value) { out.warnings.push(`giá trị không hợp lệ cho "${name}": ${String(rawValue).slice(0, 60)} — bỏ qua`); continue; }
    out.map[entry.envVar] = value; // trùng tên thì dòng sau thắng
    out.keyNames[entry.envVar] = name;
  }
  return out;
}

/**
 * Cập nhật/chèn 1 domain vào nội dung SOURCE_DOMAINS mà GIỮ NGUYÊN định dạng (JSON hoặc dòng),
 * ghi chú và các dòng khác. Trả null nếu không gộp an toàn được (JSON hỏng).
 */
export function updateSourceDomainsText(text, entry, value) {
  const raw = String(text ?? '');
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    let obj;
    try { obj = JSON.parse(trimmed); } catch { return null; }
    const existing = Object.keys(obj).find((k) => findEntry(k) === entry);
    obj[existing || entry.key] = value;
    return JSON.stringify(obj, null, 2);
  }
  const lines = raw.split(/\r?\n/);
  let done = false;
  const next = lines.map((line) => {
    const t = line.trim();
    if (done || !t || t.startsWith('#')) return line;
    const idx = t.indexOf('=');
    if (idx < 0) return line;
    const key = t.slice(0, idx).trim();
    if (findEntry(key) !== entry) return line;
    done = true;
    return `${key}=${value}`;
  });
  while (next.length && !next[next.length - 1].trim()) next.pop(); // bỏ dòng trống thừa ở cuối
  if (!done) next.push(`${entry.key}=${value}`);
  return next.join('\n') + '\n';
}

/** Mẫu SOURCE_DOMAINS đầy đủ (domain mặc định hiện tại) để copy/dán lần đầu. */
export function templateText() {
  const lines = [
    '# Mỗi dòng: tên=domain. Dòng bắt đầu bằng # là ghi chú. Xoá/để trống 1 dòng = dùng domain mặc định trong code.',
    '# Quét tự động: workflow "Check Domains" sẽ tự sửa dòng nào có domain chết.'
  ];
  for (const e of SOURCES) {
    const prefix = e.key === 'chuoichientv' ? '# ' : '';
    const note = e.key === 'chuoichientv' ? '   # tuỳ chọn: bỏ # sẽ ÉP cố định domain này (mặc định code tự dò liveNN.chuoichientv.me)' : '';
    lines.push(`${prefix}${e.key}=${e.defaultUrl}${note}`);
  }
  return lines.join('\n') + '\n';
}

export { stripSlash };
