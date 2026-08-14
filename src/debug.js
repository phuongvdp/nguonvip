import crawlerService from '@/src/services/crawler.service';
import phaohoaService from '@/src/services/phaohoa.service';
import xoilacService from '@/src/services/xoilac.service';
import xoilacAffcupService from '@/src/services/xoilacAffcup.service';
import ninetyService from '@/src/services/ninety.service';
import { buildAggregatedMatches } from '@/src/services/playlistBuilder.service';
import { normalizeStreamList } from '@/src/utils/playerGet';

async function testSource(label, fn) {
  try {
    const res = await fn();
    const list = Array.isArray(res) ? res : (res?.matches || res?.data || []);
    const live = list.filter(m => m?.status?.isLive);
    // pick first live match and check its streams
    const sample = live[0];
    return {
      total: list.length,
      live: live.length,
      sampleMatch: sample ? {
        matchId: sample.matchId,
        competition: sample.competition?.name,
        hasStreams: !!(sample.streams?.length),
        hasCommentators: !!(sample.commentators?.length),
        streamUrl: sample.streamUrl || sample.stream?.liveUrl || '',
        streams: (sample.streams || []).map(s => ({
          m3u8Url: s.m3u8Url?.slice(0, 60),
          flvUrl: s.flvUrl?.slice(0, 60),
          playUrl: s.playUrl?.slice(0, 60),
        })).slice(0, 2),
      } : null
    };
  } catch (e) {
    return { error: e.message };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');

  const [gavang, phaohoa, xoilac, affcup, ninety] = await Promise.all([
    testSource('gavang', () => crawlerService.getLiveMatches('football')),
    testSource('phaohoa', () => phaohoaService.getAllMatchesByTab('live', 'all', 50)),
    testSource('xoilac', () => xoilacService.getMatchesByTab('live', 'football')),
    testSource('affcup', () => xoilacAffcupService.getAllMatchesByTab('live', 'football', 50)),
    testSource('ninety', () => ninetyService.getAllMatchesByTab('live', 'football')),
  ]);

  let aggregated = {};
  try {
    const all = await buildAggregatedMatches();
    const bySource = {};
    for (const m of all) bySource[m.source] = (bySource[m.source] || 0) + 1;
    aggregated = { total: all.length, bySource };
  } catch (e) {
    aggregated = { error: e.message };
  }

  return res.status(200).json({ gavang, phaohoa, xoilac, affcup, ninety, aggregated });
}
