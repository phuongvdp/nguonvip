// Hàm/hằng số dùng chung cho các script kiểm tra domain (check-domains.mjs, resolve-redirects.mjs).

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Trang đỗ tên miền / rao bán / hết hạn -> coi như CHẾT dù trả HTTP 200.
export const PARKED_RE =
  /(domain (is )?for sale|buy this domain|this domain (may be|is) (for sale|parked|available)|domain (name )?(has )?expired|parked (free|domain)|sedo\.com\/search|dan\.com\/buy|afternic|parkingcrew|hugedomains|bodis\.com|tên miền (này )?(đã )?hết hạn|domain registration|renew your domain)/i;
export const CF_CHALLENGE_RE = /(just a moment|attention required|cf-browser-verification|challenge-platform|enable javascript and cookies)/i;

export const stripSlash = (u) => String(u || '').trim().replace(/\/+$/, '');
export const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

export function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname; } catch { return ''; }
}
export function originOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).origin; } catch { return ''; }
}
