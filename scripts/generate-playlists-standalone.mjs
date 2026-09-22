// Bản KHÔNG CẦN SERVER của scripts/generate-playlists.js — tự quét trực
// tiếp mọi nguồn (gọi thẳng buildAggregatedMatches(), y hệt logic
// /api/playlist đang dùng) NGAY TRONG tiến trình Node đang chạy, không gọi
// HTTP ra bất kỳ trang nào đã deploy (Vercel/Render/VPS) — vì theo yêu cầu
// (20/09/2026): "không deploy VPS nào cả, chỉ up lên GitHub, link playlist
// tổng hợp các nguồn ở trên git".
//
// TRƯỚC ĐÂY (scripts/generate-playlists.js) phải gọi qua HTTP tới 1 trang
// ĐÃ DEPLOY vì 2 lý do (xem chú thích đầu file đó):
//   1) Các service dùng alias "@/..." — chỉ Next.js/webpack hiểu, Node chạy
//      trực tiếp 1 file .js không hiểu alias này.
//   2) 1 số nguồn (Giovang, Khán Đài) cần mở Chromium headless.
// Bản này giải quyết cả 2:
//   1) KHÔNG chạy trực tiếp file .mjs này bằng `node` — phải BUNDLE trước
//      bằng esbuild (đọc alias "@/..." thẳng từ jsconfig.json, đã tự kiểm
//      chứng chạy đúng) ra 1 file .cjs độc lập rồi mới `node` file đó (xem
//      package.json script "generate-playlists:standalone" và bước
//      "Bundle standalone playlist generator" trong
//      .github/workflows/validate-and-generate.yml).
//   2) Cài Chromium thật + trỏ biến CHROME_EXECUTABLE_PATH (xem bước
//      "Install Chromium" trong workflow) — src/utils/browserFetch.js đã
//      tự ưu tiên biến này từ trước (dùng chung với hướng dẫn VPS/Docker,
//      xem DEPLOY_VPS.md), không cần sửa gì thêm ở đó.
//
// TỰ GIÃN/THU CHU KỲ LÀM MỚI: y hệt bản cũ, xem chú thích trong
// scripts/generate-playlists.js.

// FIX (20/09/2026 — "utils.forOwn is not a function" khi chạy qua bundle
// esbuild, riêng Khán Đài — nguồn cần trình duyệt headless ngay từ bước lấy
// DANH SÁCH trận): ĐÃ XÁC ĐỊNH ĐƯỢC nguyên nhân — esbuild cố BUNDLE LUÔN cả
// puppeteer-extra-plugin-stealth vào 1 file, nhưng gói này (qua clone-deep)
// dùng `require()` ĐỘNG (tính toán tên module lúc chạy, không tĩnh) mà
// esbuild không phân tích/đóng gói đúng được — tự kiểm chứng: chạy KHÔNG
// qua bundle thì đăng ký plugin bình thường, bundle bằng esbuild thông
// thường thì lỗi ngay ("Cannot find module 'kind-of'" hoặc "utils.forOwn is
// not a function" tuỳ đúng chỗ nào bị đóng gói sai). Cách sửa: KHÔNG bundle
// các gói puppeteer-* + @sparticuz/chromium-min — đánh dấu "--external" cho
// chúng (xem package.json, script "generate-playlists:standalone:build") để
// esbuild chỉ lo phần alias "@/..." (lý do duy nhất cần bundle), còn các gói
// này giữ nguyên `require()` bình thường, tự resolve qua node_modules lúc
// chạy thật (luôn có sẵn vì `npm ci` chạy trước, xem workflow) — đã tự
// kiểm chứng chạy sạch sau khi thêm --external, không còn lỗi.
import fs from 'fs';
import path from 'path';
import { buildAggregatedMatches } from '@/src/services/playlistBuilder.service';
import { filterBySportTab, filterBySource, getSourceKey, getSourceLabel, SOURCE_GROUP_ORDER } from '@/src/utils/playerGet';
import { matchesToPlaylistEntries, buildM3uPlaylist } from '@/src/utils/m3uPlaylist';

