#!/usr/bin/env node
// Quét xem domain của từng nguồn còn sống không. Domain nào chết/đã chuyển
// hướng -> tự tìm domain mới, kiểm tra kỹ, rồi GHI VÀO biến GitHub SOURCE_DOMAINS
// (MỘT biến chứa domain của tất cả nguồn — xem scripts/source-domains.mjs) để
// workflow "Generate Playlists" dùng ngay lần chạy sau.
//
// Chạy tay:  tab Actions -> "Check Domains" -> Run workflow
// Không cần cài thư viện (Node >= 18, dùng fetch/dns có sẵn).
//
// Biến môi trường:
//   AUTO_FIX            1/true (mặc định) = ghi biến khi tìm được domain mới; 0/false = chỉ quét
//   SOURCES             "all" (mặc định) hoặc danh sách key cách nhau dấu phẩy, vd "giovang,saoke"
//   EXTRA_CANDIDATES    domain bạn BIẾT là mới (cách nhau dấu phẩy) — thử đầu tiên cho mọi nguồn chết
//   <BIẾN>_CANDIDATES   ứng viên riêng cho 1 nguồn, vd GIOVANG_DOMAIN_CANDIDATES=giovang.cv,giovang.tv
//   GH_VARIABLES_TOKEN  PAT có quyền ghi Variables của repo (GITHUB_TOKEN mặc định KHÔNG ghi được biến)
//   GITHUB_REPOSITORY   owner/repo (GitHub Actions tự có)

import fs from 'node:fs';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { SOURCES, parseSourceDomains, updateSourceDomainsText } from './source-domains.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export { SOURCES };

const TLDS = ['com', 'net', 'org', 'tv', 'live', 'link', 'cc', 'cv', 'me', 'vip', 'xyz', 'site', 'pro', 'online', 'club', 'info', 'app', 'digital', 'blog', 'city', 'one', 'top', 'co', 'io', 'fun', 'win', 'bet'];
const COMBO_TLDS = ['com', 'net', 'tv', 'live', 'link', 'cc', 'me', 'vip', 'xyz', 'pro'];
const MAX_VARIANTS = 140;

// Trang đỗ tên miền / rao bán / hết hạn -> coi như CHẾT dù trả HTTP 200.
const PARKED_RE =
  /(domain (is )?for sale|buy this domain|this domain (may be|is) (for sale|parked|available)|domain (name )?(has )?expired|parked (free|domain)|sedo\.com\/search|dan\.com\/buy|afternic|parkingcrew|hugedomains|bodis\.com|tên miền (này )?(đã )?hết hạn|domain registration|renew your domain)/i;
const CF_CHALLENGE_RE = /(just a moment|attention required|cf-browser-verification|challenge-platform|enable javascript and cookies)/i;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripSlash = (u) => String(u || '').trim().replace(/\/+$/, '');
const SOURCE_DOMAINS_VAR = 'SOURCE_DOMAINS';
const normHost = (h) => String(h || '').toLowerCase().replace(/^www\./, '');

export function hostOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname; } catch { return ''; }
}
export function originOf(url) {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).origin; } catch { return ''; }
}

// --------------------------- tạo ứng viên domain ---------------------------
export function generateVariants(host) {
  const parts = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return [];
  const tld = parts[parts.length - 1];
  const labels = parts.slice(0, -1);
  const out = [];
  const add = (ls, t) => out.push(`${ls.join('.')}.${t}`);

  // Các nguồn hay xoay SỐ trong tên (khandai3 -> khandai4, lau05 -> lau06, saoketv40 -> saoketv41).
  const digitVariants = (label) => {
    const m = label.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return [];
    const [, pre, num, post] = m;
    const keepWidth = num.length > 1 && num[0] === '0';
    const n = parseInt(num, 10);
    const vals = [];
    for (const d of [1, -1, 2, -2, 3, -3, 4, 5, 10, -10]) {
      const v = n + d;
      if (v < 0) continue;
      vals.push(`${pre}${keepWidth ? String(v).padStart(num.length, '0') : String(v)}${post}`);
    }
    return vals;
  };

  const digitSets = [];
  labels.forEach((label, i) => {
    for (const v of digitVariants(label)) {
      const ls = [...labels]; ls[i] = v;
      digitSets.push(ls);
    }
  });
  if (!digitSets.length) {
    // không có số nào trong tên: thử gắn số vào nhãn domain chính
    const i = labels.length - 1;
    for (let n = 1; n <= 5; n++) { const ls = [...labels]; ls[i] = `${labels[i]}${n}`; digitSets.push(ls); }
  }
  for (const ls of digitSets) add(ls, tld);                                   // 1) đổi số, giữ đuôi
  for (const t of TLDS) if (t !== tld) add(labels, t);                        // 2) đổi đuôi, giữ tên
  for (const ls of digitSets.slice(0, 4)) for (const t of COMBO_TLDS) if (t !== tld) add(ls, t); // 3) cả hai

  const own = parts.join('.');
  return [...new Set(out)].filter((h) => h !== own).slice(0, MAX_VARIANTS);
}

