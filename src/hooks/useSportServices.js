import { useState, useEffect, useCallback } from 'react';

/**
 * Hook để lấy matches từ một service
 * @param {string} service - 'phaohoa' | 'xoilac' | 'affcup' | '90phut' | 'custom'
 * @param {string} tab - 'live' | 'upcoming' | 'today' | 'hot'
 * @param {number} page - Số trang
 */
export function useMatches(service = 'phaohoa', tab = 'live', page = 1) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState({});

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = service === 'custom'
        ? `/api/sources/live`
        : `/api/${service}/live?tab=${tab}&page=${page}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Status ${response.status}`);

      const result = await response.json();
      if (!result.success) throw new Error(result.message);

      setData(result.data || []);
      setMeta(result.meta || {});
    } catch (err) {
      setError(err.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [service, tab, page]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, meta, refetch: fetch };
}

/**
 * Hook để lấy chi tiết trận và streams
 * @param {string} service - 'phaohoa' | 'xoilac' | 'affcup'
 * @param {string} matchId - ID hoặc slug của trận
 */
export function useMatchDetail(service = 'phaohoa', matchId) {
  const [match, setMatch] = useState(null);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(!!matchId);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    if (!matchId) return;

    setLoading(true);
    setError(null);
    try {
      const url = service === 'custom'
        ? `/api/sources/${matchId}`
        : `/api/${service}/stream?id=${encodeURIComponent(matchId)}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Status ${response.status}`);

      const result = await response.json();
      if (!result.success) throw new Error(result.message);

      setMatch(result.data?.match || null);
      setStreams(result.data?.streams || []);
    } catch (err) {
      setError(err.message);
      setMatch(null);
      setStreams([]);
    } finally {
      setLoading(false);
    }
  }, [service, matchId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { match, streams, loading, error, refetch: fetch };
}

/**
 * Hook để quản lý custom sources
 */
export function useCustomSources() {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Lấy danh sách sources
  const fetchSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/sources/list');
      if (!response.ok) throw new Error(`Status ${response.status}`);

      const result = await response.json();
      if (!result.success) throw new Error(result.message);

      setSources(result.data || []);
    } catch (err) {
      setError(err.message);
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Thêm source mới
  const addSource = useCallback(async (name, urls) => {
    try {
      const response = await fetch('/api/sources/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, urls })
      });

      if (!response.ok) throw new Error(`Status ${response.status}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.message);

      // Refresh sources
      await fetchSources();
      return result.source;
    } catch (err) {
      throw err;
    }
  }, [fetchSources]);

  // Xóa source
  const deleteSource = useCallback(async (sourceId) => {
    try {
      const response = await fetch(`/api/sources/delete?sourceId=${sourceId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error(`Status ${response.status}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.message);

      // Refresh sources
      await fetchSources();
    } catch (err) {
      throw err;
    }
  }, [fetchSources]);

  // Thêm link mới vào source
  const addLink = useCallback(async (sourceId, urls) => {
    try {
      const response = await fetch(`/api/sources/add-links?sourceId=${sourceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });

      if (!response.ok) throw new Error(`Status ${response.status}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.message);

      // Refresh sources
      await fetchSources();
      return result.source;
    } catch (err) {
      throw err;
    }
  }, [fetchSources]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  return {
    sources,
    loading,
    error,
    addSource,
    deleteSource,
    addLink,
    refresh: fetchSources
  };
}

/**
 * Hook để quản lý stream playback
 * @param {Array} streams - Danh sách streams
 */
export function useStreamPlayer(streams = []) {
  const [activeStreamId, setActiveStreamId] = useState(streams[0]?.id || null);
  const [playbackError, setPlaybackError] = useState(null);

  const activeStream = streams.find(s => s.id === activeStreamId) || streams[0];

  const selectStream = useCallback((streamId) => {
    setActiveStreamId(streamId);
    setPlaybackError(null);
  }, []);

  const getPlayUrl = useCallback(() => {
    if (!activeStream) return null;
    return activeStream.m3u8Url || activeStream.flvUrl || activeStream.link;
  }, [activeStream]);

  const getPlayMode = useCallback(() => {
    if (!activeStream) return 'hls';
    if (activeStream.m3u8Url) return 'hls';
    if (activeStream.flvUrl) return 'flv';
    return 'hls';
  }, [activeStream]);

  return {
    activeStream,
    activeStreamId,
    selectStream,
    playUrl: getPlayUrl(),
    playMode: getPlayMode(),
    playbackError,
    setPlaybackError
  };
}

/**
 * Hook để lấy services info
 */
export function useServicesInfo() {
  const [services, setServices] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Import từ config (client-side)
    const SERVICES_CONFIG = {
      phaohoa: {
        name: 'Pháo Hoa',
        slug: 'phaohoa',
        enabled: true,
        icon: 'fa-fire',
        color: '#FF6B6B'
      },
      xoilac: {
        name: 'Xoilac',
        slug: 'xoilac',
        enabled: true,
        icon: 'fa-tv',
        color: '#4ECDC4'
      },
      '90phut': {
        name: '90 Phút TV',
        slug: '90phut',
        baseUrl: 'https://90phutzc.tv',
        type: 'scrape',
        enabled: true,
        icon: 'fa-clock',
        color: '#56CFE1',
      },
      'xoilac-affcup': {
        name: 'AFF Cup 2026',
        slug: 'xoilac-affcup',
        enabled: true,
        icon: 'fa-trophy',
        color: '#FFD93D'
      },
      'custom-sources': {
        name: 'Nguồn Tùy Chỉnh',
        slug: 'custom-sources',
        enabled: true,
        icon: 'fa-link',
        color: '#95E1D3'
      }
    };

    const activeServices = Object.values(SERVICES_CONFIG).filter(s => s.enabled);
    setServices(activeServices);
    setStats({
      total: Object.keys(SERVICES_CONFIG).length,
      enabled: activeServices.length
    });
    setLoading(false);
  }, []);

  return { services, stats, loading };
}

export default {
  useMatches,
  useMatchDetail,
  useCustomSources,
  useStreamPlayer,
  useServicesInfo
};
