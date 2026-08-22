import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import Link from 'next/link';

// hls.js/flv.js đụng tới window/MediaSource — chỉ được chạy phía client,
// tắt SSR cho component player để tránh lỗi build/render trên server.
const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), { ssr: false });

export default function WatchPage() {
  const router = useRouter();
  const { url, format, name, home, away } = router.query;
  const streamUrl = typeof url === 'string' ? url : '';

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="h-1.5 bg-turf" />
        <div className="container flex items-center justify-between gap-3 py-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Về danh sách trận
          </Link>
          {(home || away) && (
            <div className="truncate text-sm font-medium">
              {home || 'Home'} <span className="text-muted-foreground">vs</span> {away || 'Away'}
            </div>
          )}
        </div>
      </header>

      <section className="container space-y-4 py-6">
        {!streamUrl ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Thiếu link stream để phát — quay lại danh sách trận và bấm ▶ ở một server khác.
          </div>
        ) : (
          <>
            <VideoPlayer url={streamUrl} format={typeof format === 'string' ? format : ''} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {name ? `Server: ${name} · ` : ''}Không xem được trên trình duyệt? Dán link này vào VLC/app IPTV:
              </span>
              <code className="max-w-full truncate rounded border border-border bg-card px-2 py-1 font-mono">
                {streamUrl}
              </code>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