// ------------------------------- thăm dò HTTP -------------------------------
export function createProber({ fetchImpl = globalThis.fetch, lookupImpl = (h) => dns.lookup(h), sleep = defaultSleep, timeoutMs = 12000, retryDelayMs = 4000 } = {}) {
  async function httpProbe(url) {
    try {
      const res = await fetchImpl(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'vi,en;q=0.8' }
      });
      let body = '';
      try { body = String(await res.text()).slice(0, 300000); } catch { /* bỏ qua */ }
      const h = (n) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(n) || '' : '');
      return { ok: true, status: res.status, finalUrl: res.url || url, body, server: h('server'), cfRay: h('cf-ray'), cfMitigated: h('cf-mitigated') };
    } catch (err) {
      const code = err?.cause?.code || err?.code || (err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'ETIMEDOUT' : 'UNKNOWN');
      return { ok: false, code: String(code), message: String(err?.message || err) };
    }
  }

  // Lỗi mạng/5xx/timeout có thể chỉ thoáng qua -> thử lại 1 lần trước khi kết luận.
  async function probeWithRetry(url) {
    let r = await httpProbe(url);
    const transient = (x) => !x.ok || (x.status >= 500 && x.status < 600);
    if (transient(r)) {
      await sleep(retryDelayMs);
      r = await httpProbe(url);
    }
    return r;
  }

  function classify(r, entry, currentHost) {
    if (!r.ok) return { state: 'down', reason: r.code };
    const body = r.body || '';
    const lower = body.toLowerCase();
    const cf = (r.cfRay || /cloudflare/i.test(r.server) || r.cfMitigated) && true;
    const challenge = CF_CHALLENGE_RE.test(body) || /challenge/i.test(r.cfMitigated || '');
    if ([401, 403, 429, 503].includes(r.status) && (cf || challenge)) {
      return { state: 'blocked', reason: `HTTP ${r.status} (Cloudflare/WAF chặn IP máy chủ — không kết luận được)` };
    }
    if (r.status >= 200 && r.status < 400) {
      if (PARKED_RE.test(body)) return { state: 'down', reason: 'trang đỗ tên miền / rao bán / hết hạn' };
      if (entry.role !== 'site') return { state: 'alive', reason: `HTTP ${r.status}` };
      const hit = (entry.keywords || []).some((k) => lower.includes(k.toLowerCase()));
      const finalHost = hostOf(r.finalUrl);
      const moved = finalHost && normHost(finalHost) !== normHost(currentHost);
      if (moved) {
        return hit
          ? { state: 'moved', reason: `chuyển hướng sang ${originOf(r.finalUrl)}`, newOrigin: originOf(r.finalUrl) }
          : { state: 'suspect', reason: `chuyển hướng sang ${originOf(r.finalUrl)} nhưng nội dung không giống nguồn` };
      }
      return hit ? { state: 'alive', reason: `HTTP ${r.status}` } : { state: 'suspect', reason: `HTTP ${r.status} nhưng nội dung không thấy tên nguồn (trang bị đổi nội dung?)` };
    }
    if (r.status >= 500) return { state: 'degraded', reason: `HTTP ${r.status} (lỗi máy chủ — có thể tạm thời)` };
    if (entry.role !== 'site') return { state: 'alive', reason: `HTTP ${r.status} (có phản hồi)` };
    if (r.status === 404 || r.status === 410) {
      const hit = (entry.keywords || []).some((k) => lower.includes(k.toLowerCase()));
      return hit ? { state: 'alive', reason: `HTTP ${r.status}` } : { state: 'down', reason: `HTTP ${r.status} ở trang chủ` };
    }
    return { state: 'blocked', reason: `HTTP ${r.status} (không kết luận được)` };
  }

  async function check(entry, url) {
    const r = await probeWithRetry(url);
    return { ...classify(r, entry, hostOf(url)), status: r.ok ? r.status : null, finalUrl: r.ok ? r.finalUrl : null };
  }

  async function resolvesDns(host) {
    try {
      await Promise.race([lookupImpl(host), new Promise((_, rej) => setTimeout(() => rej(new Error('dns-timeout')), 4000))]);
      return true;
    } catch { return false; }
  }

  return { httpProbe, probeWithRetry, classify, check, resolvesDns };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const splitList = (s) => String(s || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

// ------------------------- tìm domain thay thế -------------------------
// Thử theo nhóm ưu tiên, nhóm nào có kết quả HỢP LỆ thì dừng. Domain mới phải: phân giải được DNS,
// trả 2xx/3xx, KHÔNG phải trang đỗ tên miền, và nội dung có tên nguồn (chống domain bị người khác mua).
export async function discover(entry, currentUrl, prober, { extra = [], env = process.env } = {}) {
  const curHost = normHost(hostOf(currentUrl));
  const groups = [
    ['extra', extra],
    ['biến ứng viên', splitList(env[`${entry.envVar}_CANDIDATES`])],
    ['mirror đã biết', entry.candidates || []],
    ['biến thể tên/đuôi', generateVariants(curHost)]
  ];
  const unverified = [];
  const seen = new Set([curHost]);
  for (const [via, list] of groups) {
    const hosts = [];
    for (const item of list) {
      const h = normHost(hostOf(item));
      if (h && !seen.has(h)) { seen.add(h); hosts.push(h); }
    }
    if (!hosts.length) continue;
    const resolvable = (await mapPool(hosts, 16, async (h) => ((await prober.resolvesDns(h)) ? h : null))).filter(Boolean);
    const results = await mapPool(resolvable, 6, async (h) => {
      const res = await prober.check(entry, `https://${h}`);
      return { host: h, ...res };
    });
    for (const r of results) if (r.state === 'blocked') unverified.push(r.host);
    const good = results.find((r) => r.state === 'alive' || r.state === 'moved');
    if (good) {
      const url = good.state === 'moved' ? good.newOrigin : `https://${good.host}`;
      return { url, via, unverified };
    }
  }
  return { url: null, via: null, unverified };
}

// ------------------------- ghi GitHub Variables -------------------------
function ghContext({ token, repo }) {
  const base = `https://api.github.com/repos/${repo}/actions/variables`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'check-domains', 'Content-Type': 'application/json' };
  return { base, headers };
}
const snippet = async (r) => { try { return String(await r.text()).slice(0, 160); } catch { return ''; } };