// FIX (20/09/2026 — "OUTPUT_DIR sai đường dẫn sau khi bundle"): trước đây
// dùng path.dirname(fileURLToPath(import.meta.url)) để tự dò thư mục chứa
// chính file này (kiểu ESM chuẩn) — CHẠY ĐÚNG lúc còn là file .mjs nguồn,
// nhưng SAI hẳn sau khi esbuild đóng gói ra CJS (--format=cjs, xem
// package.json): "import.meta" KHÔNG tồn tại trong CJS, esbuild tự cảnh
// báo và để giá trị rỗng — fileURLToPath(undefined) ném lỗi ngay khi chạy.
// Dùng process.cwd() thay thế — kịch bản chạy DUY NHẤT của file này là qua
// `npm run generate-playlists:standalone` (xem package.json), luôn thực thi
// từ gốc repo, nên process.cwd() luôn đúng, không phụ thuộc ESM/CJS gì cả.
const __dirname = process.cwd();

// Khớp với SPORT_TABS trong src/utils/playerGet.js (bỏ 'esports' vì cũng bị lọc bỏ ở đó).
const SPORT_TABS = ['all', 'football', 'basketball', 'volleyball', 'badminton', 'tennis', 'f1'];
// Khớp với SOURCE_GROUP_ORDER trong src/utils/playerGet.js.
// FIX (20/09/2026): trước đây tự khai báo lại danh sách nguồn ở đây (dễ
// quên đồng bộ mỗi khi thêm/bớt nguồn, như vừa xảy ra khi loại Pháo Hoa) —
// giờ dùng thẳng SOURCE_GROUP_ORDER đã import từ playerGet.js (nguồn định
// nghĩa DUY NHẤT), chỉ cần sửa 1 chỗ đó khi danh sách nguồn thay đổi.
const SOURCE_KEYS = SOURCE_GROUP_ORDER;

const OUTPUT_DIR = path.join(__dirname, 'public', 'playlists');
const STATE_PATH = path.join(OUTPUT_DIR, '.refresh-state.json');

const BASE_INTERVAL_MIN = 2; // khớp lịch cron */2 trong .github/workflows/validate-and-generate.yml
const MAX_INTERVAL_MIN = 120;
const WATCH_INTERVAL_MS = BASE_INTERVAL_MIN * 60 * 1000;

function isWatchMode() {
  return process.argv.includes('--watch');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// FIX (20/09/2026 — "cần debug để phát hiện từng nguồn lỗi"): trước đây
// muốn biết nguồn nào đang lỗi/trả về 0 trận phải tự đọc lẫn trong hàng
// chục dòng log lỗi rải rác (mỗi nguồn tự console.error theo kiểu riêng,
// xem các file src/services/*.service.js) — không có chỗ nào tổng kết lại
// "nguồn nào ra bao nhiêu trận" ở 1 chỗ. Hàm này in ra 1 bảng tổng kết ngay
// sau mỗi lần quét — CHỈ đọc lại kết quả trận đã có (không tự đoán lý do
// lỗi, vì lý do thật đã in chi tiết ở các dòng log phía trên rồi, xem lại
// đó để biết chính xác lỗi gì) — mục đích là chỉ thẳng NGUỒN NÀO cần xem
// log kỹ hơn, đỡ phải dò cả log dài. Khi chạy trong GitHub Actions
// (GITHUB_STEP_SUMMARY có sẵn, biến do chính GitHub tự tiêm vào, không cần
// khai báo gì thêm), in luôn ra dạng bảng markdown, hiện thẳng ngay trên
// trang tóm tắt của lượt chạy đó, khỏi cần mở log ra tìm.
function logSourceSummary(matches) {
  const counts = Object.fromEntries(SOURCE_GROUP_ORDER.map((key) => [key, 0]));
  for (const match of matches) {
    const key = getSourceKey(match);
    if (key in counts) counts[key] += 1;
  }

  console.log('[generate-playlists] Tổng kết theo nguồn:');
  const rows = SOURCE_GROUP_ORDER.map((key) => {
    const count = counts[key];
    const label = getSourceLabel(key);
    const flag = count > 0 ? '' : '  ⚠️  0 trận — xem log lỗi phía trên (nếu có) để biết vì sao';
    console.log(`  - ${label} (${key}): ${count} trận${flag}`);
    return { key, label, count };
  });

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const lines = [
      '### Tổng kết theo nguồn',
      '',
      '| Nguồn | Số trận |',
      '| --- | --- |',
      ...rows.map((r) => `| ${r.label} (\`${r.key}\`) | ${r.count > 0 ? r.count : '⚠️ 0'} |`),
      ''
    ];
    try {
      fs.appendFileSync(summaryPath, lines.join('\n') + '\n');
    } catch (err) {
      console.warn('[generate-playlists] Không ghi được GITHUB_STEP_SUMMARY:', err.message);
    }
  }
}

