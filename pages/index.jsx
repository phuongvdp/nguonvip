import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  SPORT_TABS,
  SOURCE_TOGGLE_LIST,
  loadEnabledSources,
  saveEnabledSources,
  isSourceEnabled,
  getSourceKey,
  getSourceLabel,
  getSourceShortLabel,
  formatMatchTime
} from '@/src/utils/playerGet';
import { cn } from '@/lib/utils';

const VIEW_MODE_STORAGE_KEY = 'player-get:view-mode:v1';

function loadViewMode() {
  if (typeof window === 'undefined') return 'grid';
  try {
    return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function saveViewMode(mode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage có thể bị chặn — bỏ qua, không critical.
  }
}

function PlaylistLink() {
  const [url, setUrl] = useState('/playlist.m3u?refresh=1');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUrl(`${window.location.origin}/playlist.m3u?refresh=1`);
    }
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (http, older browsers) — người dùng
      // vẫn có thể tự bôi đen ô input và Ctrl+C.
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <span className="whitespace-nowrap text-muted-foreground">Link playlist (dán vào VLC/app IPTV):</span>
      <input
        type="text"
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
      />
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
      >
        {copied ? 'Đã copy ✓' : 'Copy'}
      </button>
    </div>
  );
}

// Thời điểm GitHub Actions kiểm tra kế tiếp
// (.github/workflows/validate-and-generate.yml, cron "*/15 * * * *" — chạy
// theo giờ UTC, tức mỗi khi phút UTC chạm mốc 00/15/30/45). Đây là lịch
// KIỂM TRA cố định, không phải lịch làm mới thật — script bên trong tự
// quyết định có làm mới thật hay không: đang có trận live thì làm mới đúng
// 15 phút/lần, không có trận live thì tự giãn ra dần (tối đa 2 tiếng) để
// đỡ tốn tài nguyên, nên thời gian làm mới thật có thể lâu hơn số hiện ở
// đây.
function nextCronRunUtc(intervalMinutes = 15) {
  const next = new Date();
  next.setUTCSeconds(0, 0);
  const utcMinutes = next.getUTCMinutes();
  const add = intervalMinutes - (utcMinutes % intervalMinutes);
  next.setUTCMinutes(utcMinutes + add);
  return next;
}