/** Đọc 1 biến repo: { status: 'ok'|'missing'|'error', value?, reason? } */
export async function getRepoVariable(name, { token, repo, fetchImpl = globalThis.fetch }) {
  if (!token) return { status: 'error', reason: 'thiếu secret GH_VARIABLES_TOKEN' };
  if (!repo) return { status: 'error', reason: 'thiếu GITHUB_REPOSITORY' };
  const { base, headers } = ghContext({ token, repo });
  try {
    const r = await fetchImpl(`${base}/${encodeURIComponent(name)}`, { headers });
    if (r.status === 404) return { status: 'missing' };
    if (r.status !== 200) return { status: 'error', reason: `GET HTTP ${r.status} ${await snippet(r)} (token thiếu quyền Variables?)` };
    let value = '';
    try { value = String(JSON.parse(await r.text())?.value ?? ''); } catch { /* giữ rỗng */ }
    return { status: 'ok', value };
  } catch (err) {
    return { status: 'error', reason: `lỗi mạng: ${err.message}` };
  }
}

/** Ghi 1 biến repo (PATCH nếu đã có, POST nếu chưa). `exists` lấy từ getRepoVariable. */
export async function writeRepoVariable(name, value, exists, { token, repo, fetchImpl = globalThis.fetch }) {
  if (!token) return { applied: false, reason: 'thiếu secret GH_VARIABLES_TOKEN' };
  if (!repo) return { applied: false, reason: 'thiếu GITHUB_REPOSITORY' };
  const { base, headers } = ghContext({ token, repo });
  try {
    if (exists) {
      const r = await fetchImpl(`${base}/${encodeURIComponent(name)}`, { method: 'PATCH', headers, body: JSON.stringify({ name, value }) });
      return r.status === 204 ? { applied: true, mode: 'cập nhật' } : { applied: false, reason: `PATCH HTTP ${r.status} ${await snippet(r)}` };
    }
    const r = await fetchImpl(base, { method: 'POST', headers, body: JSON.stringify({ name, value }) });
    return r.status === 201 ? { applied: true, mode: 'tạo mới' } : { applied: false, reason: `POST HTTP ${r.status} ${await snippet(r)}` };
  } catch (err) {
    return { applied: false, reason: `lỗi mạng: ${err.message}` };
  }
}

