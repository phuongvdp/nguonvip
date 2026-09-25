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
// FIX (22/09/2026 — "cron phải chạy đều 2 phút/lần liên tục, không giãn
// cách khi ít/không có trận"): TRƯỚC ĐÂY script tự "giãn" chu kỳ làm mới ra
// (x2 mỗi lần, tối đa 2 tiếng) mỗi khi không thấy trận live nào, và các lần
// cron "gõ cửa" trong lúc chưa tới giờ hẹn sẽ bị BỎ QUA (không quét, không
// ghi file gì cả) — xem lịch sử qua git nếu cần đối chiếu logic cũ. Theo
// yêu cầu mới: bỏ hẳn phần giãn/bỏ-qua đó — mọi lần cron gọi tới (đều đặn
// mỗi 2 phút, khớp `.github/workflows/validate-and-generate.yml`) đều CHẠY
// THẬT (generateOnce()) 100%, bất kể đang có bao nhiêu trận live. File
// .refresh-state.json vẫn được ghi lại nhưng CHỈ để log/tham khảo
// (lastRunAt, liveMatchCount) — không còn trường nextCheckAt/intervalMin
// nào được dùng để quyết định bỏ qua lần chạy nữa.

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
import { execSync } from 'child_process';
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

const BASE_INTERVAL_MIN = 2; // 1 job GitHub Actions "watch" liên tục cách nhau 2 phút/chu kỳ (xem FIX 22/09/2026 bên dưới) — khi chạy `--watch` ở local cũng dùng chu kỳ này.
const WATCH_INTERVAL_MS = BASE_INTERVAL_MIN * 60 * 1000;

// FIX (22/09/2026 — "cần cron chạy đều 2 phút LIÊN TỤC nhưng GitHub Actions
// không cho lịch `schedule` mịn hơn ~5 phút và job tối đa chỉ 6 tiếng"):
// TRƯỚC ĐÂY workflow dùng `schedule: '*/2 * * * *'` gọi 1 job MỚI mỗi 2
// phút, chạy generateOnce() 1 lần rồi thoát — nhưng GitHub KHÔNG đảm bảo
// lịch */2 chạy đúng giờ (hàng đợi runner có thể trễ vài phút, thậm chí bỏ
// lượt khi tải cao). Cách chắc chắn "2 phút liên tục" hơn: dùng 1 job DUY
// NHẤT, tự lặp bên trong bằng `--watch` (đã có sẵn khung này từ trước) —
// mỗi chu kỳ tự generateOnce() + tự commit/push luôn (xem commitAndPush()),
// rồi `sleep` 2 phút, lặp lại — không phụ thuộc runner nhận lịch mới mỗi
// lần. Vì 1 job GitHub Actions có giới hạn cứng 6 tiếng (360 phút), vòng
// lặp tự dừng trước mốc đó (xem MAX_RUNTIME_MS) rồi tự gọi API
// `workflow_dispatch` kích hoạt lại chính workflow này (xem
// triggerSelfRestart()) để có 1 job MỚI tiếp tục ngay, không gián đoạn.
// Lịch `schedule` trong workflow vẫn giữ lại nhưng chỉ còn vai trò DỰ
// PHÒNG (giãn ra vài tiếng/lần) — phòng khi triggerSelfRestart() thất bại
// (hết hạn token, lỗi mạng, v.v.) thì vẫn có người bắt lại, không "chết"
// hẳn dây chuyền.
const MAX_RUNTIME_MIN = Number(process.env.MAX_RUNTIME_MINUTES || 345); // để dư ~15 phút đệm trước giới hạn 360 phút/job của GitHub Actions (cho commit/push + gọi API cuối cùng kịp hoàn tất)
const MAX_RUNTIME_MS = MAX_RUNTIME_MIN * 60 * 1000;

// Chỉ bật commit/push tự động bên trong vòng lặp khi chạy trong job GitHub
// Actions thật (workflow tự set biến này ở bước "Generate playlists") —
// tránh việc lỡ tay chạy `--watch` ở máy local rồi tự commit/push nhầm vào
// repo của người dùng.
const AUTO_COMMIT = process.env.GENERATE_AUTO_COMMIT === '1';

function isWatchMode() {
  return process.argv.includes('--watch');
}

function ensureGitIdentity() {
  if (!AUTO_COMMIT) return;
  try {
    execSync('git config user.email "actions@github.com"');
    execSync('git config user.name "GitHub Actions"');
  } catch (err) {
    console.warn('[generate-playlists] Không set được git identity:', err.message);
  }
}

