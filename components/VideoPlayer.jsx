import { useEffect, useRef, useState } from 'react';

/**
 * FIX "nhiều trận flv/hls không xem được": trước đây nút ▶
 * trỏ THẲNG vào link .m3u8/.flv thô (playUrl) và mở bằng target="_blank" —
 * đó là link DỮ LIỆU STREAM, không phải trang xem, nên trình duyệt chỉ tải
 * xuống hoặc hiện trang trắng chứ không phát được (trình duyệt không tự
 * giải mã HLS trừ Safari, và KHÔNG trình duyệt nào tự phát được FLV).
 * Component này dùng hls.js để phát .m3u8 và flv.js để phát .flv ngay
 * trong thẻ <video>, đúng cách 1 trang xem trực tiếp cần làm.
 *
 * FIX "màn hình đen, không nút bấm, không lỗi gì cả" (26/08/2026): trước
 * đây CHỈ hiện lỗi khi hls.js báo data.fatal === true — lỗi KHÔNG-fatal
 * (hls.js tự thử phục hồi nhưng đôi khi không bao giờ thành công thật) và
 * lỗi từ video.play() (bị trình duyệt chặn autoplay khi mở tab mới — user
 * gesture không được tính là "trong trang đó") đều bị NUỐT ÂM THẦM, người
 * xem chỉ thấy video đen treo mãi không rõ vì sao. Giờ: (1) log MỌI lỗi
 * hls.js/flv.js ra console (kể cả không-fatal) để dễ soi khi có báo lỗi
 * lần sau, (2) đặt hẹn giờ — quá X giây mà chưa có tí dữ liệu nào (chưa
 * bao giờ vào trạng thái "đang phát") thì tự hiện nút "▶ Bấm để phát thủ
 * công" — vừa là lối thoát rõ ràng thay vì treo vô thời hạn, vừa VÔ TÌNH
 * giải quyết luôn trường hợp bị chặn autoplay (bấm nút này CHÍNH LÀ 1 cử
 * chỉ người dùng thật, trình duyệt luôn cho phép phát sau đó).
 */
const STUCK_TIMEOUT_MS = 8000;

export default function VideoPlayer({ url, format }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [stuck, setStuck] = useState(false);
  const [manualStartKey, setManualStartKey] = useState(0);

  useEffect(() => {
    if (!url) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let hls;
    let flvPlayer;
    let cancelled = false;
    let startedPlaying = false;
    setError('');
    setStuck(false);

    const stuckTimer = setTimeout(() => {
      if (!cancelled && !startedPlaying) setStuck(true);
    }, STUCK_TIMEOUT_MS);

    const markPlaying = () => {
      startedPlaying = true;
      setStuck(false);
      clearTimeout(stuckTimer);
    };

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
        flvPlayer.on(flvjs.Events.ERROR, (errType, errDetail) => {
          console.error('[VideoPlayer] flv.js error:', errType, errDetail);
          if (!cancelled) setError('Nguồn FLV này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        });
        video.addEventListener('playing', markPlaying, { once: true });
        flvPlayer.play().catch((err) => {
          console.warn('[VideoPlayer] flv play() bị từ chối (có thể do trình duyệt chặn autoplay):', err?.message);
        });
        return;
      }

      // HLS: Safari/iOS phát .m3u8 gốc, các trình duyệt khác cần hls.js
      const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
      if (nativeHls) {
        video.src = url;
        video.addEventListener('playing', markPlaying, { once: true });
        video.play().catch((err) => {
          console.warn('[VideoPlayer] play() bị từ chối (có thể do trình duyệt chặn autoplay):', err?.message);
        });
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
        // Log MỌI lỗi (kể cả không-fatal) — hls.js tự thử phục hồi lỗi
        // không-fatal nhưng không phải lúc nào cũng thành công; trước đây
        // các lỗi này hoàn toàn im lặng, không có manh mối gì để chẩn đoán.
        console.error('[VideoPlayer] hls.js error:', data?.type, data?.details, 'fatal=', data?.fatal);
        if (data?.fatal && !cancelled) {
          setError('Nguồn này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        }
      });
      video.addEventListener('playing', markPlaying, { once: true });
      video.play().catch((err) => {
        console.warn('[VideoPlayer] play() bị từ chối (có thể do trình duyệt chặn autoplay):', err?.message);
      });
    }

    setup().catch((err) => {
      console.error('[VideoPlayer] setup() lỗi:', err);
      if (!cancelled) setError('Có lỗi khi khởi tạo trình phát — thử tải lại trang.');
    });

    return () => {
      cancelled = true;
      clearTimeout(stuckTimer);
      video.removeEventListener('playing', markPlaying);
      if (hls) hls.destroy();
      if (flvPlayer) {
        flvPlayer.pause();
        flvPlayer.unload();
        flvPlayer.detachMediaElement();
        flvPlayer.destroy();
      }
    };
  }, [url, format, manualStartKey]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        controls
        autoPlay
        playsInline
        className="h-full w-full"
      />
      {stuck && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 px-6 text-center text-sm text-white">
          <p>Chưa tự phát được — trình duyệt có thể đang chặn tự động phát.</p>
          <button
            type="button"
            onClick={() => {
              const video = videoRef.current;
              if (video) video.play().catch(() => {});
              setStuck(false);
              setManualStartKey((k) => k + 1);
            }}
            className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90"
          >
            ▶ Bấm để phát
          </button>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 px-6 text-center text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
