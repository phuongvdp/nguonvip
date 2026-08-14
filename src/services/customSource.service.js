const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { analyzeSourceLink } = require('../utils/genericExtractor');

// ✅ GIẢI PHÁP: Sử dụng /tmp cho Lambda/Vercel, hoặc thư mục local nếu có quyền ghi
// Ưu tiên: /tmp (Vercel/Lambda) → process.cwd()/data (local) → memory
const getDataDir = () => {
  // Nếu trên Vercel/Lambda, sử dụng /tmp
  if (process.env.VERCEL || process.env.LAMBDA_TASK_ROOT) {
    return '/tmp/custom-sources';
  }
  // Nếu có path tùy chỉnh từ env
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  // Mặc định: thư mục data local
  return path.join(process.cwd(), 'data');
};

// In-memory store khi không thể ghi file
let memoryStore = null;

const DATA_DIR = getDataDir();
const DATA_FILE = path.join(DATA_DIR, 'custom-sources.json');

function ensureStore() {
  try {
    // Kiểm tra xem có thể ghi không
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ sources: [] }, null, 2));
    }
    return true;
  } catch (err) {
    console.warn('⚠️ Không thể ghi file:', err.message);
    console.warn('💾 Sử dụng in-memory store. Dữ liệu sẽ mất sau deployment.');
    return false;
  }
}

function readStore() {
  // Nếu không thể ghi file, sử dụng memory
  const canWrite = ensureStore();
  
  if (!canWrite && memoryStore) {
    return memoryStore;
  }

  try {
    if (canWrite) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!Array.isArray(raw.sources)) raw.sources = [];
      memoryStore = raw; // Cache trong memory
      return raw;
    }
  } catch (err) {
    console.warn('Lỗi đọc file:', err.message);
  }

  // Fallback: kiểm tra env variable (định dạng JSON)
  if (process.env.CUSTOM_SOURCES_JSON) {
    try {
      const parsed = JSON.parse(process.env.CUSTOM_SOURCES_JSON);
      if (Array.isArray(parsed.sources)) {
        memoryStore = parsed;
        return parsed;
      }
    } catch {
      // ignore
    }
  }

  // Fallback cuối cùng
  memoryStore = { sources: [] };
  return memoryStore;
}

function writeStore(store) {
  const canWrite = ensureStore();
  
  if (canWrite) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
      memoryStore = store;
      return true;
    } catch (err) {
      console.warn('⚠️ Không thể ghi file:', err.message);
      memoryStore = store;
      return false;
    }
  } else {
    console.warn('⚠️ Hệ thống file là read-only. Dữ liệu chỉ lưu trong memory.');
    console.warn('📌 Để khắc phục vĩnh viễn:');
    console.warn('   1. Sử dụng MongoDB: MONGODB_URI=...');
    console.warn('   2. Hoặc set CUSTOM_SOURCES_JSON trong environment');
    memoryStore = store;
    return false;
  }
}

function slugify(str) {
  const base = String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'nguon';
}

function shortHash(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 10);
}

class CustomSourceService {
  list() {
    return readStore().sources;
  }

  get(id) {
    return readStore().sources.find((s) => s.id === id) || null;
  }

  /** Dry-run analysis of a batch of links — used for the "preview" step in the UI. */
  async analyze(urls) {
    const list = [...new Set((urls || []).map((u) => String(u).trim()).filter(Boolean))];
    const results = [];
    for (const url of list) {
      // Sequential on purpose — gentle with unknown third-party sites.
      // eslint-disable-next-line no-await-in-loop
      results.push(await analyzeSourceLink(url));
    }
    return results;
  }

  /** Analyze + persist a new source made of whichever sample links resolved OK. */
  async addSource({ name, urls }) {
    const analyzed = await this.analyze(urls);
    const ok = analyzed.filter((r) => r.ok);
    if (!ok.length) {
      return { error: 'Không phân tích được link nào. Kiểm tra lại URL hoặc thử link khác cùng nguồn.', analyzed };
    }

    let domain = '';
    try {
      domain = new URL(ok[0].url).hostname.replace(/^www\./, '');
    } catch {
      // ignore
    }

    const store = readStore();
    const sourceName = (name || domain || 'Nguồn mới').trim();
    const id = `${slugify(sourceName)}-${shortHash(sourceName + Date.now())}`;

    const source = {
      id,
      name: sourceName,
      domain,
      createdAt: new Date().toISOString(),
      links: ok.map((r) => ({ url: r.url, addedAt: new Date().toISOString() }))
    };

    store.sources.push(source);
    writeStore(store);
    return { source, analyzed };
  }

  /** Analyze + append more sample links to an already-saved source. */
  async addLinks(id, urls) {
    const store = readStore();
    const source = store.sources.find((s) => s.id === id);
    if (!source) return { error: 'Không tìm thấy nguồn.' };

    const analyzed = await this.analyze(urls);
    const ok = analyzed.filter((r) => r.ok);
    const existing = new Set(source.links.map((l) => l.url));
    ok.forEach((r) => {
      if (!existing.has(r.url)) {
        source.links.push({ url: r.url, addedAt: new Date().toISOString() });
      }
    });

    writeStore(store);
    return { source, analyzed };
  }

  removeSource(id) {
    const store = readStore();
    const before = store.sources.length;
    store.sources = store.sources.filter((s) => s.id !== id);
    writeStore(store);
    return store.sources.length < before;
  }

  removeLink(id, url) {
    const store = readStore();
    const source = store.sources.find((s) => s.id === id);
    if (!source) return false;
    const before = source.links.length;
    source.links = source.links.filter((l) => l.url !== url);
    writeStore(store);
    return source.links.length < before;
  }

  /**
   * Re-scrape every saved link across all custom sources right now and
   * return matches in the same shape the rest of the aggregator expects
   * (already carries `streams`, so the UI/player never needs to "resolve"
   * a custom-source match separately).
   */
  async getLiveMatches() {
    const sources = this.list();
    const matches = [];

    for (const source of sources) {
      for (const link of source.links) {
        // eslint-disable-next-line no-await-in-loop
        const r = await analyzeSourceLink(link.url);
        if (!r.ok || !r.streamUrls.length) continue;

        const streamUrl = r.streamUrls[0];
        const isFlv = /\.flv(\?|$)/i.test(streamUrl);
        const title = r.homeTeam && r.awayTeam ? '' : (r.title || source.name);

        matches.push({
          matchId: `custom:${source.id}:${shortHash(link.url)}`,
          title: title || undefined,
          homeTeam: { name: r.homeTeam || title || source.name, logo: r.logo || '' },
          awayTeam: { name: r.awayTeam || '', logo: '' },
          sport: 'football',
          matchTimeTimestamp: Math.floor(Date.now() / 1000),
          status: { isLive: true },
          stream: { liveUrl: link.url },
          streams: [
            {
              name: source.name,
              streamerName: source.name,
              m3u8Url: isFlv ? '' : streamUrl,
              flvUrl: isFlv ? streamUrl : '',
              link: streamUrl
            }
          ],
          source: source.id,
          sportCategory: 'football',
          sourceLabel: source.name
        });
      }
    }

    return matches;
  }
}

module.exports = new CustomSourceService();