function AutoGenerateNote() {
  const [label, setLabel] = useState('');

  useEffect(() => {
    function update() {
      const next = nextCronRunUtc(15);
      const diffMin = Math.max(0, Math.ceil((next.getTime() - Date.now()) / 60000));
      setLabel(diffMin <= 1 ? '~1 phút nữa' : `~${diffMin} phút nữa`);
    }
    update();
    const timer = setInterval(update, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <p className="px-1 text-xs text-muted-foreground">
      File playlist tĩnh (<code className="font-mono">public/playlists/</code>) được GitHub Actions kiểm tra mỗi 15
      phút — lần kiểm tra kế tiếp {label || '…'} (giờ UTC, có thể trễ vài phút do hàng đợi của GitHub). Đang có trận
      live thì làm mới đúng chu kỳ đó; im ắng thì tự giãn ra dần (tối đa 2 tiếng) để đỡ tốn tài nguyên.
    </p>
  );
}

function StatusBar({ generatedAt, count, onRefresh, refreshing }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <div>
        {count} trận đang phát
        {generatedAt ? ` · cập nhật lúc ${new Date(generatedAt).toLocaleTimeString('vi-VN')}` : ''}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="rounded-md border border-border px-3 py-1 hover:bg-accent disabled:opacity-50"
      >
        {refreshing ? 'Đang làm mới…' : 'Làm mới'}
      </button>
    </div>
  );
}

function SourceToggles({ enabledSources, onToggle, healthStatus }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-foreground">Bật/Tắt Nguồn</h3>
        <button
          type="button"
          onClick={() => setShowDetail(!showDetail)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDetail ? '▼' : '▶'} Chi tiết
        </button>
      </div>

      {!showDetail ? (
        // Compact mode - just toggles
        <div className="flex flex-wrap gap-2">
          {SOURCE_TOGGLE_LIST.map((s) => {
            const on = enabledSources[s.key] !== false;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onToggle(s.key)}
                className={cn(
                  'rounded-md border px-4 py-2.5 text-sm font-medium transition-all hover:shadow-md',
                  on
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-muted text-muted-foreground hover:bg-accent'
                )}
                aria-pressed={on}
              >
                {on ? '✓' : '○'} {s.label}
              </button>
            );
          })}
        </div>
      ) : (
        // Detailed mode - with domain and health info
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          {SOURCE_TOGGLE_LIST.map((s) => {
            const on = enabledSources[s.key] !== false;
            const health = healthStatus?.[s.key];
            const isHealthy = health?.ok && health?.live > 0;
            const hasDomain = !!health?.domain;

            return (
              <div
                key={s.key}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3 py-2 transition-all',
                  on
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-muted/30'
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onToggle(s.key)}
                      className={cn(
                        'shrink-0 h-5 w-5 rounded border transition-colors',
                        on
                          ? 'border-primary bg-primary text-primary-foreground flex items-center justify-center'
                          : 'border-border bg-muted hover:bg-accent'
                      )}
                    >
                      {on && '✓'}
                    </button>
                    <span className={cn('font-medium text-sm', on ? 'text-foreground' : 'text-muted-foreground')}>
                      {s.label}
                    </span>
                    {isHealthy && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        🟢 Sống ({health.live} trận)
                      </span>
                    )}
                    {health?.ok === false && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        🔴 Chết
                      </span>
                    )}
                    {health?.ok && health?.live === 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                        🟡 Nghi ngờ
                      </span>
                    )}
                  </div>
                  {hasDomain && (
                    <div className="text-xs text-muted-foreground mt-1 ml-7 truncate">
                      {health.domain}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ViewModeToggle({ mode, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {[
        { id: 'grid', label: '▦ Lưới' },
        { id: 'list', label: '☰ Danh sách' }
      ].map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            mode === opt.id
              ? 'bg-secondary text-secondary-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent'
          )}
          aria-pressed={mode === opt.id}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const SOURCE_META = {
  xoilac: { color: '#4ECDC4', icon: '📺' },
  phaohoa: { color: '#FF6B6B', icon: '🎆' },
  gavang: { color: '#FBBF24', icon: '🐔' },
  '90phut': { color: '#56CFE1', icon: '⏱️' },
  'xoilac-affcup': { color: '#FFD93D', icon: '🏆' },
  vsc9: { color: '#22C55E', icon: '⚽' },
  giovang: { color: '#F5B301', icon: '🥇' },
  custom: { color: '#95E1D3', icon: '🔗' }
};

function TeamLogo({ name, logo, small = false }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const sizeClass = small ? 'h-6 w-6 text-xs' : 'h-10 w-10 text-sm';

  if (!logo || broken) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground', sizeClass)}>
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={name || ''}
      onError={() => setBroken(true)}
      className={cn('shrink-0 rounded-full bg-muted object-contain', sizeClass)}
      loading="lazy"
    />
  );
}

function MatchCard({ match }) {
  const meta = SOURCE_META[match.source] || SOURCE_META.custom;
  const isLive = !!match.status?.isLive;

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={{ borderLeft: `3px solid ${meta.color}` }}
    >
      <div className="flex items-center justify-between px-4 pt-3 text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span>{meta.icon}</span>
          {getSourceShortLabel(match.source)}
        </span>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-muted-foreground">{formatMatchTime(match) || 'Sắp diễn ra'}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
              LIVE
            </span>
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            {formatMatchTime(match) || 'Sắp diễn ra'}
          </span>
        )}
      </div>

      {match.competition?.name && (
        <div className="truncate px-4 pt-2 text-xs text-muted-foreground">{match.competition.name}</div>
      )}

      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
          <TeamLogo name={match.homeTeam?.name} logo={match.homeTeam?.logo} />
          <span className="line-clamp-2 text-xs font-medium leading-tight">{match.homeTeam?.name || 'Home'}</span>
        </div>
        <div className="shrink-0 px-1 text-xs font-semibold text-muted-foreground">
          VS
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
          <TeamLogo name={match.awayTeam?.name} logo={match.awayTeam?.logo} />
          <span className="line-clamp-2 text-xs font-medium leading-tight">{match.awayTeam?.name || 'Away'}</span>
        </div>
      </div>

      {!!match.streams?.length && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2.5">
          {match.streams.map((s, i) => (
            <a
              key={`${s.playUrl}-${i}`}
              href={s.playUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent"
            >
              ▶ {s.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchListRow({ match }) {
  const meta = SOURCE_META[match.source] || SOURCE_META.custom;
  const isLive = !!match.status?.isLive;

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
      style={{ borderLeft: `3px solid ${meta.color}` }}
    >
      <div className="w-24 shrink-0 text-xs">
        {isLive ? (
          <span className="flex flex-col items-start gap-0.5">
            <span className="text-muted-foreground">{formatMatchTime(match) || 'Sắp diễn ra'}</span>
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
              LIVE
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{formatMatchTime(match) || 'Sắp diễn ra'}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TeamLogo name={match.homeTeam?.name} logo={match.homeTeam?.logo} small />
        <span className="truncate text-sm font-medium">{match.homeTeam?.name || 'Home'}</span>
        <span className="shrink-0 text-xs text-muted-foreground">vs</span>
        <span className="truncate text-sm font-medium">{match.awayTeam?.name || 'Away'}</span>
        <TeamLogo name={match.awayTeam?.name} logo={match.awayTeam?.logo} small />
      </div>

      {match.competition?.name && (
        <span className="hidden max-w-[160px] shrink-0 truncate text-xs text-muted-foreground md:block">
          {match.competition.name}
        </span>
      )}

      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        {meta.icon} {getSourceShortLabel(match.source)}
      </span>

      <div className="flex shrink-0 flex-wrap gap-1.5">
        {(match.streams || []).map((s, i) => (
          <a
            key={`${s.playUrl}-${i}`}
            href={s.playUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
          >
            ▶ {s.name}
          </a>
        ))}
      </div>
    </div>
  );
}

function SourceGroupHeader({ source, count }) {
  const meta = SOURCE_META[source] || SOURCE_META.custom;
  return (
    <div className="flex items-center gap-2 border-b border-border pb-2">
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs"
        style={{ backgroundColor: `${meta.color}33` }}
      >
        {meta.icon}
      </span>
      <h2 className="text-sm font-semibold text-foreground">{getSourceLabel(source)}</h2>
      <span className="text-xs text-muted-foreground">({count} trận)</span>
    </div>
  );
}

export default function Home() {
  const [enabledSources, setEnabledSources] = useState(() => loadEnabledSources());
  const [viewMode, setViewMode] = useState(() => loadViewMode());
  const [activeSport, setActiveSport] = useState('all');
  const [matches, setMatches] = useState([]);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [healthStatus, setHealthStatus] = useState({});
  const [checkingHealth, setCheckingHealth] = useState(false);

  const fetchMatches = useCallback(async (opts = {}) => {
    const { refresh } = opts;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ sport: activeSport });
      if (refresh) qs.set('refresh', '1');
      const res = await fetch(`/api/matches?${qs.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Không tải được danh sách trận');
      setMatches(json.matches || []);
      setGeneratedAt(json.generatedAt);
    } catch (err) {
      setError(err.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeSport]);

  const fetchHealthStatus = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const res = await fetch('/api/sources/health');
      const json = await res.json();
      if (json.success && json.sources) {
        setHealthStatus(json.sources);
      }
    } catch (err) {
      console.error('Error fetching health status:', err);
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  useEffect(() => {
    fetchMatches();
    const timer = setInterval(() => fetchMatches(), 60000);
    return () => clearInterval(timer);
  }, [fetchMatches]);

  const toggleSource = (key) => {
    setEnabledSources((prev) => {
      const next = { ...prev, [key]: prev[key] === false ? true : false };
      saveEnabledSources(next);
      return next;
    });
  };

  const changeViewMode = (mode) => {
    setViewMode(mode);
    saveViewMode(mode);
  };

  const visibleMatches = useMemo(
    // /api/matches (qua playlistBuilder.service.js:sortPlayable) đã trả về
    // đúng thứ tự thời gian toàn cục — CHỈ lọc theo nguồn đang bật, KHÔNG
    // gom nhóm lại theo nguồn ở đây nữa, để không phá vỡ thứ tự ngày/giờ
    // chung của cả trang (gom theo nguồn từng khiến trận ở khối nguồn A
    // hiện trước trận sớm hơn ở khối nguồn B, nhìn như bị lộn ngày).
    () => matches.filter((m) => isSourceEnabled(m, enabledSources)),
    [matches, enabledSources]
  );
  const visibleCount = visibleMatches.length;

  // FIX: người dùng muốn khi bật NHIỀU nguồn cùng lúc, mỗi nguồn hiển thị
  // thành 1 khối riêng — không muốn trận của các nguồn khác nhau xen kẽ
  // lẫn lộn theo thời gian như trước (xem comment ở visibleMatches). Gom
  // nhóm CHỈ ở bước hiển thị (giữ nguyên thứ tự thời gian trong từng
  // khối, vì visibleMatches đã sort theo giờ toàn cục — filter theo nguồn
  // không làm mất thứ tự đó); playlist .m3u (dùng cho VLC/IPTV) không đụng
  // tới, vẫn phẳng theo thời gian như cũ.
  const groupedMatches = useMemo(() => {
    const order = SOURCE_TOGGLE_LIST.map((s) => s.key);
    const groups = new Map();
    for (const m of visibleMatches) {
      const key = getSourceKey(m);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    });
  }, [visibleMatches]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container py-6 space-y-4">
          <div>
            <h1 className="text-2xl font-bold">Nguồn Thể Thao VIP</h1>
            <p className="mt-1 text-muted-foreground">
              Danh sách trận trực tiếp tổng hợp từ nhiều nguồn — bật/tắt nguồn tuỳ ý.
            </p>
          </div>

          <PlaylistLink />
          <AutoGenerateNote />

          <StatusBar
            generatedAt={generatedAt}
            count={visibleCount}
            onRefresh={() => fetchMatches({ refresh: true })}
            refreshing={refreshing}
          />

          <SourceToggles enabledSources={enabledSources} onToggle={toggleSource} healthStatus={healthStatus} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {SPORT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSport(tab.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm',
                    activeSport === tab.id
                      ? 'bg-secondary text-secondary-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchHealthStatus()}
                disabled={checkingHealth}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {checkingHealth ? '🔄 Kiểm tra...' : '🔍 Sức khỏe'}
              </button>
              <ViewModeToggle mode={viewMode} onChange={changeViewMode} />
            </div>
          </div>
        </div>
      </header>

      <section className="container py-8 space-y-8">
        {loading && <p className="text-muted-foreground">Đang tải danh sách trận…</p>}
        {!loading && error && <p className="text-destructive">{error}</p>}
        {!loading && !error && visibleCount === 0 && (
          <p className="text-muted-foreground">Không có trận nào đang phát (hoặc tất cả nguồn đang bị tắt).</p>
        )}

        {viewMode === 'list' ? (
          <div className="space-y-6">
            {groupedMatches.map(([source, list]) => (
              <div key={source} className="space-y-2">
                <SourceGroupHeader source={source} count={list.length} />
                <div className="space-y-2">
                  {list.map((m) => (
                    <MatchListRow key={m.matchId} match={m} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {groupedMatches.map(([source, list]) => (
              <div key={source} className="space-y-3">
                <SourceGroupHeader source={source} count={list.length} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((m) => (
                    <MatchCard key={m.matchId} match={m} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