/** @returns {Promise<{ ok: boolean, liveMatchCount: number }>} */
async function generateOnce() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('[generate-playlists] Đang tự quét toàn bộ nguồn (không qua server nào)...');
  const matches = await buildAggregatedMatches(); // 1 lần quét DUY NHẤT, tái dùng cho mọi file bên dưới — tránh quét lại nhiều lần gây chậm/dội nguồn.
  console.log(`[generate-playlists] Quét xong — ${matches.length} trận (live + sắp đấu trong 24h).`);

  logSourceSummary(matches);

  let hasError = false;
  let liveMatchCount = 0;

  for (const sport of SPORT_TABS) {
    try {
      const bySport = filterBySportTab(matches, sport);
      const entries = await matchesToPlaylistEntries(bySport, { baseUrl: '' }); // baseUrl rỗng — không có server để trỏ link resolver, xem FIX 20/09/2026 trong m3uPlaylist.js
      const content = buildM3uPlaylist(entries);
      const filename = `${sport}.m3u`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, 'utf8');
      const matchCount = (content.match(/^#EXTINF/gm) || []).length;
      if (sport === 'all') liveMatchCount = bySport.filter((m) => m?.status?.isLive).length;
      console.log(`[generate-playlists] ${filename}: ${matchCount} kênh`);
    } catch (err) {
      hasError = true;
      console.error(`[generate-playlists] Lỗi khi tạo playlist "${sport}":`, err.message);
    }
  }

  const allSports = filterBySportTab(matches, 'all');
  for (const source of SOURCE_KEYS) {
    try {
      const bySource = filterBySource(allSports, source);
      const entries = await matchesToPlaylistEntries(bySource, { baseUrl: '' });
      const content = buildM3uPlaylist(entries);
      const filename = `source-${source}.m3u`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, 'utf8');
      const matchCount = (content.match(/^#EXTINF/gm) || []).length;
      console.log(`[generate-playlists] ${filename}: ${matchCount} kênh`);
    } catch (err) {
      hasError = true;
      console.error(`[generate-playlists] Lỗi khi tạo playlist nguồn "${source}":`, err.message);
    }
  }

  return { ok: !hasError, liveMatchCount };
}

async function runAdaptiveCycle() {
  const now = Date.now();
  const state = readState();

  if (state?.nextCheckAt && now < state.nextCheckAt) {
    const remainMin = Math.ceil((state.nextCheckAt - now) / 60000);
    console.log(
      `[generate-playlists] Bỏ qua lần này — đang giãn chu kỳ vì không có trận live ` +
      `(còn ~${remainMin} phút nữa mới tới giờ hẹn, chu kỳ hiện tại: ${state.intervalMin} phút).`
    );
    return true;
  }

  const { ok, liveMatchCount } = await generateOnce();

  const prevInterval = state?.intervalMin || BASE_INTERVAL_MIN;
  const nextInterval = liveMatchCount > 0
    ? BASE_INTERVAL_MIN
    : Math.min(prevInterval * 2, MAX_INTERVAL_MIN);

  writeState({
    lastRunAt: new Date(now).toISOString(),
    liveMatchCount,
    intervalMin: nextInterval,
    nextCheckAt: now + nextInterval * 60 * 1000,
  });

  console.log(
    liveMatchCount > 0
      ? `[generate-playlists] Đang có ${liveMatchCount} trận live — giữ chu kỳ ${BASE_INTERVAL_MIN} phút.`
      : `[generate-playlists] Không có trận live — giãn chu kỳ lần tới ra ${nextInterval} phút.`
  );

  return ok;
}

async function main() {
  if (isWatchMode()) {
    console.log(`[generate-playlists] Chế độ watch (local) — kiểm tra mỗi ${WATCH_INTERVAL_MS / 60000} phút, tự giãn khi im ắng. Ctrl+C để dừng.`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await runAdaptiveCycle();
      await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
    }
  }

  const ok = await runAdaptiveCycle();
  process.exit(ok ? 0 : 1);
}

main();
