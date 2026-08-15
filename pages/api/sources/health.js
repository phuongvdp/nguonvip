import crawlerService from '@/src/services/crawler.service';
import phaohoaService from '@/src/services/phaohoa.service';
import xoilacService from '@/src/services/xoilac.service';
import xoilacAffcupService from '@/src/services/xoilacAffcup.service';
import ninetyService from '@/src/services/ninety.service';
import giovangService from '@/src/services/giovang.service';
import vsc9Service from '@/src/services/vsc9.service';
import { GAVANG_URLS } from '@/src/config/constants';

// Domain hiện tại của từng nguồn (đọc từ biến môi trường Vercel, hoặc mặc
// định trong code nếu chưa set biến) — để biết ngay đang trỏ vào domain
// nào khi so sánh với domain thật nguồn đang dùng.
const CURRENT_DOMAINS = {
  gavang: GAVANG_URLS.BASE_URL,
  phaohoa: process.env.PHAOHOA_DOMAIN || process.env.PHAOHOA_BASE_URL || 'https://phaohoa1.live',
  xoilac: process.env.XOILAC_DOMAIN || process.env.XOILAC_BASE_URL || 'https://xoilacxtx.tv',
  'xoilac-affcup': process.env.AFFCUP_DOMAIN || 'https://xoilacbongda-affcup2026b.live',
  ninety: process.env.NINETY_DOMAIN || 'https://90phutzc.tv',
  giovang: process.env.GIOVANG_DOMAIN || 'https://giovang.city',
  vsc9: process.env.VSC9_DOMAIN || process.env.VSC9_BASE_URL || 'https://vsc9.vip'
};

// Tên biến môi trường Vercel cần sửa khi domain nguồn đó đổi.
const ENV_VAR_HINT = {
  gavang: 'GAVANG_DOMAIN',
  phaohoa: 'PHAOHOA_DOMAIN',
  xoilac: 'XOILAC_DOMAIN',
  'xoilac-affcup': 'AFFCUP_DOMAIN',
  ninety: 'NINETY_DOMAIN',
  giovang: 'GIOVANG_DOMAIN',
  vsc9: 'VSC9_DOMAIN'
};

async function check(key, fn) {
  const startedAt = Date.now();
  try {
    const res = await fn();
    const list = Array.isArray(res) ? res : (res?.matches || res?.data || []);
    const live = list.filter((m) => m?.status?.isLive).length;
    return {
      domain: CURRENT_DOMAINS[key],
      ok: true,
      // "ok: true" chỉ có nghĩa là gọi được, KHÔNG chắc domain còn đúng —
      // 1 domain hết hạn/đổi chủ vẫn có thể trả HTTP 200 nhưng với trang
      // hoàn toàn khác (parking page, quảng cáo...) khiến total/live = 0
      // dù đang có trận thật. Luôn đối chiếu total/live với các nguồn khác
      // đang chạy tốt cùng giờ.
      total: list.length,
      live,
      ms: Date.now() - startedAt,
      envVar: ENV_VAR_HINT[key]
    };
  } catch (err) {
    return {
      domain: CURRENT_DOMAINS[key],
      ok: false,
      error: err.message,
      ms: Date.now() - startedAt,
      envVar: ENV_VAR_HINT[key]
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  res.setHeader('Cache-Control', 'no-store');

  const [gavang, phaohoa, xoilac, affcup, ninety, giovang, vsc9] = await Promise.all([
    check('gavang', () => crawlerService.getLiveMatches('football')),
    check('phaohoa', () => phaohoaService.getAllMatchesByTab('live', 'all', 50)),
    check('xoilac', () => xoilacService.getMatchesByTab('live', 'football')),
    check('xoilac-affcup', () => xoilacAffcupService.getAllMatchesByTab('live', 'football', 50)),
    check('ninety', () => ninetyService.getAllMatchesByTab('live', 'football')),
    check('giovang', () => giovangService.getAllMatchesByTab('live')),
    check('vsc9', () => vsc9Service.getMatchesByTab('live'))
  ]);

  const sources = { gavang, phaohoa, xoilac, 'xoilac-affcup': affcup, ninety, giovang, vsc9 };

  // Gợi ý nhanh: nguồn nào lỗi hẳn (ok:false — mất mạng, DNS chết, timeout)
  // hoặc gọi được nhưng total=0 & live=0 trong khi đang là giờ có nhiều
  // trận (các nguồn khác vẫn ra total>0) — 2 dấu hiệu rõ nhất của "domain
  // đã đổi/đã chết, trang cũ không còn đúng nội dung nữa".
  const suspected = Object.entries(sources)
    .filter(([, v]) => !v.ok || v.total === 0)
    .map(([key, v]) => ({ key, domain: v.domain, envVar: v.envVar, reason: v.ok ? 'total=0 (nghi domain đã đổi/chết)' : `lỗi: ${v.error}` }));

  return res.status(200).json({ success: true, checkedAt: new Date().toISOString(), sources, suspected });
}

// Gọi song song ~7 nguồn, 1 số nguồn cần mở Chromium headless — nới trần
// thời gian chạy lên mức tối đa Vercel Hobby cho phép.
export const config = { maxDuration: 60 };
