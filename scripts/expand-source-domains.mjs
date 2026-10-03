#!/usr/bin/env node
// Đọc biến GitHub SOURCE_DOMAINS (chứa domain của TẤT CẢ nguồn) và "mở" nó thành các
// biến môi trường thường (GIOVANG_DOMAIN, SAOKE_BASE_URL, ...) cho MỌI bước phía sau
// trong job, bằng cách ghi vào $GITHUB_ENV. Nhờ vậy code các nguồn KHÔNG cần sửa gì:
// chúng vẫn đọc process.env.<TÊN BIẾN> || <domain mặc định> như trước.
//
// Thứ tự ưu tiên cho từng nguồn:
//   1) dòng của nguồn đó trong SOURCE_DOMAINS
//   2) biến riêng lẻ cũ (vd GIOVANG_DOMAIN) nếu có
//   3) không ghi gì -> code dùng domain mặc định
//
// THEO REDIRECT LÚC CHẠY: với mỗi nguồn có domain trang web, hỏi thử domain đang dùng 1 lần — nếu nó
// chuyển hướng sang domain khác và trang đích đúng là nguồn đó (xem scripts/resolve-redirects.mjs) thì
// dùng domain mới ngay cho lần chạy này (không cần sửa biến) và in cảnh báo kèm dòng nên cập nhật vào
// SOURCE_DOMAINS. Tắt bằng biến GitHub FOLLOW_REDIRECTS=0.
//
// Không bao giờ làm hỏng workflow: gõ sai tên/giá trị chỉ bị bỏ qua + cảnh báo (::warning::).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SOURCES, parseSourceDomains } from './source-domains.mjs';
import { resolveRedirect } from './resolve-redirects.mjs';

export function expand(env = process.env) {
  const parsed = parseSourceDomains(env.SOURCE_DOMAINS);
  const rows = [];
  const lines = [];
  for (const e of SOURCES) {
    const fromCombined = parsed.map[e.envVar];
    const individual = String(env[e.envVar] ?? '').trim().replace(/[\r\n]+/g, '');
    let value = '';
    let from = 'mặc định trong code';
    if (fromCombined) { value = fromCombined; from = 'SOURCE_DOMAINS'; }
    else if (individual) { value = individual; from = 'biến riêng lẻ'; }
    if (value) lines.push(`${e.envVar}=${value}`);
    rows.push({ entry: e, value: value || e.defaultUrl, from });
  }
  return { rows, lines, warnings: parsed.warnings, format: parsed.format };
}

/** expand() + theo redirect của domain trang web (chỉ nguồn role=site & autoFix; domain API/player không đụng tới). */
export async function expandWithRedirects(env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const base = expand(env);
  const off = /^(0|false|no|off)$/i.test(String(env.FOLLOW_REDIRECTS ?? '1').trim() || '1');
  if (off) return { ...base, followed: [] };
  const timeoutMs = Number(env.REDIRECT_TIMEOUT_MS) > 0 ? Number(env.REDIRECT_TIMEOUT_MS) : 10000;
  const targets = base.rows.filter((r) => r.entry.role === 'site' && r.entry.autoFix);
  const results = await Promise.all(targets.map((r) => resolveRedirect(r.entry, r.value, { fetchImpl, timeoutMs })));
  const warnings = [...base.warnings];
  const followed = [];
  const lineByVar = new Map(base.lines.map((l) => [l.slice(0, l.indexOf('=')), l]));
  targets.forEach((row, i) => {
    const res = results[i];
    if (!res.moved) return;
    if (!res.accepted) {
      warnings.push(`${row.entry.key}: ${row.value} chuyển hướng sang ${res.newUrl} nhưng ${res.reason} — KHÔNG dùng, giữ domain đã khai báo`);
      return;
    }
    followed.push({ key: row.entry.key, from: row.value, to: res.newUrl });
    warnings.push(`${row.entry.key}: domain đã khai báo ${row.value} đang chuyển hướng sang ${res.newUrl} (${res.reason}) — lần chạy này TỰ DÙNG ${res.newUrl}; nên cập nhật dòng \`${row.entry.key}=${res.newUrl}\` trong biến SOURCE_DOMAINS (hoặc bấm workflow Check Domains)`);
    row.from = `tự theo redirect (khai báo: ${row.value})`;
    row.value = res.newUrl;
    lineByVar.set(row.entry.envVar, `${row.entry.envVar}=${res.newUrl}`);
  });
  return { ...base, lines: [...lineByVar.values()], warnings, followed };
}

export function renderTable({ rows, warnings, format }) {
  const out = [
    '## Domain các nguồn đang dùng',
    '',
    `Biến SOURCE_DOMAINS: ${format === 'empty' ? 'chưa khai báo (dùng biến riêng lẻ / mặc định)' : format === 'json' ? 'dạng JSON' : 'dạng từng dòng'}`,
    '',
    '| Nguồn | Domain đang dùng | Lấy từ |',
    '|---|---|---|'
  ];
  for (const r of rows) out.push(`| ${r.entry.label} (\`${r.entry.key}\`) | ${r.value} | ${r.from} |`);
  if (warnings.length) out.push('', '**Cảnh báo:**', ...warnings.map((w) => `- ${w}`));
  return out.join('\n') + '\n';
}

async function main() {
  const result = await expandWithRedirects();
  const table = renderTable(result);
  console.log(table);
  for (const w of result.warnings) console.log(`::warning title=SOURCE_DOMAINS::${w}`);
  if (process.env.GITHUB_ENV && result.lines.length) {
    fs.appendFileSync(process.env.GITHUB_ENV, result.lines.join('\n') + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(0); }); // không bao giờ làm hỏng workflow
