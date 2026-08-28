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
 * đây CHỈ hiện lỗi khi hls.js báo data.fatal === true — lỗi KHÔNG-fatal và
 * lỗi từ video.play() (bị trình duyệt chặn autoplay) đều bị NUỐT ÂM THẦM.
 * Thêm log đầy đủ + nút "▶ Bấm để phát" thủ công sau 8 giây treo.
 *
 * FIX "nút bấm bị ẩn" (27/08/2026, lần 1): video THỰC RA đã tải xong, chỉ
 * bị chặn autoplay nên dừng ở trạng thái tạm dừng — nút ▶ MẶC ĐỊNH của
 * trình duyệt quá nhỏ, dễ tưởng là "ẩn". Cho hiện NGAY nút to giữa màn
 * hình khi video.play() bị từ chối, không cần đợi 8 giây.
 *
 * FIX "pháo hoa: bấm nút ▶ thì nút BIẾN MẤT" (27/08/2026, lần 2): bug ở
 * `manualStartKey` — bấm nút vừa gọi play() vừa tăng key để "buộc" effect
 * chạy lại, khiến TOÀN BỘ player bị HỦY và TẠO LẠI TỪ ĐẦU ngay sau khi vừa
 * play() thành công. Đã bỏ hẳn manualStartKey, nút giờ chỉ gọi play() trên
 * player đang có sẵn, không rebuild.
 *
 * FIX "vẫn bị y hệt, nút play vẫn ẩn" (27/08/2026, lần 3 — NGUYÊN NHÂN GỐC
 * THỰC SỰ): sự kiện 'playing' trước giờ chỉ được lắng nghe ĐÚNG MỘT LẦN
 * (`{ once: true }`), và cờ `startedPlaying` một khi đã true thì KHÔNG BAO
 * GIỜ được đặt lại false. Hệ quả: video phát được một đoạn đầu (nút ẩn đi,
 * đúng như mong đợi) — nhưng nguồn pháo hoa/live free rất hay bị đứt giữa
 * chừng (mất kết nối CDN, token hết hạn, buffer treo...). Khi đó video tự
 * dừng lại, nhưng vì `startedPlaying` đã là true nên KHÔNG có bất kỳ đoạn
 * code nào set `stuck = true` lại được nữa — nút biến mất vĩnh viễn, màn
 * hình đen treo, không cách nào bấm lại. Đây chính là gốc rễ khiến các bản
 * fix trước (chỉ sửa lần bấm nút đầu tiên) không giải quyết được vấn đề.
 *
 * Sửa triệt để: bỏ hẳn cờ `startedPlaying` một-lần, chuyển sang theo dõi
 * LIÊN TỤC trạng thái phát của thẻ <video> trong suốt vòng đời component:
 *   - 'playing'  -> video CÓ dữ liệu và đang chạy thật -> ẩn nút
 *   - 'pause' / 'waiting' / 'stalled' / 'error' (video, không phải hls.js/
 *     flv.js) -> đặt lại đồng hồ đếm 8 giây; nếu sau 8 giây vẫn chưa quay
 *     lại trạng thái 'playing' thì hiện nút ▶ lại — bất kể trước đó đã
 *     từng phát qua hay chưa, và bất kể là do chặn autoplay, mất mạng, hay
 *     nguồn tự ngắt giữa chừng.
 * Nhờ vậy nút ▶ sẽ hiện lại BẤT CỨ LÚC NÀO stream bị gián đoạn quá 8 giây,
 * không chỉ ở lần đầu tiên.
 */
const STUCK_TIMEOUT_MS = 8000;