// Commit + push ngay sau MỖI chu kỳ (không đợi tới lúc job kết thúc) — đây
// là điểm mấu chốt để "2 phút/lần" là thật: nếu chỉ commit 1 lần lúc job
// thoát (sau ~5h45) thì người xem sẽ chỉ thấy playlist mới mỗi ~6 tiếng chứ
// không phải mỗi 2 phút, dù script vẫn quét đúng chu kỳ bên trong.
//
// FIX (23/09/2026 — "cron chạy 2 phút liên tục nhưng không tạo/cập nhật
// file trên GitHub"): TRƯỚC ĐÂY `git push` gọi thẳng, không hề `pull`/
// `rebase` trước. Nếu CÓ AI (kể cả chính người dùng) sửa/đổi tên file trực
// tiếp trên GitHub trong lúc job vòng-lặp này đang chạy (đã tự xác minh qua
// ảnh chụp thật của người dùng — commit gần nhất là người dùng, không phải
// bot), nhánh local của job liền bị "lùi sau" nhánh `main` trên GitHub ->
// MỌI `git push` kể từ đó bị GitHub từ chối (non-fast-forward / "fetch
// first"). Lỗi đó rơi vào catch() bên dưới -> chỉ log ra, KHÔNG dừng vòng
// lặp -> script vẫn "chạy đều 2 phút/lần" đúng như log thể hiện (không nói
// dối), nhưng không commit/push được gì lên GitHub nữa cho tới khi job này
// tự thoát (tối đa 5h45) và job kế tiếp checkout lại từ đầu — nhìn từ ngoài
// giống như "cron chết" dù thực ra nó vẫn sống, chỉ là bị khoá cứng khỏi
// remote. SỬA: fetch + rebase lên `origin/<branch>` mới nhất TRƯỚC khi
// push mỗi chu kỳ. Nếu rebase bị conflict thật (hiếm — chỉ xảy ra khi có
// người sửa tay ĐÚNG file bot đang ghi), huỷ rebase và đồng bộ cứng theo
// `origin` (`reset --hard`) — chấp nhận mất đúng 1 chu kỳ (2 phút) thay vì
// kẹt cứng nhiều giờ; chu kỳ kế tiếp sẽ tự sinh lại nội dung mới và commit
// bình thường trên nền đã đồng bộ.
function commitAndPush() {
  if (!AUTO_COMMIT) return;
  try {
    execSync('git add public/playlists/', { stdio: 'inherit' });
    const hasChanges = execSync('git status --porcelain -- public/playlists/').toString().trim().length > 0;
    if (!hasChanges) {
      console.log('[generate-playlists] Không có thay đổi mới — bỏ qua commit chu kỳ này.');
      return;
    }
    execSync('git commit -m "Generate playlists (auto, watch loop)"', { stdio: 'inherit' });
  } catch (err) {
    console.error('[generate-playlists] Lỗi khi commit:', err.message);
    return;
  }

  try {
    execSync('git push', { stdio: 'inherit' });
    console.log('[generate-playlists] Đã commit & push playlist mới.');
    return;
  } catch (err) {
    console.warn(
      '[generate-playlists] Push bị từ chối (nhánh local lùi sau remote — có thay đổi mới trên GitHub) — ' +
      'thử fetch + rebase rồi push lại:', err.message
    );
  }

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    execSync('git fetch origin', { stdio: 'inherit' });
    try {
      execSync(`git rebase origin/${branch}`, { stdio: 'inherit' });
    } catch (rebaseErr) {
      console.warn(
        '[generate-playlists] Rebase bị conflict thật (có ai sửa tay đúng file bot đang ghi) — ' +
        'huỷ rebase, đồng bộ cứng theo bản mới nhất trên GitHub, bỏ qua commit chu kỳ này:', rebaseErr.message
      );
      try {
        execSync('git rebase --abort', { stdio: 'inherit' });
      } catch {
        // rebase có thể đã tự huỷ một phần — bỏ qua, reset --hard bên dưới vẫn đưa nhánh về trạng thái sạch.
      }
      execSync(`git reset --hard origin/${branch}`, { stdio: 'inherit' });
      console.log('[generate-playlists] Đã đồng bộ lại theo GitHub — chu kỳ sau sẽ tự sinh & commit lại từ đầu.');
      return;
    }
    execSync('git push', { stdio: 'inherit' });
    console.log('[generate-playlists] Đã rebase + commit & push playlist mới.');
  } catch (err) {
    console.error(
      '[generate-playlists] Vẫn lỗi khi fetch/rebase/push — bỏ qua chu kỳ này, thử lại ở chu kỳ kế tiếp (2 phút sau):',
      err.message
    );
  }
}

