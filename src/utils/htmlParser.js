const cheerio = require('cheerio');
const { extractSlugFromUrl, buildMatchSlug } = require('./slug');

function normalizeToMs(raw) {
  const n = parseInt(raw, 10);
  if (!n || Number.isNaN(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Parse Gà Vàng TV HTML containing football match cards.
 * @param {string} htmlString - Raw HTML fragment from update-content-live.json
 * @returns {Array} List of structured matches
 */
function parseMatchCards(htmlString) {
  if (!htmlString) return [];
  const $ = cheerio.load(htmlString);
  const matches = [];

  // Try multiple selectors for match cards (in case HTML structure changes)
  let cards = $('.match-card');
  if (!cards.length) {
    cards = $('[data-match-id]');
  }
  if (!cards.length) {
    cards = $('.bals-match-container, [class*="match"], [class*="card"]').filter((i, el) => {
      const html = $(el).html();
      return html && (html.includes('team') || html.includes('score'));
    }).slice(0, 100);
  }

  cards.each((index, element) => {
    const card = $(element);
    
    // Core attributes - with fallback extraction
    let matchId = card.attr('data-match-id') || card.attr('data-id') || '';
    const matchTimeTimestamp = card.attr('data-match-time') || card.attr('data-time') || '';
    const homeTeamId = card.attr('data-home-team-id') || '';
    const awayTeamId = card.attr('data-away-team-id') || '';
    const competitionId = card.attr('data-competition-id') || '';
    const streamerIdsRaw = card.attr('data-streamer-ids') || '';
    let streamerIds = [];
    try {
      if (streamerIdsRaw) {
        streamerIds = JSON.parse(streamerIdsRaw.replace(/&quot;/g, '"'));
      }
    } catch (e) {
      // Ignore parse error
    }

    // Class names changed more than once upstream; accept explicit state
    // attributes as well so cards stay visible after a markup update.
    const statusAttr = [
      card.attr('data-status'),
      card.attr('data-match-status'),
      card.attr('data-state'),
      card.attr('class')
    ].filter(Boolean).join(' ').toLowerCase();
    let isLive = card.hasClass('bals-live-match') || /(^|\s)(live|playing|in-play)(\s|$)|data-live-match/.test(statusAttr) || statusAttr === '2';
    let isUpcoming = card.hasClass('bals-upcoming-match') || /upcoming|scheduled|not-started|pending/.test(statusAttr) || statusAttr === '1';
    let isFinished = card.hasClass('bals-finished-match') || /finished|ended|full-time|(^|\s)ft(\s|$)/.test(statusAttr) || statusAttr === '3';
    
    // Fallback: check status text content
    const statusText = card.find('.bals-status-name, [class*="status"]').text().toLowerCase() || '';
    if (statusText.includes('live') || statusText.includes('trực tiếp')) isLive = true;
    if (statusText.includes('upcoming') || statusText.includes('sắp')) isUpcoming = true;
    if (statusText.includes('finished') || statusText.includes('kết thúc')) isFinished = true;

    // Details parsing
    const competitionName = card.find('.bals-competition-name').text().trim();
    
    // Find competition logo
    const compLogoImg = card.find('.bals-competition-name').parent().find('img');
    const competitionLogo = compLogoImg.attr('data-src') || compLogoImg.attr('src') || '';

    // Match Time formatted
    const matchTimeEl = card.find('.bals-match-time');
    const timeFormattedText = matchTimeEl.find('.backdrop-blur-\\[50px\\]').text().trim().replace(/\s+/g, ' ') || matchTimeEl.text().trim().replace(/\s+/g, ' ') || '';

    // Teams
    const homeTeamName = card.find('.bals-home-team-name').text().trim();
    const homeTeamImg = card.find('.bals-home-team-name').parent().find('img');
    const homeTeamLogo = homeTeamImg.attr('data-src') || homeTeamImg.attr('src') || '';

    const awayTeamName = card.find('.bals-away-team-name').text().trim();
    const awayTeamImg = card.find('.bals-away-team-name').parent().find('img');
    const awayTeamLogo = awayTeamImg.attr('data-src') || awayTeamImg.attr('src') || '';

    // Scores
    const homeScore = card.find('.bals-home-score').text().trim();
    const awayScore = card.find('.bals-away-score').text().trim();

    // Stats block (HT, Corner, Yellow Card)
    const htScore = card.find('.bals-ht-score').first().text().trim();
    const corners = card.find('.bals-corners').first().text().trim();
    const yellowCards = card.find('.bals-yellow-cards').first().text().trim();

    // Status
    const statusName = card.find('.bals-status-name').first().text().trim();
    const elapsedTime = card.find('.bals-elapsed-time').first().text().trim();

    // Link and Streamer info - with multiple fallback selectors
    let liveLink = card.find('a.absolute.inset-0.z-0').attr('href') || '';
    if (!liveLink) {
      liveLink = card.find('a[href*="truc-tiep"], a[href*="watch"], a[href*="live"]').first().attr('href') || '';
    }
    if (!liveLink) {
      const allLinks = card.find('a[href]');
      for (let i = 0; i < allLinks.length; i++) {
        const href = $(allLinks[i]).attr('href');
        if (href && !href.includes('logo') && !href.includes('avatar')) {
          liveLink = href;
          break;
        }
      }
    }
    
    // Find streamer info dynamically - more resilient
    let streamerName = '';
    let streamerAvatar = '';
    
    // Try multiple ways to find streamer image
    const allImages = card.find('img');
    let streamerImg = card.find('img[alt]').filter((i, el) => {
      const alt = $(el).attr('alt');
      return alt && alt !== 'Yellow Cards' && !alt.includes('Logo') && alt !== '8xbet' && alt.length > 0;
    }).first();

    if (!streamerImg.length && allImages.length > 0) {
      streamerImg = allImages.last();
    }

    if (streamerImg.length) {
      streamerName = streamerImg.attr('alt')?.trim() || '';
      const imgUrl = streamerImg.attr('data-src') || streamerImg.attr('src') || '';
      streamerAvatar = (imgUrl && !imgUrl.startsWith('data:image')) ? imgUrl : '';
    }
    
    // Fallback: look for text-based streamer name
    if (!streamerName) {
      const streamerNameEl = card.find('.truncate.max-w-\\[70px\\], .text-\\[13px\\].font-medium.tracking-wide, [class*="streamer"]').first();
      streamerName = streamerNameEl.text()?.trim() || '';
    }

    // Odds parsing
    const oddsEl = card.find('.bals-odds');
    let odds = null;
    if (oddsEl.length) {
      const rows = [];
      oddsEl.find('.grid').each((i, rowEl) => {
        const cols = [];
        $(rowEl).find('div').each((j, colEl) => {
          cols.push($(colEl).text().trim());
        });
        if (cols.length) {
          rows.push(cols);
        }
      });
      if (rows.length) {
        odds = rows;
      }
    }

    const match = {
      matchId,
      isHot: card.attr('data-accent') === 'hot',
      // Chuẩn hoá về MILI-GIÂY để khớp đơn vị dùng chung với mọi service
      // khác (giovang/ninety/phaohoa/vsc9/xoilac) khi gộp sort chung ở
      // playlistBuilder.service.js. Không rõ chắc chắn data-match-time/
      // data-time của Gà Vàng trả về giây hay mili-giây (thường HTML
      // data-* kiểu này hay là giây kiểu PHP time()) — tự nhận diện theo
      // độ lớn số: mili-giây hiện tại luôn > 10^12, giây hiện tại chỉ
      // ~1.7x10^9, nên < 10^12 gần như chắc chắn là giây, nhân 1000 lại.
      matchTimeTimestamp: normalizeToMs(matchTimeTimestamp),
      timeFormatted: timeFormattedText,
      competition: {
        id: competitionId,
        name: competitionName,
        logo: competitionLogo
      },
      status: {
        name: statusName || (isLive ? 'Live' : (isFinished ? 'Finished' : 'Upcoming')),
        elapsedTime: elapsedTime || '',
        isLive,
        isUpcoming,
        isFinished
      },
      homeTeam: {
        id: homeTeamId,
        name: homeTeamName,
        logo: homeTeamLogo
      },
      awayTeam: {
        id: awayTeamId,
        name: awayTeamName,
        logo: awayTeamLogo
      },
      score: {
        home: homeScore ? parseInt(homeScore) : 0,
        away: awayScore ? parseInt(awayScore) : 0
      },
      stats: {
        halfTimeScore: htScore || '0-0',
        corners: corners || '0-0',
        yellowCards: yellowCards || '0-0'
      },
      stream: {
        liveUrl: liveLink,
        streamerName: streamerName || null,
        streamerAvatar: streamerAvatar || null,
        streamerIds
      },
      odds
    };

    match.slug = extractSlugFromUrl(liveLink) || buildMatchSlug(match);
    matches.push(match);
  });

  return matches;
}

module.exports = {
  parseMatchCards,
};