export async function setRepoVariable(name, value, ctx) {
  const got = await getRepoVariable(name, ctx);
  if (got.status === 'error') return { applied: false, reason: got.reason };
  return writeRepoVariable(name, value, got.status === 'ok', ctx);
}

// ------------------------------- chạy chính -------------------------------
// Cùng thứ tự ưu tiên với scripts/expand-source-domains.mjs (nơi workflow chính dùng):
// dòng trong SOURCE_DOMAINS > biến riêng lẻ cũ > domain mặc định trong code.
export function currentUrlOf(entry, env = process.env) {
  const combined = parseSourceDomains(env[SOURCE_DOMAINS_VAR]).map[entry.envVar];
  return combined || stripSlash(env[entry.envVar]) || entry.defaultUrl;
}

export async function run({ env = process.env, prober = createProber(), fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const autoFix = !/^(0|false|no|off)$/i.test(String(env.AUTO_FIX ?? '1').trim() || '1');
  const only = splitList(env.SOURCES).map((s) => s.toLowerCase());
  const filter = only.length && !only.includes('all') ? (e) => only.some((k) => e.key === k || e.key.startsWith(`${k}-`)) : () => true;
  const extra = splitList(env.EXTRA_CANDIDATES);
  const token = env.GH_VARIABLES_TOKEN || '';
  const repo = env.GITHUB_REPOSITORY || '';

  const cache = new Map(); // cùng 1 URL chỉ quét 1 lần/lượt
  const rows = [];
  const changed = [];
  const pending = []; // domain mới cần ghi vào SOURCE_DOMAINS (ghi MỘT lần ở cuối)
  for (const entry of SOURCES.filter(filter)) {
    const cur = currentUrlOf(entry, env);
    const key = `${entry.role}|${cur}`;
    if (!cache.has(key)) cache.set(key, await prober.check(entry, cur));
    const res = cache.get(key);
    const row = { entry, cur, state: res.state, reason: res.reason, newUrl: '', action: '' };
    log(`[${entry.key}] ${cur} -> ${res.state} (${res.reason})`);

    const needsNew = (res.state === 'down' || res.state === 'moved') && entry.role === 'site';
    if (needsNew) {
      let found;
      if (res.state === 'moved') found = { url: res.newOrigin, via: 'chuyển hướng của chính trang', unverified: [] };
      else found = await discover(entry, cur, prober, { extra, env });
      if (found.url) {
        row.newUrl = found.url;
        const line = `${entry.key}=${found.url}`;
        if (!entry.autoFix) {
          row.action = `đề xuất: thêm dòng \`${line}\` vào biến ${SOURCE_DOMAINS_VAR} (nguồn này không tự ghi — xem CHECK_DOMAINS.md)`;
        } else if (!autoFix) {
          row.action = `tìm thấy (${found.via}) — CHƯA áp dụng vì auto_fix=false. Thêm dòng \`${line}\` vào biến ${SOURCE_DOMAINS_VAR} nếu muốn dùng`;
        } else {
          pending.push({ row, url: found.url, via: found.via });
        }
        log(`[${entry.key}] domain mới: ${found.url} (${found.via})`);
      } else {
        row.action = `❌ không tìm được domain thay thế${found.unverified?.length ? ` (domain bị chặn bot, chưa xác minh được: ${found.unverified.slice(0, 5).join(', ')})` : ''} — hãy chạy lại với ô extra_candidates`;
        log(`[${entry.key}] ${row.action}`);
      }
    } else if (res.state === 'down') {
      row.action = `❌ không phản hồi — kiểm tra/sửa dòng tương ứng trong biến ${SOURCE_DOMAINS_VAR}`;
    } else if (res.state === 'suspect' || res.state === 'degraded' || res.state === 'blocked') {
      row.action = '⚠️ cần theo dõi (không tự đổi)';
    }
    rows.push(row);
  }

  // Ghi gộp MỘT lần vào SOURCE_DOMAINS: lấy giá trị MỚI NHẤT từ GitHub (tránh ghi đè chỉnh sửa tay
  // vừa làm), thêm/sửa đúng các dòng cần đổi, GIỮ NGUYÊN định dạng (JSON/dòng), ghi chú, dòng khác.
  if (pending.length) {
    const ctx = { token, repo, fetchImpl };
    let base = String(env[SOURCE_DOMAINS_VAR] ?? '');
    let exists = base.trim() !== '';
    let failReason = '';
    if (!token) failReason = 'thiếu secret GH_VARIABLES_TOKEN';
    else if (!repo) failReason = 'thiếu GITHUB_REPOSITORY';
    else {
      const got = await getRepoVariable(SOURCE_DOMAINS_VAR, ctx);
      if (got.status === 'ok') { base = got.value; exists = true; }
      else if (got.status === 'missing') { base = ''; exists = false; }
      else failReason = got.reason;
    }
    let text = base;
    if (!failReason) {
      for (const p of pending) {
        const next = updateSourceDomainsText(text, p.row.entry, p.url);
        if (next === null) { failReason = `${SOURCE_DOMAINS_VAR} đang là JSON hỏng nên không gộp tự động được — hãy sửa tay`; break; }
        text = next;
      }
    }
    const result = failReason ? { applied: false, reason: failReason } : await writeRepoVariable(SOURCE_DOMAINS_VAR, text, exists, ctx);
    for (const p of pending) {
      const line = `${p.row.entry.key}=${p.url}`;
      p.row.action = result.applied
        ? `✅ đã ${result.mode} biến ${SOURCE_DOMAINS_VAR}: ${line}`
        : `⚠️ tìm thấy ${p.url} nhưng KHÔNG ghi được biến ${SOURCE_DOMAINS_VAR}: ${result.reason}. Tự thêm/sửa dòng \`${line}\` trong biến ${SOURCE_DOMAINS_VAR}`;
      log(`[${p.row.entry.key}] ${p.row.action}`);
    }
    if (result.applied) changed.push(SOURCE_DOMAINS_VAR);
  }

  const unresolved = rows.filter((r) => r.state === 'down' && !r.action.startsWith('✅')).length
    + rows.filter((r) => r.state === 'moved' && !r.action.startsWith('✅') && r.entry.autoFix && autoFix).length;
  return { rows, changed, unresolved, autoFix };
}

const ICON = { alive: '🟢 sống', moved: '🟠 đã chuyển', blocked: '🟡 bị chặn bot', suspect: '🟡 nghi ngờ', degraded: '🟡 lỗi tạm', down: '🔴 chết' };

export function renderSummary({ rows, changed, unresolved, autoFix }) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
  const lines = [
    '## Kết quả quét domain',
    '',
    `Chế độ: ${autoFix ? 'tự sửa (auto_fix)' : 'chỉ quét'} · Biến đã ghi: ${changed.length ? changed.join(', ') : 'không'} · Chưa xử lý được: ${unresolved}`,
    '',
    '| Nguồn | Tên trong biến | Domain hiện tại | Trạng thái | Domain mới | Hành động |',
    '|---|---|---|---|---|---|'
  ];
  for (const r of rows) {
    lines.push(`| ${esc(r.entry.label)} | \`${r.entry.key}\` | ${esc(r.cur)} | ${ICON[r.state] || r.state} — ${esc(r.reason)} | ${esc(r.newUrl)} | ${esc(r.action)} |`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const out = await run();
  const md = renderSummary(out);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log('\n' + md);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${out.changed.length ? 'true' : 'false'}\nchanged_vars=${out.changed.join(',')}\nunresolved=${out.unresolved}\n`);
  }
  process.exit(out.unresolved > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
