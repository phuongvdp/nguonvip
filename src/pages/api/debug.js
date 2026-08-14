import crawlerService from '@/src/services/crawler.service';
import phaohoaService from '@/src/services/phaohoa.service';
import xoilacService from '@/src/services/xoilac.service';
import xoilacAffcupService from '@/src/services/xoilacAffcup.service';
import ninetyService from '@/src/services/ninety.service';
import { buildAggregatedMatches } from '@/src/services/playlistBuilder.service';

async function testSource(fn) {
  try {
    const res = await fn();
    const list = Array.isArray(res) ? res : (res?.matches || res?.data || []);
    const live = list.filter(m => m?.status?.isLive);
    const sample = live[0];
    return {
      total: list.length,
      live: live.length,
      sample: sample ? {
        matchId: sample.matchId,
        competition: sample.competition?.name,
        hasStreams: !!(sample.streams?.length),
        hasCommentators: !!(sample.commentators?.length),
        streamUrl: (sample.streamUrl || sample.stream?.liveUrl || '').slice(0, 80),
        streams: (sample.streams || []).slice(0, 2).map(s => ({
          m3u8: (s.m3u8Url || '').slice(0, 80),
          flv: (s.flvUrl || '').slice(0, 80),
          play: (s.playUrl || '').slice(0, 80),
        })),
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
    testSource(() => crawlerService.getLiveMatches('football')),
    testSource(() => phaohoaService.getAllMatchesByTab('live', 'all', 50)),
    testSource(() => xoilacService.getMatchesByTab('live', 'football')),
    testSource(() => xoilacAffcupService.getAllMatchesByTab('live', 'football', 50)),
    testSource(() => ninetyService.getAllMatchesByTab('live', 'football')),
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
