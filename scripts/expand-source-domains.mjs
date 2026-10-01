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
// Không bao giờ làm hỏng workflow: gõ sai tên/giá trị chỉ bị bỏ qua + cảnh báo (::warning::).

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SOURCES, parseSourceDomains } from './source-domains.mjs';

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

function main() {
  const result = expand();
  const table = renderTable(result);
  console.log(table);
  for (const w of result.warnings) console.log(`::warning title=SOURCE_DOMAINS::${w}`);
  if (process.env.GITHUB_ENV && result.lines.length) {
    fs.appendFileSync(process.env.GITHUB_ENV, result.lines.join('\n') + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