// Tự gọi REST API của GitHub để kích hoạt lại CHÍNH workflow này
// (workflow_dispatch) ngay trước khi job hiện tại thoát vì sắp chạm giới
// hạn 6 tiếng — nhờ vậy job kế tiếp bắt đầu gần như ngay lập tức, không
// phải chờ tới lượt `schedule` dự phòng (vốn đã giãn ra vài tiếng/lần).
// Dùng thẳng GITHUB_TOKEN mặc định của job (secrets.GITHUB_TOKEN, workflow
// đã truyền vào qua biến môi trường) — token này ĐƯỢC PHÉP kích hoạt
// workflow_dispatch/repository_dispatch dù các sự kiện khác (push,...) do
// chính GITHUB_TOKEN tạo ra thường bị GitHub chặn không cho khởi chạy
// workflow mới (chống đệ quy vô hạn) — 2 loại sự kiện dispatch này là
// ngoại lệ được GitHub tài liệu hoá rõ, nên không cần Personal Access
// Token riêng.
async function triggerSelfRestart() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // dạng "owner/repo", GitHub tự tiêm sẵn
  const ref = process.env.GITHUB_REF_NAME || 'main';
  const workflowFile = 'validate-and-generate.yml';

  if (!token || !repo) {
    console.warn(
      '[generate-playlists] Thiếu GITHUB_TOKEN/GITHUB_REPOSITORY (không chạy trong GitHub Actions?) — ' +
      'bỏ qua bước tự kích hoạt lại, đành chờ lịch schedule dự phòng bắt lại.'
    );
    return;
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref }),
      }
    );

    if (res.ok || res.status === 204) {
      console.log('[generate-playlists] Đã tự gọi API kích hoạt job kế tiếp — sẽ tiếp tục ngay, không chờ schedule dự phòng.');
    } else {
      const body = await res.text();
      console.error(`[generate-playlists] Gọi API tự kích hoạt lại thất bại (HTTP ${res.status}): ${body}`);
      console.error('[generate-playlists] Không sao — lịch schedule dự phòng trong workflow sẽ bắt lại sau.');
    }
  } catch (err) {
    console.error('[generate-playlists] Lỗi khi gọi API tự kích hoạt lại:', err.message);
    console.error('[generate-playlists] Không sao — lịch schedule dự phòng trong workflow sẽ bắt lại sau.');
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

// FIX (22/09/2026 — "all.m3u không tự đổi theo cron 2 phút/lần"): nguyên
// nhân là buildM3uPlaylist() CỐ Ý không in số phút thi đấu vào tên kênh
// (xem getLiveBadge() trong playerGet.js — tránh phá thứ tự sort theo tên),
// nên khi giữa 2 lần quét (2 phút) không có trận nào lên live/kết
// thúc/đổi giờ, nội dung .m3u ra Y HỆT lần trước — commitAndPush() ở dưới
// chỉ commit khi `git status` thấy khác, nên KHÔNG commit gì cả -> nhìn
// giống như file "đứng yên", dễ hiểu lầm là cron chết. Chèn 1 dòng comment
// giờ-quét-gần-nhất (giờ VN) ngay sau "#EXTM3U" — dòng bắt đầu bằng "#" nên
// mọi player IPTV (VLC/TiviMate/...) đều tự bỏ qua khi parse, không ảnh
// hưởng phát sóng — nhưng khiến nội dung file LUÔN khác giữa 2 lần chạy,
// nên git LUÔN có gì để commit, phản ánh đúng thật là cron 2 phút vẫn chạy.
function stampGeneratedAt(content) {
  const vnTime = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });
  const stamp = `# Cập nhật lần cuối: ${vnTime} (giờ VN) — tự làm mới mỗi 2 phút`;
  return content.replace(/^#EXTM3U\n/, `#EXTM3U\n${stamp}\n`);
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
      const content = stampGeneratedAt(buildM3uPlaylist(entries)); // FIX 22/09/2026 — xem stampGeneratedAt() phía trên
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
      const content = stampGeneratedAt(buildM3uPlaylist(entries)); // FIX 22/09/2026 — xem stampGeneratedAt() phía trên
      const filename = `source-${source}.m3u`;
      fs.writeFileSync(path.join(OUTPUT_DIR, filename), content, 'utf8');
      const matchCount = (content.match(/^#EXTINF/gm) || []).length;
      console.log(`[generate-playlists] ${filename}: ${matchCount} kênh`);

      // FIX (25/09/2026 — "muốn proxy sống (hls.js) cũng hưởng Referer tự
      // dò" + "không deploy VPS/Vercel nào cả, chỉ lên GitHub"): LÚC ĐẦU
      // đoạn này được thêm nhầm vào scripts/generate-playlists.js (bản CŨ,
      // gọi qua HTTP tới server đã deploy) — nhưng theo đúng mô hình thật
      // của repo này (xem chú thích đầu file .mjs này + FIX 20/09/2026
      // trong .github/workflows/validate-and-generate.yml), KHÔNG CÓ server
      // nào chạy sống cả, script generate-playlists.js đó không còn được
      // workflow gọi tới nữa — mọi thứ chạy NGAY TRONG tiến trình Node của
      // CHÍNH file .mjs này (gọi thẳng buildAggregatedMatches() ở trên).
      // Chuyển đúng đoạn ghi <nguồn>-referer.json vào đây.
      //
      // Vì hls.js (proxy sống) không có server nào để chạy trong mô hình
      // này, file JSON này hiện KHÔNG có tác dụng thực tế nào (hls.js không
      // được deploy ở đâu để đọc nó) — chỉ còn ý nghĩa nếu sau này bạn có
      // deploy hls.js lên 1 server thật (VPS/Vercel/Render). Vẫn ghi lại vì
      // rẻ (không tốn thêm lần quét nào, chỉ đọc lại chuỗi content đã có
      // sẵn) và vô hại nếu không dùng tới.
      if (source === 'saoke' || source === 'chuoichientv') {
        const refererMatch = content.match(/^#EXTVLCOPT:http-referrer=(.+)$/m);
        const referer = refererMatch ? refererMatch[1].trim() : null;
        const jsonFilename = `${source}-referer.json`;
        if (referer) {
          fs.writeFileSync(
            path.join(OUTPUT_DIR, jsonFilename),
            JSON.stringify({ referer, detectedAt: new Date().toISOString() }, null, 2) + '\n',
            'utf8'
          );
          console.log(`[generate-playlists] ${jsonFilename}: ${referer}`);
        } else {
          console.log(`[generate-playlists] ${jsonFilename}: không có trận live lúc này, giữ nguyên giá trị cũ`);
        }
      }
    } catch (err) {
      hasError = true;
      console.error(`[generate-playlists] Lỗi khi tạo playlist nguồn "${source}":`, err.message);
    }
  }

  return { ok: !hasError, liveMatchCount };
}

async function runCycle() {
  const now = Date.now();

  const { ok, liveMatchCount } = await generateOnce();

  // Chỉ ghi lại để log/tham khảo — không còn nextCheckAt/intervalMin nào
  // được đọc lại để quyết định bỏ qua lần chạy kế tiếp (xem FIX 22/09/2026
  // ở đầu file).
  writeState({
    lastRunAt: new Date(now).toISOString(),
    liveMatchCount,
  });

  commitAndPush(); // commit/push NGAY sau chu kỳ này, không đợi job kết thúc — xem giải thích ở AUTO_COMMIT phía trên.

  console.log(
    `[generate-playlists] Hoàn tất — ${liveMatchCount} trận live. ` +
    `Chạy lại đều đặn sau ${BASE_INTERVAL_MIN} phút (không giãn cách).`
  );

  return ok;
}

async function main() {
  if (isWatchMode()) {
    ensureGitIdentity();
    const startedAt = Date.now();
    console.log(
      `[generate-playlists] Chế độ watch — chạy đều mỗi ${WATCH_INTERVAL_MS / 60000} phút, liên tục, không giãn cách. ` +
      `Tự dừng sau tối đa ${MAX_RUNTIME_MIN} phút/job rồi tự kích hoạt job kế tiếp. Ctrl+C để dừng khi chạy local.`
    );
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await runCycle();

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= MAX_RUNTIME_MS) {
        console.log(
          `[generate-playlists] Đã chạy ${Math.round(elapsedMs / 60000)} phút — dừng vòng lặp trong job này ` +
          `để tránh chạm giới hạn 6 tiếng/job của GitHub Actions.`
        );
        await triggerSelfRestart();
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
    }
    process.exit(0); // luôn thoát 0 — job "hết giờ" theo kế hoạch không phải là lỗi.
  }

  const ok = await runCycle();
  process.exit(ok ? 0 : 1);
}

main();