export default function VideoPlayer({ url, format }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null); // { play: () => Promise } — điều khiển player đang hoạt động (video hoặc flvPlayer)
  const [error, setError] = useState('');
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!url) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let hls;
    let flvPlayer;
    let cancelled = false;
    let watchdogTimer = null;
    setError('');
    setStuck(false);

    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    // Đặt lại đồng hồ đếm 8 giây mỗi khi video dừng/đứng hình vì bất kỳ lý
    // do gì. Nếu trong 8 giây đó video không tự phục hồi (không có sự kiện
    // 'playing' nào xảy ra để hủy đồng hồ này), hiện nút ▶ để người xem
    // bấm lại thủ công.
    const scheduleWatchdog = () => {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        if (!cancelled) setStuck(true);
      }, STUCK_TIMEOUT_MS);
    };

    const handlePlaying = () => {
      if (cancelled) return;
      setStuck(false);
      clearWatchdog();
    };
    const handleStall = () => {
      if (cancelled) return;
      scheduleWatchdog();
    };

    // Theo dõi LIÊN TỤC trong suốt vòng đời player (không phải { once: true })
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handleStall);
    video.addEventListener('waiting', handleStall);
    video.addEventListener('stalled', handleStall);
    video.addEventListener('error', handleStall);

    scheduleWatchdog(); // đếm ngay từ lúc mount / mỗi khi đổi nguồn (url/format)

    // Gọi CHUNG cho cả 3 nhánh phát (flv.js/native HLS/hls.js) — nếu
    // video.play() bị trình duyệt TỪ CHỐI (autoplay policy), hiện NGAY nút
    // "▶ Bấm để phát" to giữa màn hình thay vì đợi watchdog 8 giây.
    const tryAutoplay = (playFn) => {
      const result = playFn();
      if (result?.catch) {
        result.catch((err) => {
          console.warn('[VideoPlayer] play() bị từ chối (trình duyệt chặn autoplay):', err?.message);
          if (!cancelled) setStuck(true);
        });
      }
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
          if (!cancelled) {
            // Lỗi từ flv.js (mất kết nối, nguồn die...) — không hiện error
            // chặn cứng ngay, cho watchdog cơ hội hiện lại nút ▶ trước
            // (nhiều nguồn tự nối lại được sau vài giây).
            scheduleWatchdog();
          }
        });
        playerRef.current = { play: () => flvPlayer.play() };
        tryAutoplay(() => flvPlayer.play());
        return;
      }

      // HLS: Safari/iOS phát .m3u8 gốc, các trình duyệt khác cần hls.js
      const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
      if (nativeHls) {
        video.src = url;
        playerRef.current = { play: () => video.play() };
        tryAutoplay(() => video.play());
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
        // không-fatal nhưng không phải lúc nào cũng thành công.
        console.error('[VideoPlayer] hls.js error:', data?.type, data?.details, 'fatal=', data?.fatal);
        if (data?.fatal && !cancelled) {
          setError('Nguồn này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        } else if (!cancelled) {
          // Lỗi không-fatal: hls.js tự retry — cho watchdog cơ hội hiện
          // lại nút ▶ nếu retry không thành công trong 8 giây.
          scheduleWatchdog();
        }
      });
      playerRef.current = { play: () => video.play() };
      tryAutoplay(() => video.play());
    }

    setup().catch((err) => {
      console.error('[VideoPlayer] setup() lỗi:', err);
      if (!cancelled) setError('Có lỗi khi khởi tạo trình phát — thử tải lại trang.');
    });

    return () => {
      cancelled = true;
      clearWatchdog();
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handleStall);
      video.removeEventListener('waiting', handleStall);
      video.removeEventListener('stalled', handleStall);
      video.removeEventListener('error', handleStall);
      playerRef.current = null;
      if (hls) hls.destroy();
      if (flvPlayer) {
        flvPlayer.pause();
        flvPlayer.unload();
        flvPlayer.detachMediaElement();
        flvPlayer.destroy();
      }
    };
    // Chỉ rebuild player khi URL/format thực sự đổi (đổi trận/đổi server) —
    // KHÔNG rebuild chỉ vì bấm nút "play thủ công" (xem nút ▶ bên dưới).
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
      {stuck && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center text-sm text-white">
          <p>Trình duyệt đang chặn tự động phát / luồng bị gián đoạn.</p>
          <button
            type="button"
            onClick={() => {
              const player = playerRef.current;
              if (!player) return;
              // Chỉ gọi play() trên player đang có sẵn — KHÔNG rebuild lại
              // player. 'playing' event sẽ tự ẩn nút khi thực sự phát được.
              player.play().catch((err) => {
                console.warn('[VideoPlayer] Bấm play thủ công vẫn bị trình duyệt từ chối:', err?.message);
              });
            }}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg hover:opacity-90"
            aria-label="Bấm để phát"
          >
            ▶
          </button>
          <p className="text-xs text-white/70">Bấm nút ▶ ở trên để bắt đầu/tiếp tục xem</p>
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
