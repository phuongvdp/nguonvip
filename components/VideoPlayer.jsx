import { useEffect, useRef, useState } from 'react';

/**
 * FIX "nguồn xoilac: nhiều trận flv/hls không xem được": trước đây nút ▶
 * trỏ THẲNG vào link .m3u8/.flv thô (playUrl) và mở bằng target="_blank" —
 * đó là link DỮ LIỆU STREAM, không phải trang xem, nên trình duyệt chỉ tải
 * xuống hoặc hiện trang trắng chứ không phát được (trình duyệt không tự
 * giải mã HLS trừ Safari, và KHÔNG trình duyệt nào tự phát được FLV).
 * Component này dùng hls.js để phát .m3u8 và flv.js để phát .flv ngay
 * trong thẻ <video>, đúng cách 1 trang xem trực tiếp cần làm.
 */
export default function VideoPlayer({ url, format }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let hls;
    let flvPlayer;
    let cancelled = false;
    setError('');

    async function setup() {
      const isFlv = format === 'flv' || /\.flv(\?|$)/i.test(url);

      if (isFlv) {
        const mod = await import('flv.js');
        const flvjs = mod.default || mod;
        if (cancelled) return;
        if (!flvjs.isSupported()) {
          setError('Trình duyệt này không hỗ trợ phát FLV — thử Chrome/Edge trên máy tính, hoặc dùng link trong VLC.');
          return;
        }
        flvPlayer = flvjs.createPlayer({ type: 'flv', url, isLive: true, hasAudio: true, hasVideo: true });
        flvPlayer.attachMediaElement(video);
        flvPlayer.load();
        flvPlayer.on(flvjs.Events.ERROR, () => {
          if (!cancelled) setError('Nguồn FLV này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        });
        flvPlayer.play().catch(() => {});
        return;
      }

      // HLS: Safari/iOS phát .m3u8 gốc, các trình duyệt khác cần hls.js
      const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
      if (nativeHls) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }

      const mod = await import('hls.js');
      const Hls = mod.default || mod;
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError('Trình duyệt này không hỗ trợ phát HLS — thử trình duyệt khác, hoặc dùng link trong VLC.');
        return;
      }
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data?.fatal && !cancelled) {
          setError('Nguồn này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        }
      });
      video.play().catch(() => {});
    }

    setup();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      if (flvPlayer) {
        flvPlayer.pause();
        flvPlayer.unload();
        flvPlayer.detachMediaElement();
        flvPlayer.destroy();
      }
    };
  }, [url, format]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        className="h-full w-full"
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 px-6 text-center text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
