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
 * FIX "nút bấm bị ẩn" (27/08/2026 — có ảnh chụp màn hình xác nhận): video
 * THỰC RA đã tải xong (đủ dữ liệu để biết thời lượng "0:00"), chỉ là bị
 * chặn autoplay nên dừng ở trạng thái tạm dừng — nhưng nút ▶ MẶC ĐỊNH của
 * trình duyệt để phát lại chỉ là 1 tam giác nhỏ xíu góc trên-trái, cực dễ
 * bị bỏ qua/tưởng là "ẩn" (đặc biệt nhìn qua ảnh chụp màn hình độ phân giải
 * thấp). Đợi 8 giây mới hiện nút to là quá chậm — giờ hễ video.play() bị
 * trình duyệt TỪ CHỐI (chính là dấu hiệu chặn autoplay) là hiện NGAY LẬP
 * TỨC nút "▶ Bấm để phát" to, rõ, giữa màn hình — không cần đợi.
 *
 * FIX "pháo hoa: bấm nút ▶ thì nút BIẾN MẤT, không xem được" (27/08/2026):
 * bug nằm ở `manualStartKey` — trước đây bấm nút vừa gọi video.play() vừa
 * tăng manualStartKey để "buộc" effect chạy lại. Vì manualStartKey nằm
 * trong dependency của useEffect, việc này khiến TOÀN BỘ player đang phát
 * (hls/flv) bị HỦY và TẠO LẠI TỪ ĐẦU — tức là hủy luôn player vừa mới
 * play() thành công, tải lại luồng từ đầu, rồi tự phát lại lần nữa NGOÀI
 * user-gesture gốc (vì phải đi qua `await import()` bất đồng bộ) nên rất
 * dễ bị trình duyệt chặn autoplay LẦN 2 — trong khi nút đã bị ẩn ngay khi
 * bấm (setStuck(false)) nên có "khoảng trống" không nút, không video, tối
 * đa 8 giây (hoặc lâu hơn nếu luồng tải lại chậm). Giờ bấm nút KHÔNG rebuild
 * lại player nữa — chỉ gọi play() trên player đang có sẵn, và chỉ ẩn nút
 * SAU KHI play() thực sự thành công (không ẩn lạc quan trước).
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

    // Gọi CHUNG cho cả 3 nhánh phát (flv.js/native HLS/hls.js) — nếu
    // video.play() bị trình duyệt TỪ CHỐI (autoplay policy), hiện NGAY nút
    // "▶ Bấm để phát" to giữa màn hình thay vì trông chờ vào nút ▶ nhỏ xíu
    // mặc định của trình duyệt (rất dễ bị bỏ sót) hoặc đợi đủ 8 giây.
    const tryAutoplay = (playFn) => {
      const result = playFn();
      if (result?.catch) {
        result.catch((err) => {
          console.warn('[VideoPlayer] play() bị từ chối (trình duyệt chặn autoplay):', err?.message);
          if (!cancelled && !startedPlaying) setStuck(true);
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
          if (!cancelled) setError('Nguồn FLV này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        });
        video.addEventListener('playing', markPlaying, { once: true });
        playerRef.current = { play: () => flvPlayer.play() };
        tryAutoplay(() => flvPlayer.play());
        return;
      }

      // HLS: Safari/iOS phát .m3u8 gốc, các trình duyệt khác cần hls.js
      const nativeHls = video.canPlayType('application/vnd.apple.mpegurl');
      if (nativeHls) {
        video.src = url;
        video.addEventListener('playing', markPlaying, { once: true });
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
        // không-fatal nhưng không phải lúc nào cũng thành công; trước đây
        // các lỗi này hoàn toàn im lặng, không có manh mối gì để chẩn đoán.
        console.error('[VideoPlayer] hls.js error:', data?.type, data?.details, 'fatal=', data?.fatal);
        if (data?.fatal && !cancelled) {
          setError('Nguồn này hiện không phát được — thử server khác hoặc bấm làm mới trận.');
        }
      });
      video.addEventListener('playing', markPlaying, { once: true });
      playerRef.current = { play: () => video.play() };
      tryAutoplay(() => video.play());
    }

    setup().catch((err) => {
      console.error('[VideoPlayer] setup() lỗi:', err);
      if (!cancelled) setError('Có lỗi khi khởi tạo trình phát — thử tải lại trang.');
    });

    return () => {
      cancelled = true;
      clearTimeout(stuckTimer);
      video.removeEventListener('playing', markPlaying);
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
          <p>Trình duyệt đang chặn tự động phát.</p>
          <button
            type="button"
            onClick={() => {
              const player = playerRef.current;
              if (!player) return;
              // Chỉ ẩn nút SAU KHI play() thực sự thành công — không ẩn
              // lạc quan trước, và KHÔNG rebuild lại player (xem ghi chú
              // FIX "pháo hoa: nút ▶ biến mất" ở đầu file).
              player
                .play()
                .then(() => setStuck(false))
                .catch((err) => {
                  console.warn('[VideoPlayer] Bấm play thủ công vẫn bị trình duyệt từ chối:', err?.message);
                  // giữ nguyên nút để người dùng bấm lại thay vì ẩn mất
                });
            }}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl text-primary-foreground shadow-lg hover:opacity-90"
            aria-label="Bấm để phát"
          >
            ▶
          </button>
          <p className="text-xs text-white/70">Bấm nút ▶ ở trên để bắt đầu xem</p>
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
