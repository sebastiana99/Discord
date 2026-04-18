require('dotenv').config();

console.log('Jarvis booting...');
console.log('DISCORD_TOKEN present:', Boolean(process.env.DISCORD_TOKEN));

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits, Partials, ChannelType } = require('discord.js');
const cheerio = require('cheerio');
const { chromium } = require('playwright');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

let browserPromise;
const EMBED_COLOR = 0x0070d1;
const PLATINUM_EMBED_COLOR = 0xd9d9ff;
const PSNPROFILES_BASE_URL = 'https://psnprofiles.com';
const PSN_CARD_BASE_URL = 'https://card.psnprofiles.com/1';
const PSN_PLATHUB_BASE_URL = 'https://www.psnplathub.com';
const POWERPYX_BASE_URL = 'https://www.powerpyx.com';
const PLAYSTATION_BLOG_BASE_URL = 'https://blog.playstation.com';
const PUSHSQUARE_BASE_URL = 'https://www.pushsquare.com';
const PLAYSTATION_PLUS_GAMES_URL = 'https://www.playstation.com/en-us/ps-plus/games/';
const PLAYSTATION_STORE_COLLECTIONS_URL = 'https://store.playstation.com/en-us/category/30749d2c-738f-4c36-9d6b-7ed517cca9ee/';
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const TROPHY_CACHE_TTL_MS = 10 * 60 * 1000;
const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000;
const AUDIT_MEMBER_CACHE_TTL_MS = 60 * 1000;
const TROPHY_RETRY_DELAYS_MS = [2500, 5000];
const trophyCache = new Map();
const profileCache = new Map();
const auditMemberCache = new Map();
const ADMIN_ROLE_IDS = ['1482453535550341250', '1484271731618091133'];
const MEMBER_ROLE_ID = '1482450530247770305';
const RULES_ACCEPTED_ROLE_NAME = 'Rules Accepted';
const RULES_CHANNEL_ID = '1482448016874143814';
const RULES_MESSAGE_ID = '1482449081900072990';
const RULES_ACCEPTED_EMOJI = '🎮';
const PLAYSTATION_NEWS_CHANNEL_ID = '1482550865847124101';
const PLAYSTATION_PLUS_CHANNEL_ID = '1482550945945751764';
const SERVER_SHUTDOWNS_CHANNEL_ID = '1485745504100028436';
const BOOSTING_SESSIONS_CATEGORY_ID = '1482552761403965511';
const MOVIE_WHEEL_SPINNER_ROLE_ID = '1482454550563655841';
const OWNER_USER_ID = '592074887913406486';
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const PSN_REGISTRATIONS_FILE = path.join(DATA_DIR, 'psn-registrations.json');
const SESSION_REGISTRATIONS_FILE = path.join(DATA_DIR, 'session-registrations.json');
const WHEELS_FILE = path.join(DATA_DIR, 'wheels.json');
const SPOTIFY_PLAYLIST_STATE_FILE = path.join(DATA_DIR, 'spotify-playlist.json');
const PLAYSTATION_NEWS_STATE_FILE = path.join(DATA_DIR, 'playstation-news-state.json');
const PLAYSTATION_PLUS_STATE_FILE = path.join(DATA_DIR, 'playstation-plus-state.json');
const SERVER_SHUTDOWNS_STATE_FILE = path.join(DATA_DIR, 'server-shutdowns-state.json');
const PLAYSTATION_NEWS_POLL_INTERVAL_MS = 30 * 60 * 1000;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN || '';
const DEFAULT_SPOTIFY_PLAYLIST_NAME = process.env.SPOTIFY_PLAYLIST_NAME || 'No BS Trophy Huntin Community Playlist';
const HUNTER_RANKS = [
  { name: 'Novice Hunter', min: 1, max: 99 },
  { name: 'Rising Hunter', min: 100, max: 199 },
  { name: 'Adept Hunter', min: 200, max: 299 },
  { name: 'Elite Hunter', min: 300, max: 399 },
  { name: 'Master Hunter', min: 400, max: 499 },
  { name: 'Grandmaster Hunter', min: 500, max: 599 },
  { name: 'Veteran Hunter', min: 600, max: 699 },
  { name: 'Legendary Hunter', min: 700, max: 799 },
  { name: 'Mythic Hunter', min: 800, max: 899 },
  { name: 'Platinum Overlord', min: 900, max: 949 },
  { name: 'Ultimate Hunter', min: 950, max: 998 },
  { name: 'Platinum God', min: 999, max: 999 },
];
let psnRegistrations = loadPsnRegistrations();
let sessionRegistrations = loadSessionRegistrations();
let wheels = loadWheels();
let spotifyPlaylistState = loadSpotifyPlaylistState();
let spotifyAccessTokenCache = null;

function ensureDataDirectory() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directory:', error.message);
  }
}

function loadPsnRegistrations() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(PSN_REGISTRATIONS_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(PSN_REGISTRATIONS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to load psn registrations:', error.message);
    return {};
  }
}

function savePsnRegistrations() {
  try {
    ensureDataDirectory();
    fs.writeFileSync(PSN_REGISTRATIONS_FILE, JSON.stringify(psnRegistrations, null, 2));
  } catch (error) {
    console.error('Failed to save psn registrations:', error.message);
  }
}

function loadSessionRegistrations() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(SESSION_REGISTRATIONS_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(SESSION_REGISTRATIONS_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to load session registrations:', error.message);
    return {};
  }
}

function saveSessionRegistrations() {
  try {
    ensureDataDirectory();
    fs.writeFileSync(SESSION_REGISTRATIONS_FILE, JSON.stringify(sessionRegistrations, null, 2));
  } catch (error) {
    console.error('Failed to save session registrations:', error.message);
  }
}

function loadWheels() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(WHEELS_FILE)) {
      return {
        movies: [],
      };
    }

    const raw = fs.readFileSync(WHEELS_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};

    const normalizeEntries = (entries) =>
      (Array.isArray(entries) ? entries : [])
        .map((entry) => {
          if (typeof entry === 'string') {
            return {
              title: entry,
              addedBy: null,
              addedAt: null,
            };
          }

          if (entry && typeof entry.title === 'string') {
            return {
              title: entry.title,
              addedBy: entry.addedBy || null,
              addedAt: entry.addedAt || null,
            };
          }

          return null;
        })
        .filter(Boolean);

    return {
      movies: normalizeEntries(parsed.movies),
    };
  } catch (error) {
    console.error('Failed to load wheels:', error.message);
    return {
      movies: [],
    };
  }
}

function saveWheels() {
  try {
    ensureDataDirectory();
    fs.writeFileSync(WHEELS_FILE, JSON.stringify(wheels, null, 2));
  } catch (error) {
    console.error('Failed to save wheels:', error.message);
  }
}

function loadSpotifyPlaylistState() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(SPOTIFY_PLAYLIST_STATE_FILE)) {
      return {
        playlistId: null,
        playlistUrl: null,
        playlistName: null,
        updatedAt: null,
      };
    }

    const raw = fs.readFileSync(SPOTIFY_PLAYLIST_STATE_FILE, 'utf8');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      playlistId: parsed.playlistId || null,
      playlistUrl: parsed.playlistUrl || null,
      playlistName: parsed.playlistName || null,
      updatedAt: parsed.updatedAt || null,
    };
  } catch (error) {
    console.error('Failed to load Spotify playlist state:', error.message);
    return {
      playlistId: null,
      playlistUrl: null,
      playlistName: null,
      updatedAt: null,
    };
  }
}

function saveSpotifyPlaylistState(state) {
  try {
    spotifyPlaylistState = {
      playlistId: state.playlistId || null,
      playlistUrl: state.playlistUrl || null,
      playlistName: state.playlistName || null,
      updatedAt: state.updatedAt || new Date().toISOString(),
    };

    ensureDataDirectory();
    fs.writeFileSync(SPOTIFY_PLAYLIST_STATE_FILE, JSON.stringify(spotifyPlaylistState, null, 2));
  } catch (error) {
    console.error('Failed to save Spotify playlist state:', error.message);
  }
}

function loadPlayStationNewsState() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(PLAYSTATION_NEWS_STATE_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(PLAYSTATION_NEWS_STATE_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to load PlayStation news state:', error.message);
    return {};
  }
}

function savePlayStationNewsState(state) {
  try {
    ensureDataDirectory();
    fs.writeFileSync(PLAYSTATION_NEWS_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save PlayStation news state:', error.message);
  }
}

function loadPlayStationPlusState() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(PLAYSTATION_PLUS_STATE_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(PLAYSTATION_PLUS_STATE_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to load PlayStation Plus state:', error.message);
    return {};
  }
}

function savePlayStationPlusState(state) {
  try {
    ensureDataDirectory();
    fs.writeFileSync(PLAYSTATION_PLUS_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save PlayStation Plus state:', error.message);
  }
}

function loadServerShutdownsState() {
  try {
    ensureDataDirectory();

    if (!fs.existsSync(SERVER_SHUTDOWNS_STATE_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(SERVER_SHUTDOWNS_STATE_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error('Failed to load server shutdowns state:', error.message);
    return {};
  }
}

function saveServerShutdownsState(state) {
  try {
    ensureDataDirectory();
    fs.writeFileSync(SERVER_SHUTDOWNS_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save server shutdowns state:', error.message);
  }
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
  }

  return browserPromise;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getImageUrl(element, $) {
  const src = element.attr('src') || element.attr('data-src') || element.attr('data-original');

  if (!src) {
    return null;
  }

  return src.startsWith('http') ? src : new URL(src, PSNPROFILES_BASE_URL).toString();
}

function parseLatestTrophy(html) {
  const $ = cheerio.load(html);
  const rows = $('tr').toArray();

  for (const row of rows) {
    const entry = $(row);
    const trophyName = entry.find('.title').first().text().trim();
    const gameImageEl = entry.find('img.game').first();
    const trophyImageEl = entry.find('img.trophy').first();

    if (!trophyName || !gameImageEl.length || !trophyImageEl.length) {
      continue;
    }

    const gameName =
      gameImageEl.attr('title') ||
      entry.find('a[href^="/game/"]').first().text().trim();

    const trophyType =
      trophyImageEl.attr('title') ||
      entry.find('span.typo-top').first().text().trim() ||
      'Trophy';

    const rarity =
      entry.find('.typo-top').last().text().replace(/\s+/g, ' ').trim() || 'Unknown rarity';

    return {
      trophyName,
      gameName,
      trophyType,
      trophyIcon: getImageUrl(trophyImageEl, $),
      gameImage: getImageUrl(gameImageEl, $),
      rarity,
    };
  }

  return null;
}

function parseLatestPlatHubTrophyFromText(bodyText) {
  const normalizedText = normalizeText(bodyText);
  const pattern = /Download\s+([^\s]+)\s+#(\d+)\s+(.+?)\s+(PS5|PS4|PS3|PS Vita)\s+EARNED ON\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i;
  const match = normalizedText.match(pattern);

  if (!match) {
    return null;
  }

  return {
    trophyName: `Latest Platinum (#${match[2]})`,
    gameName: match[3].trim(),
    platform: match[4].trim(),
    earnedDate: match[5].trim(),
    rarity: 'Not available',
    trophyType: 'Platinum',
    rawText: match[0],
  };
}

function absolutizePlatHubUrl(url) {
  if (!url) {
    return null;
  }

  return url.startsWith('http') ? url : new URL(url, PSN_PLATHUB_BASE_URL).toString();
}

function parseLatestPlatHubCard(html) {
  const $ = cheerio.load(html);
  const card = $('[data-slot="card"]').first();

  if (!card.length) {
    return null;
  }

  const username = card.find('span.text-xl.font-bold').first().text().trim() || null;
  const gameName = card.find('h3').first().text().trim() || null;
  const platform = card.find('p.text-muted-foreground').first().text().trim() || null;
  const platinumNumber = card.find('span.text-xs.font-semibold').first().text().trim() || null;
  const avatarUrl = absolutizePlatHubUrl(card.find(`img[alt="${username}"]`).first().attr('src'));
  const gameImageEl = card.find('img[alt]').filter((_, element) => {
    const alt = $(element).attr('alt');
    return alt && alt !== username && alt !== 'Platinum';
  }).first();
  const gameImage = absolutizePlatHubUrl(gameImageEl.attr('src'));

  let earnedDate = null;
  let rarity = null;

  card.find('div').each((_, element) => {
    const section = $(element);
    const label = section.find('span').first().text().trim();
    const value = section.find('span').last().text().trim();

    if (label === 'Earned On') {
      earnedDate = value;
    }

    if (label === 'PSN Rarity') {
      rarity = value;
    }
  });

  if (!gameName || !platform) {
    return null;
  }

  return {
    username,
    trophyName: gameName,
    gameName,
    platinumNumber: platinumNumber || null,
    platform,
    earnedDate,
    rarity: rarity || 'Not available',
    trophyType: 'Platinum',
    trophyIcon: avatarUrl,
    gameImage,
    matchedPattern: null,
  };
}

function parsePlatHubGameOfYearPage(html, bodyText, username) {
  const $ = cheerio.load(html);
  const url = `${PSN_PLATHUB_BASE_URL}/game-of-the-year?psnId=${encodeURIComponent(username)}`;
  const ogImage = absolutizePlatHubUrl($('meta[property="og:image"]').attr('content'));
  const normalizedText = normalizeText(bodyText);
  const cleanedText = normalizedText
    .replace(/Toggle Sidebar/gi, '')
    .replace(/Go to Main Page/gi, '')
    .replace(/Download/gi, '')
    .trim();
  const title = 'GOTY Challenge';

  const completionMatch = cleanedText.match(/(\d+)\s*\/\s*(\d+)\s+GOTY titles platted\s+(\d+)%/i);
  const challengeLine = completionMatch
    ? `${completionMatch[1]} / ${completionMatch[2]} GOTY titles platted (${completionMatch[3]}%)`
    : null;

  const entryPattern = /(\d{4})\s+(.+?)\s+(The Game Awards|Spike VGAs \(2009–2013\)|Spike VGAs)\s+(Missing|Platted)/gi;
  const entries = [];
  let match;

  while ((match = entryPattern.exec(cleanedText)) !== null && entries.length < 5) {
    entries.push({
      year: match[1],
      game: match[2].trim(),
      award: match[3].trim(),
      status: match[4].trim(),
    });
  }

  return {
    title,
    challengeLine: challengeLine || 'Open the PSN PlatHub page to view this player\'s Game of the Year results.',
    entries,
    imageUrl: ogImage || null,
    url,
  };
}

function parsePlatHubAlphabetChallengePage(html, bodyText, username) {
  const $ = cheerio.load(html);
  const url = `${PSN_PLATHUB_BASE_URL}/alphabet?psnId=${encodeURIComponent(username)}`;
  const ogImage = absolutizePlatHubUrl($('meta[property="og:image"]').attr('content'));
  const normalizedText = normalizeText(bodyText);
  const cleanedText = normalizedText
    .replace(/Toggle Sidebar/gi, '')
    .replace(/Go to Main Page/gi, '')
    .replace(/Download/gi, '')
    .trim();
  const title = 'Alphabet Challenge';

  const completionMatch = cleanedText.match(/(\d+)\s*\/\s*(26|\d+)\s+letters?\s+(?:covered|completed|platted)\s+(\d+)%/i);
  const challengeLine = completionMatch
    ? `${completionMatch[1]} / ${completionMatch[2]} letters completed (${completionMatch[3]}%)`
    : null;
  const missingLettersMatch = cleanedText.match(/Missing:\s*([A-Z](?:,\s*[A-Z])*)/i);
  const missingLetters = missingLettersMatch
    ? missingLettersMatch[1].split(/\s*,\s*/).filter(Boolean)
    : [];
  const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const coveredLetters = missingLetters.length > 0
    ? allLetters.filter((letter) => !missingLetters.includes(letter))
    : [];

  const entryPattern = /\b([A-Z])\s+(.+?)\s+(Platted|Missing)\b/gi;
  const entries = [];
  let match;

  while ((match = entryPattern.exec(cleanedText)) !== null && entries.length < 8) {
    const game = match[2].trim();

    if (/platinum collection by first letter/i.test(game)) {
      continue;
    }

    entries.push({
      letter: match[1],
      game,
      status: match[3].trim(),
    });
  }

  return {
    title,
    challengeLine: challengeLine || 'Open the PSN PlatHub page to view this player\'s Alphabet Challenge results.',
    entries,
    coveredLetters,
    missingLetters,
    imageUrl: ogImage || null,
    url,
  };
}

function extractPsnUsername(input) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();

  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/psnprofiles\.com\/([^/?#]+)/i);
  const rawUsername = match ? match[1] : trimmed;

  return rawUsername.replace(/^@/, '').trim();
}

function parsePlatinumCount(html) {
  const $ = cheerio.load(html);
  const bodyText = normalizeText($('body').text());
  const regexes = [
    /Platinums?\s*([\d,]+)/i,
    /([\d,]+)\s*Platinums?/i,
  ];

  for (const regex of regexes) {
    const match = bodyText.match(regex);

    if (!match) {
      continue;
    }

    const count = Number.parseInt(match[1].replace(/,/g, ''), 10);

    if (!Number.isNaN(count)) {
      return count;
    }
  }

  return null;
}

function parseTrophyLevelFromText(text) {
  const regexes = [
    /Trophy\s*Level\s*([\d,]+)/i,
    /Level\s*([\d,]+)\s*(?:Trophies|Profile|PSN)?/i,
  ];

  for (const regex of regexes) {
    const match = text.match(regex);

    if (!match) {
      continue;
    }

    const count = Number.parseInt(match[1].replace(/,/g, ''), 10);

    if (!Number.isNaN(count) && count >= 1 && count <= 9999) {
      return count;
    }
  }

  return null;
}

function parsePsnPlatHubSummaryFromText(bodyText) {
  const normalizedText = normalizeText(bodyText);
  const compactMatch = normalizedText.match(/LEVEL\s+(\d{1,4})\s+(\d{1,5})\s+(\d{1,5})\s+(\d{1,5})\s+(\d{1,5})\s+(\d{1,6})/i);

  if (compactMatch) {
    return {
      trophyLevel: Number.parseInt(compactMatch[1], 10),
      platinumCount: Number.parseInt(compactMatch[2], 10),
      goldCount: Number.parseInt(compactMatch[3], 10),
      silverCount: Number.parseInt(compactMatch[4], 10),
      bronzeCount: Number.parseInt(compactMatch[5], 10),
      totalTrophies: Number.parseInt(compactMatch[6], 10),
      matchedPattern: compactMatch[0],
    };
  }

  const platinumCount = null;
  const trophyLevel = parseTrophyLevelFromText(normalizedText);

  if (platinumCount === null && trophyLevel === null) {
    return null;
  }

  return {
    platinumCount,
    trophyLevel,
  };
}

function parseSpecificPlatHubTrophyFromText(bodyText, targetPlatinumNumber) {
  const normalizedText = normalizeText(bodyText);
  const trimmedHistory = normalizedText.replace(/^.*?LEVEL\s+\d{1,4}\s+\d{1,5}\s+\d{1,5}\s+\d{1,5}\s+\d{1,5}\s+\d{1,6}\s*/i, '');
  const entryPattern = /(.+?)\s+(PS5|PS4|PS3|PS Vita)\s+([\d.]+%)\s+#(\d{1,5})/gi;
  let match;

  while ((match = entryPattern.exec(trimmedHistory)) !== null) {
    const platinumNumber = Number.parseInt(match[4], 10);

    if (platinumNumber !== targetPlatinumNumber) {
      continue;
    }

    return {
      trophyName: match[1].trim(),
      gameName: match[1].trim(),
      platform: match[2].trim(),
      rarity: match[3].trim(),
      trophyType: 'Platinum',
      platinumNumber: `#${match[4]}`,
      earnedDate: null,
      matchedPattern: match[0],
    };
  }

  return null;
}

function parsePlatHubPlatinumTitlesFromText(bodyText) {
  const normalizedText = normalizeText(bodyText);
  const trimmedHistory = normalizedText.replace(/^.*?LEVEL\s+\d{1,4}\s+\d{1,5}\s+\d{1,5}\s+\d{1,5}\s+\d{1,5}\s+\d{1,6}\s*/i, '');
  const entryPattern = /(.+?)\s+(PS5|PS4|PS3|PS Vita)\s+([\d.]+%)\s+#(\d{1,5})/gi;
  const titles = new Set();
  let match;

  while ((match = entryPattern.exec(trimmedHistory)) !== null) {
    titles.add(match[1].trim().toLowerCase());
  }

  return titles;
}

function parseCandidateTitlesFromSection(sectionText) {
  const lines = sectionText
    .split(/\s{2,}|\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const titles = [];
  const stopPatterns = [
    /^(included|free|buy now|wishlist|download|learn more|game catalog|ubisoft\+ classics|classics catalog)$/i,
    /^(ps plus|playstation plus|browse|collections|store|all games)$/i,
    /^\d+\s*(games|titles)?$/i,
  ];

  for (const line of lines) {
    if (line.length < 2 || line.length > 80) {
      continue;
    }

    if (stopPatterns.some((pattern) => pattern.test(line))) {
      continue;
    }

    if (/^[A-Z]$/.test(line)) {
      continue;
    }

    if (!/[A-Za-z]/.test(line)) {
      continue;
    }

    titles.push(line);
  }

  return [...new Set(titles)];
}

function parseOfficialFreeToPlayTitlesFromText(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const titles = [];
  const blockedPatterns = [
    /^(Games|Browse|PlayStation Store|PS5|PS4|PS VR2|PC|PS Plus|All Games|Add-Ons|Subscriptions|Collections|Deals)$/i,
    /^(Sort by|Filter|Release date|Platform|Genre|Publisher|Price|Best selling|New releases)$/i,
    /^(Free|Demo|Included)$/i,
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!/^Free$/i.test(line)) {
      continue;
    }

    for (let j = i - 1; j >= Math.max(0, i - 4); j -= 1) {
      const candidate = lines[j];

      if (
        candidate.length < 2 ||
        candidate.length > 90 ||
        !/[A-Za-z]/.test(candidate) ||
        blockedPatterns.some((pattern) => pattern.test(candidate)) ||
        /^\$?\d/.test(candidate) ||
        /save \d+%/i.test(candidate)
      ) {
        continue;
      }

      titles.push(candidate);
      break;
    }
  }

  return [...new Set(titles)];
}

function parseOfficialPlayStationPlusTitlesFromText(rawText) {
  const lines = rawText
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const titles = [];
  let inSection = false;

  for (const line of lines) {
    if (/^(Game Catalog|Game trials)$/i.test(line)) {
      inSection = true;
      continue;
    }

    if (!inSection) {
      continue;
    }

    if (/^(Choose your membership plan|Premium|Extra|Essential|Frequently asked questions)$/i.test(line)) {
      break;
    }

    if (/^[A-Z]$/.test(line) || /^###$/.test(line)) {
      continue;
    }

    if (/^(Find your next game|Browse the PlayStation Plus game finder|Player guide|Discover great games)/i.test(line)) {
      continue;
    }

    if (/^(Classics Catalog|Monthly games|Game trials|Cloud Streaming|Ubisoft\+ Classics|Online Multiplayer|Exclusive Discounts|Share Play|Cloud Storage|Exclusive Content|Sony Pictures Catalog)$/i.test(line)) {
      continue;
    }

    if (line.length < 2 || line.length > 90 || !/[A-Za-z]/.test(line)) {
      continue;
    }

    titles.push(line);
  }

  return [...new Set(titles)];
}

async function fetchLatestTrophy(username) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const url = `${PSN_PLATHUB_BASE_URL}/latest-plat?psnId=${encodeURIComponent(username)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSN PlatHub latest platinum.');
    }

    const status = response.status();

    if (status === 404) {
      return { kind: 'not_found' };
    }

    if (status >= 400) {
      return { kind: 'blocked', status, provider: 'psnplathub' };
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const title = await page.title();
    const html = await page.content();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const domTrophy = parseLatestPlatHubCard(html);
    const textTrophy = parseLatestPlatHubTrophyFromText(bodyText);
    const trophy = domTrophy || textTrophy;

    if (trophy) {
      return {
        kind: 'success',
        trophy: {
          ...trophy,
          trophyIcon: trophy.trophyIcon || null,
          gameImage: trophy.gameImage || null,
          latestPlatUrl: url,
        },
        provider: 'psnplathub',
      };
    }

    if (/access denied|too many requests|temporarily unavailable/i.test(bodyText) || /just a moment|attention required/i.test(title)) {
      return { kind: 'blocked', status, title, provider: 'psnplathub' };
    }

    return {
      kind: 'parse_error',
      provider: 'psnplathub',
      textSnippet: bodyText.replace(/\s+/g, ' ').slice(0, 250),
      latestPlatUrl: url,
    };
  } finally {
    await context.close();
  }
}

async function fetchSpecificTrophy(username, platinumNumber) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const url = `${PSN_PLATHUB_BASE_URL}/mosaic?psnId=${encodeURIComponent(username)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSN PlatHub mosaic.');
    }

    const status = response.status();

    if (status === 404) {
      return { kind: 'not_found' };
    }

    if (status >= 400) {
      return { kind: 'blocked', status, provider: 'psnplathub' };
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const title = await page.title();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const trophy = parseSpecificPlatHubTrophyFromText(bodyText, platinumNumber);

    if (trophy) {
      return {
        kind: 'success',
        trophy: {
          ...trophy,
          latestPlatUrl: url,
        },
        provider: 'psnplathub',
      };
    }

    const bodyLower = bodyText.toLowerCase();

    if (
      /rate limit|too many requests|temporarily unavailable|please try again later/i.test(bodyText) ||
      /captcha|access denied|just a moment|attention required/i.test(title)
    ) {
      return { kind: 'blocked', status, title, provider: 'psnplathub' };
    }

    if (
      /no profile found|could not find|error has occurred|updated profile on psnprofiles/i.test(bodyLower)
    ) {
      return { kind: 'not_found' };
    }

    return {
      kind: 'parse_error',
      provider: 'psnplathub',
      textSnippet: bodyText.replace(/\s+/g, ' ').slice(0, 250),
      latestPlatUrl: url,
    };
  } finally {
    await context.close();
  }
}

async function fetchUserPlatinumTitles(username) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const url = `${PSN_PLATHUB_BASE_URL}/mosaic?psnId=${encodeURIComponent(username)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSN PlatHub mosaic.');
    }

    const status = response.status();

    if (status >= 400) {
      return new Set();
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(2000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    return parsePlatHubPlatinumTitlesFromText(bodyText);
  } finally {
    await context.close();
  }
}

async function fetchOfficialPlayStationPlusTitles() {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(PLAYSTATION_PLUS_GAMES_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const linkTexts = await page.locator('a').evaluateAll((elements) =>
      elements.map((element) => (element.textContent || '').trim()).filter(Boolean)
    ).catch(() => []);
    const titles = [...new Set(
      linkTexts
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter((text) =>
          text.length >= 2 &&
          text.length <= 90 &&
          /[A-Za-z]/.test(text) &&
          !/^(Overview|What's new on PlayStation Plus|Monthly games|Game Catalog|Classics Catalog|Game trials|Discover more|Learn more|Find your next game|Browse the PlayStation Plus game finder|Player guide|Premium|Extra|Essential|Subscribe|Included|See All|Explore)$/i.test(text)
        )
    )];

    return {
      titles,
      textSnippet: normalizeText(bodyText).slice(0, 500),
    };
  } finally {
    await context.close();
  }
}

async function fetchOfficialFreeToPlayTitles() {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    await page.goto(PLAYSTATION_STORE_COLLECTIONS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const linkTexts = await page.locator('a[href*="/product/"], a[href*="/concept/"]').evaluateAll((elements) =>
      elements.map((element) => (element.textContent || '').trim()).filter(Boolean)
    ).catch(() => []);
    const titles = [...new Set(
      linkTexts
        .map((text) => text.replace(/\s+/g, ' ').trim())
        .filter((text) =>
          text.length >= 2 &&
          text.length <= 90 &&
          /[A-Za-z]/.test(text) &&
          !/^(Free|Demo|Included|Add to Cart|Wishlist|Learn More|PS4|PS5)$/i.test(text)
        )
    )];

    return {
      titles,
      textSnippet: normalizeText(bodyText).slice(0, 500),
    };
  } finally {
    await context.close();
  }
}

async function fetchPsnProfileSummary(username) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
    });
  });

  const page = await context.newPage();
  const url = buildLogUrl(username);

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSNProfiles profile.');
    }

    const status = response.status();

    if (status === 404) {
      return { kind: 'not_found' };
    }

    if (status >= 400) {
      return { kind: 'blocked', status };
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const title = await page.title();
    const html = await page.content();
    const platinumCount = parsePlatinumCount(html);

    if (platinumCount !== null) {
      return {
        kind: 'success',
        profile: {
          username,
          platinumCount,
        },
      };
    }

    const challengeDetected =
      /just a moment|attention required|access denied|security check/i.test(title) ||
      /cf-browser-verification|cf-challenge|challenge-platform|turnstile|captcha/i.test(html);

    if (challengeDetected) {
      return { kind: 'blocked', status, title };
    }

    return {
      kind: 'parse_error',
      provider: 'psnplathub',
      profile: {
        username,
        platinumCount: summary?.platinumCount ?? null,
        trophyLevel: summary?.trophyLevel ?? null,
        matchedPattern: summary?.matchedPattern ?? null,
        textSnippet: bodyText.replace(/\s+/g, ' ').slice(0, 300),
      },
    };
  } finally {
    await context.close();
  }
}

async function fetchPsnPlatHubSummary(username) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const url = `${PSN_PLATHUB_BASE_URL}/mosaic?psnId=${encodeURIComponent(username)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSN PlatHub.');
    }

    const status = response.status();

    if (status === 404) {
      return { kind: 'not_found' };
    }

    if (status >= 400) {
      return { kind: 'blocked', status };
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const title = await page.title();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log('PSN PlatHub title:', title);
    console.log('PSN PlatHub text snippet:', bodyText.replace(/\s+/g, ' ').slice(0, 1200));
    const summary = parsePsnPlatHubSummaryFromText(bodyText);

    if (summary && (summary.platinumCount !== null || summary.trophyLevel !== null)) {
      return {
        kind: 'success',
        profile: {
          username,
          platinumCount: summary.platinumCount,
          trophyLevel: summary.trophyLevel,
        },
      };
    }

    const bodyLower = bodyText.toLowerCase();

    if (
      /rate limit|too many requests|temporarily unavailable|please try again later/i.test(bodyText) ||
      /captcha|access denied|just a moment|attention required/i.test(title)
    ) {
      return { kind: 'blocked', status, title };
    }

    if (
      /no profile found|could not find|error has occurred|updated profile on psnprofiles/i.test(bodyLower)
    ) {
      return { kind: 'not_found' };
    }

    return { kind: 'parse_error' };
  } finally {
    await context.close();
  }
}

async function fetchGameOfYear(username) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const url = `${PSN_PLATHUB_BASE_URL}/game-of-the-year?psnId=${encodeURIComponent(username)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSN PlatHub Game of the Year.');
    }

    const status = response.status();

    if (status === 404) {
      return { kind: 'not_found' };
    }

    if (status >= 400) {
      return { kind: 'blocked', status, provider: 'psnplathub' };
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const title = await page.title();
    const html = await page.content();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const goty = parsePlatHubGameOfYearPage(html, bodyText, username);

    if (
      (goty.challengeLine && goty.challengeLine.length > 0) ||
      (goty.entries && goty.entries.length > 0)
    ) {
      return {
        kind: 'success',
        goty,
        provider: 'psnplathub',
      };
    }

    if (/access denied|too many requests|temporarily unavailable/i.test(bodyText) || /just a moment|attention required/i.test(title)) {
      return { kind: 'blocked', status, title, provider: 'psnplathub' };
    }

    return {
      kind: 'parse_error',
      provider: 'psnplathub',
      textSnippet: bodyText.replace(/\s+/g, ' ').slice(0, 300),
      gotyUrl: url,
    };
  } finally {
    await context.close();
  }
}

async function fetchAlphabetChallenge(username) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const url = `${PSN_PLATHUB_BASE_URL}/alphabet?psnId=${encodeURIComponent(username)}`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSN PlatHub Alphabet Challenge.');
    }

    const status = response.status();

    if (status === 404) {
      return { kind: 'not_found' };
    }

    if (status >= 400) {
      return { kind: 'blocked', status, provider: 'psnplathub' };
    }

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
    await page.waitForTimeout(3000);

    const title = await page.title();
    const html = await page.content();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const alphabet = parsePlatHubAlphabetChallengePage(html, bodyText, username);

    const hasUsableEntries = alphabet.entries && alphabet.entries.length > 0;
    const hasUsableChallengeLine =
      alphabet.challengeLine &&
      !/Open the PSN PlatHub page to view/i.test(alphabet.challengeLine);
    const hasLetterBreakdown =
      (alphabet.coveredLetters && alphabet.coveredLetters.length > 0) ||
      (alphabet.missingLetters && alphabet.missingLetters.length > 0);

    if (hasUsableEntries || hasUsableChallengeLine || hasLetterBreakdown) {
      return {
        kind: 'success',
        alphabet,
        provider: 'psnplathub',
      };
    }

    if (/access denied|too many requests|temporarily unavailable/i.test(bodyText) || /just a moment|attention required/i.test(title)) {
      return { kind: 'blocked', status, title, provider: 'psnplathub' };
    }

    return {
      kind: 'parse_error',
      provider: 'psnplathub',
      textSnippet: bodyText.replace(/\s+/g, ' ').slice(0, 300),
      alphabetUrl: url,
    };
  } finally {
    await context.close();
  }
}

async function fetchPsnProfileSummaryWithRetry(username) {
  const cachedProfile = getCachedProfileSummary(username);

  if (cachedProfile) {
    return {
      kind: 'success',
      profile: cachedProfile,
      source: 'cache',
      provider: 'psnplathub',
    };
  }

  let lastResult = null;

  for (let attempt = 0; attempt <= TROPHY_RETRY_DELAYS_MS.length; attempt += 1) {
    const platHubResult = await fetchPsnPlatHubSummary(username);
    lastResult = platHubResult;

    if (platHubResult.kind === 'success') {
      setCachedProfileSummary(username, platHubResult.profile);
      return {
        ...platHubResult,
        provider: 'psnplathub',
        source: attempt === 0 ? 'live' : 'retry',
      };
    }

    if (platHubResult.kind === 'not_found' || platHubResult.kind === 'parse_error') {
      return {
        ...platHubResult,
        provider: 'psnplathub',
        source: attempt === 0 ? 'live' : 'retry',
      };
    }

    if (platHubResult.kind === 'blocked' && attempt < TROPHY_RETRY_DELAYS_MS.length) {
      await delay(TROPHY_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    return {
      ...platHubResult,
      provider: 'psnplathub',
      source: attempt === 0 ? 'live' : 'retry',
    };
  }

  return lastResult || { kind: 'parse_error' };
}

function getCachedTrophy(username) {
  const key = username.toLowerCase();
  const cached = trophyCache.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > TROPHY_CACHE_TTL_MS) {
    trophyCache.delete(key);
    return null;
  }

  return cached.trophy;
}

function getCachedProfileSummary(username) {
  const key = username.toLowerCase();
  const cached = profileCache.get(key);

  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > PROFILE_CACHE_TTL_MS) {
    profileCache.delete(key);
    return null;
  }

  return cached.profile;
}

function setCachedProfileSummary(username, profile) {
  profileCache.set(username.toLowerCase(), {
    profile,
    cachedAt: Date.now(),
  });
}

function setCachedTrophy(username, trophy) {
  trophyCache.set(username.toLowerCase(), {
    trophy,
    cachedAt: Date.now(),
  });
}

async function fetchLatestTrophyWithRetry(username) {
  const cachedTrophy = getCachedTrophy(username);

  if (cachedTrophy) {
    return { kind: 'success', trophy: cachedTrophy, source: 'cache' };
  }

  let lastResult = null;

  for (let attempt = 0; attempt <= TROPHY_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await fetchLatestTrophy(username);
    lastResult = result;

    if (result.kind === 'success') {
      setCachedTrophy(username, result.trophy);
      return { ...result, source: attempt === 0 ? 'live' : 'retry' };
    }

    if (result.kind === 'not_found' || result.kind === 'parse_error') {
      return result;
    }

    if (result.kind === 'blocked' && attempt < TROPHY_RETRY_DELAYS_MS.length) {
      await delay(TROPHY_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    return result;
  }

  return lastResult || { kind: 'parse_error' };
}

function buildProfileUrl(username) {
  return `${PSNPROFILES_BASE_URL}/${encodeURIComponent(username)}`;
}

function buildLogUrl(username) {
  return `${buildProfileUrl(username)}/log`;
}

function buildCardUrl(username) {
  return `${PSN_CARD_BASE_URL}/${encodeURIComponent(username)}.png`;
}

function isAdminMember(member) {
  if (!member) {
    return false;
  }

  return ADMIN_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

function canSpinMovieWheel(member) {
  if (!member) {
    return false;
  }

  return member.roles.cache.has(MOVIE_WHEEL_SPINNER_ROLE_ID);
}

function isSpotifyConfigured() {
  return Boolean(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET && SPOTIFY_REFRESH_TOKEN);
}

async function getSpotifyAccessToken() {
  if (!isSpotifyConfigured()) {
    throw new Error('Spotify credentials are not configured.');
  }

  if (spotifyAccessTokenCache && spotifyAccessTokenCache.expiresAt > Date.now() + 60 * 1000) {
    return spotifyAccessTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: SPOTIFY_REFRESH_TOKEN,
  });

  const basicAuth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const response = await axios.post(SPOTIFY_ACCOUNTS_TOKEN_URL, body.toString(), {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 15000,
  });

  spotifyAccessTokenCache = {
    token: response.data.access_token,
    expiresAt: Date.now() + ((response.data.expires_in || 3600) * 1000),
  };

  return spotifyAccessTokenCache.token;
}

async function spotifyApiRequest(method, resourcePath, { params, data } = {}) {
  const accessToken = await getSpotifyAccessToken();
  const response = await axios({
    method,
    url: `${SPOTIFY_API_BASE_URL}${resourcePath}`,
    params,
    data,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 20000,
  });

  return response.data;
}

async function ensureSpotifyPlaylist(playlistName = DEFAULT_SPOTIFY_PLAYLIST_NAME) {
  if (spotifyPlaylistState.playlistId && spotifyPlaylistState.playlistUrl) {
    return spotifyPlaylistState;
  }

  const playlist = await spotifyApiRequest('post', '/me/playlists', {
    data: {
      name: playlistName,
      public: true,
      description: 'Curated by Jarvis for No BS Trophy Huntin.',
    },
  });

  const state = {
    playlistId: playlist.id,
    playlistUrl: playlist.external_urls?.spotify || null,
    playlistName: playlist.name || playlistName,
    updatedAt: new Date().toISOString(),
  };

  saveSpotifyPlaylistState(state);
  return state;
}

async function searchSpotifyTrack(query) {
  const data = await spotifyApiRequest('get', '/search', {
    params: {
      q: query,
      type: 'track',
      limit: 5,
    },
  });

  const items = data?.tracks?.items || [];

  if (!items.length) {
    return null;
  }

  return items[0];
}

async function addTrackToSpotifyPlaylist(query, playlistName) {
  const track = await searchSpotifyTrack(query);

  if (!track) {
    return { kind: 'not_found' };
  }

  const playlist = await ensureSpotifyPlaylist(playlistName);

  await spotifyApiRequest('post', `/playlists/${playlist.playlistId}/items`, {
    data: {
      uris: [track.uri],
    },
  });

  saveSpotifyPlaylistState({
    ...playlist,
    updatedAt: new Date().toISOString(),
  });

  return {
    kind: 'added',
    playlist,
    track: {
      id: track.id,
      name: track.name,
      artists: (track.artists || []).map((artist) => artist.name).filter(Boolean),
      album: track.album?.name || null,
      url: track.external_urls?.spotify || null,
    },
  };
}

function saveUserPsnRegistration(member, username, platinumCount, trophyLevel = null) {
  psnRegistrations[member.id] = {
    discordTag: member.user.tag,
    username,
    platinumCount,
    trophyLevel,
    updatedAt: new Date().toISOString(),
  };
  setCachedProfileSummary(username, {
    username,
    platinumCount,
    trophyLevel,
  });

  savePsnRegistrations();
}

function formatRegistrationStat(value, fallback = 'Not available') {
  return value === null || value === undefined ? fallback : String(value);
}

async function notifyOwner(subject, details) {
  try {
    const owner = await client.users.fetch(OWNER_USER_ID);
    await owner.send(`**Jarvis Alert:** ${subject}\n${details}`);
  } catch (error) {
    console.error('Failed to send owner alert:', error.message);
  }
}

function getSessionRegistrationKey(guildId, messageId) {
  return `${guildId}:${messageId}`;
}

function registerSessionMessage({ guildId, messageId, channelId, hostId, reactEmoji, game, dateTime, notes }) {
  sessionRegistrations[getSessionRegistrationKey(guildId, messageId)] = {
    guildId,
    messageId,
    channelId,
    hostId,
    reactEmoji,
    game,
    dateTime,
    notes,
    updatedAt: new Date().toISOString(),
  };
  saveSessionRegistrations();
}

function getSessionRegistration(guildId, messageId) {
  return sessionRegistrations[getSessionRegistrationKey(guildId, messageId)] || null;
}

function getWheelLabel(type) {
  return 'movie wheel';
}

function normalizeWheelEntry(value) {
  return normalizeText(value).toLowerCase();
}

function addWheelEntry(type, value, userId) {
  const trimmedValue = normalizeText(value);

  if (!trimmedValue) {
    return { kind: 'invalid' };
  }

  const exists = wheels[type].some((entry) => normalizeWheelEntry(entry.title) === normalizeWheelEntry(trimmedValue));

  if (exists) {
    return { kind: 'duplicate', value: trimmedValue };
  }

  const currentUserEntries = wheels[type].filter((entry) => entry.addedBy === userId).length;

  if (currentUserEntries >= 3) {
    return { kind: 'limit', limit: 3 };
  }

  wheels[type].push({
    title: trimmedValue,
    addedBy: userId,
    addedAt: new Date().toISOString(),
  });
  saveWheels();
  return { kind: 'added', value: trimmedValue, size: wheels[type].length };
}

function removeWheelEntry(type, value) {
  const trimmedValue = normalizeText(value);
  const index = wheels[type].findIndex((entry) => normalizeWheelEntry(entry.title) === normalizeWheelEntry(trimmedValue));

  if (index === -1) {
    return { kind: 'missing', value: trimmedValue };
  }

  const [removed] = wheels[type].splice(index, 1);
  saveWheels();
  return { kind: 'removed', value: removed.title, size: wheels[type].length };
}

function spinWheel(type) {
  if (wheels[type].length === 0) {
    return { kind: 'empty' };
  }

  const index = Math.floor(Math.random() * wheels[type].length);
  const [picked] = wheels[type].splice(index, 1);
  saveWheels();
  return { kind: 'picked', value: picked.title, remaining: wheels[type].length };
}

function isSessionReactionTarget(reaction) {
  if (!reaction.message?.guildId || !reaction.message?.id) {
    return false;
  }

  const session = getSessionRegistration(reaction.message.guildId, reaction.message.id);

  if (!session) {
    return false;
  }

  return reaction.emoji.name === session.reactEmoji;
}

async function handleSessionReactionAccessChange(reaction, user, shouldHaveAccess) {
  if (user.bot) {
    return;
  }

  if (reaction.partial) {
    await reaction.fetch();
  }

  if (reaction.message.partial) {
    await reaction.message.fetch();
  }

  if (!reaction.message.guild || !isSessionReactionTarget(reaction)) {
    return;
  }

  const session = getSessionRegistration(reaction.message.guild.id, reaction.message.id);

  if (!session) {
    return;
  }

  const member = await reaction.message.guild.members.fetch(user.id);

  if (isAdminMember(member) || member.id === session.hostId) {
    return;
  }

  const channel = await reaction.message.guild.channels.fetch(session.channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('The session channel could not be found.');
  }

  if (shouldHaveAccess) {
    await channel.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }, {
      reason: `Joined ${session.game} session via reaction`,
    });
    return;
  }

  await channel.permissionOverwrites.delete(member.id, `Left ${session.game} session via reaction`).catch(() => null);
}

function isRulesReactionTarget(reaction) {
  return (
    reaction.message.channelId === RULES_CHANNEL_ID &&
    reaction.message.id === RULES_MESSAGE_ID &&
    reaction.emoji.name === RULES_ACCEPTED_EMOJI
  );
}

async function handleRulesReactionRoleChange(reaction, user, shouldHaveRole) {
  if (user.bot) {
    return;
  }

  if (reaction.partial) {
    await reaction.fetch();
  }

  if (reaction.message.partial) {
    await reaction.message.fetch();
  }

  if (!isRulesReactionTarget(reaction) || !reaction.message.guild) {
    return;
  }

  const rulesAcceptedRole = getRulesAcceptedRole(reaction.message.guild);

  if (!rulesAcceptedRole) {
    throw new Error(`The "${RULES_ACCEPTED_ROLE_NAME}" role was not found.`);
  }

  const member = await reaction.message.guild.members.fetch(user.id);

  if (shouldHaveRole) {
    if (!member.roles.cache.has(rulesAcceptedRole.id)) {
      await member.roles.add(rulesAcceptedRole, 'Accepted server rules via reaction role');
      member.roles.cache.set(rulesAcceptedRole.id, rulesAcceptedRole);
    }

    await syncMemberAccessRole(member);
    return;
  }

  if (member.roles.cache.has(rulesAcceptedRole.id)) {
    await member.roles.remove(rulesAcceptedRole, 'Removed server rules reaction');
    member.roles.cache.delete(rulesAcceptedRole.id);
  }

  await syncMemberAccessRole(member);
}

function getHunterRoleNames() {
  return HUNTER_RANKS.map((rank) => rank.name);
}

function memberHasAnyHunterRole(member) {
  return HUNTER_RANKS.some((rank) =>
    member.roles.cache.some((role) => role.name === rank.name)
  );
}

function getMemberHunterRoles(member) {
  return HUNTER_RANKS
    .map((rank) => member.guild.roles.cache.find((role) => role.name === rank.name))
    .filter((role) => role && member.roles.cache.has(role.id))
    .map((role) => role.name);
}

function getRulesAcceptedRole(guild) {
  return guild.roles.cache.find((role) => role.name === RULES_ACCEPTED_ROLE_NAME) || null;
}

function memberHasRulesAcceptedRole(member) {
  return member.roles.cache.some((role) => role.name === RULES_ACCEPTED_ROLE_NAME);
}

function getMemberAccessRole(guild) {
  return guild.roles.cache.get(MEMBER_ROLE_ID) || null;
}

function memberHasSavedRegistration(member) {
  const saved = psnRegistrations[member.id];
  return Boolean(saved && saved.username && (saved.platinumCount !== null || saved.trophyLevel !== null));
}

async function syncMemberAccessRole(member) {
  const accessRole = getMemberAccessRole(member.guild);

  if (!accessRole) {
    throw new Error('The main member access role was not found.');
  }

  const shouldHaveAccess = memberHasRulesAcceptedRole(member) && memberHasSavedRegistration(member);
  const hasAccess = member.roles.cache.has(accessRole.id);

  if (shouldHaveAccess && !hasAccess) {
    await member.roles.add(accessRole, 'Met onboarding requirements via Jarvis');
    return 'granted';
  }

  if (!shouldHaveAccess && hasAccess) {
    await member.roles.remove(accessRole, 'No longer meets onboarding requirements');
    return 'removed';
  }

  return 'unchanged';
}

function getAuditableMembers(guildMembers) {
  return guildMembers.filter(
    (member) =>
      !member.user.bot &&
      !isAdminMember(member) &&
      member.roles.cache.has(MEMBER_ROLE_ID)
  );
}

function getExcludedAccessMembers(guildMembers) {
  return guildMembers.filter(
    (member) =>
      member.roles.cache.has(MEMBER_ROLE_ID) &&
      (member.user.bot || isAdminMember(member))
  );
}

async function getAuditableMembersForGuild(guild) {
  const memberRole = guild.roles.cache.get(MEMBER_ROLE_ID);

  if (!memberRole) {
    throw new Error('The base member role for the audit was not found.');
  }

  const cachedEntry = auditMemberCache.get(guild.id);

    if (cachedEntry && Date.now() - cachedEntry.cachedAt <= AUDIT_MEMBER_CACHE_TTL_MS) {
      return {
        memberRole,
        eligibleMembers: cachedEntry.members,
        totalRoleMembers: memberRole.members.size,
        excludedMembers: getExcludedAccessMembers(memberRole.members),
        source: 'memory-cache',
      };
    }

    try {
      const members = await guild.members.fetch();
      const eligibleMembers = getAuditableMembers(members);
      const excludedMembers = getExcludedAccessMembers(members);

      auditMemberCache.set(guild.id, {
        members: eligibleMembers,
        cachedAt: Date.now(),
      });

      return {
        memberRole,
        eligibleMembers,
        totalRoleMembers: members.filter((member) => member.roles.cache.has(MEMBER_ROLE_ID)).size,
        excludedMembers,
        source: 'live-fetch',
      };
    } catch (error) {
    const canUseFallback =
      error.message.includes('opcode 8 was rate limited') ||
      error.message.includes('Members didn\'t arrive in time');

    if (!canUseFallback) {
      throw error;
    }

    const fallbackMembers =
      memberRole.members.size > 0 ? getAuditableMembers(memberRole.members) : getAuditableMembers(guild.members.cache);

      if (fallbackMembers.size > 0) {
        const fallbackSourceMembers = memberRole.members.size > 0 ? memberRole.members : guild.members.cache;
        const excludedMembers = getExcludedAccessMembers(fallbackSourceMembers);

        auditMemberCache.set(guild.id, {
          members: fallbackMembers,
          cachedAt: Date.now(),
        });

        return {
          memberRole,
          eligibleMembers: fallbackMembers,
          totalRoleMembers: fallbackSourceMembers.filter((member) => member.roles.cache.has(MEMBER_ROLE_ID)).size,
          excludedMembers,
          source: 'role-cache',
        };
      }

    throw error;
  }
}

function getHunterRank(trophyLevel) {
  return HUNTER_RANKS.find((rank) => trophyLevel >= rank.min && trophyLevel <= rank.max) || null;
}

async function assignHunterRank(member, trophyLevel) {
  const guildRoles = member.guild.roles.cache;
  const targetRank = getHunterRank(trophyLevel);

  if (!targetRank) {
    throw new Error(`No hunter rank found for trophy level ${trophyLevel}.`);
  }

  const targetRole = guildRoles.find((role) => role.name === targetRank.name);

  if (!targetRole) {
    throw new Error(`Role "${targetRank.name}" was not found in this server.`);
  }

  const rankRoles = HUNTER_RANKS
    .map((rank) => guildRoles.find((role) => role.name === rank.name))
    .filter(Boolean);

  const rolesToRemove = rankRoles.filter((role) => role.id !== targetRole.id && member.roles.cache.has(role.id));

  if (rolesToRemove.length > 0) {
    await member.roles.remove(rolesToRemove, 'Updating PSN hunter rank');
  }

  if (!member.roles.cache.has(targetRole.id)) {
    await member.roles.add(targetRole, 'Assigned PSN hunter rank');
  }

  return targetRank;
}

function createBaseEmbed(username, title) {
  return {
    color: EMBED_COLOR,
    title,
    url: buildProfileUrl(username),
    footer: {
      text: `PSNProfiles | ${username}`,
    },
    timestamp: new Date().toISOString(),
  };
}

function createTrophyFallbackEmbed(username, reason) {
  const description =
    reason === 'blocked'
      ? 'PSNProfiles is blocking the automated lookup right now, but you can still open the profile and trophy log below.'
      : 'I could not read the latest trophy entry right now, but the profile and trophy log links are still here.';

  return {
    ...createBaseEmbed(username, `${username}'s Trophy Links`),
    description,
    fields: [
      {
        name: 'Profile',
        value: `[Open profile](${buildProfileUrl(username)})`,
        inline: true,
      },
      {
        name: 'Trophy Log',
        value: `[Open trophy log](${buildLogUrl(username)})`,
        inline: true,
      },
      {
        name: 'PSN Card',
        value: `[Open card image](${buildCardUrl(username)})`,
        inline: false,
      },
    ],
    image: { url: buildCardUrl(username) },
  };
}

function createHelpEmbed() {
  return {
    color: EMBED_COLOR,
    title: 'Jarvis Commands',
    description: 'PSN registration, challenge tracking, PlayStation news, and staff tools for No BS Trophy Huntin.',
    fields: [
        {
          name: '!trophy [number] <username>',
          value: 'Shows the latest platinum, or a specific platinum number from PSN PlatHub.',
          inline: false,
        },
          {
            name: '!guide <game name>',
            value: 'Finds the best matching PowerPyx trophy guide.',
            inline: false,
          },
          {
            name: '!random <free|plus>',
            value: 'Suggests a random official free-to-play or PlayStation Plus game, filtered against your saved PSN registration when possible.',
            inline: false,
          },
          {
            name: '!movieadd / !movielist / !movieremove / !moviespin / !movieclear',
            value: 'Manages the shared movie wheel. Spinning is limited to the movie wheel role, and staff can clear the full wheel or one member’s entries.',
            inline: false,
          },
          {
            name: '!playlistsetup / !songadd / !playlistlink',
            value: 'Creates the server Spotify playlist, adds songs to it, and shows the playlist link.',
            inline: false,
          },
              {
                name: '!goty <username>',
                value: 'Shows the PSN PlatHub Game of the Year page summary for a player.',
                inline: false,
              },
        {
          name: '!az <username>',
          value: 'Shows the PSN PlatHub Alphabet Challenge summary for a player.',
          inline: false,
        },
        {
          name: '!psnews',
          value: 'Shows the latest official PlayStation Blog post.',
          inline: false,
        },
      {
        name: '!psplus',
        value: 'Shows the latest official PlayStation Plus monthly games post.',
        inline: false,
      },
        {
          name: '!shutdowns',
          value: 'Shows the latest server shutdown or delisting article Jarvis is tracking.',
          inline: false,
        },
        {
          name: '!registerpsn <username or link>',
          value: 'Checks your PSN profile through PSN PlatHub and assigns your hunter rank role automatically.',
          inline: false,
        },
      {
        name: '!whoisregistered [@user]',
        value: 'Admin only. Shows saved PSN registrations.',
        inline: false,
      },
        {
          name: '!audit',
          value: 'Admin only. Checks who is missing PSN registration or hunter roles.',
          inline: false,
        },
          {
            name: '!checkaccess @user',
            value: 'Admin only. Shows exactly which onboarding roles or registration steps a member is missing.',
            inline: false,
          },
          {
            name: '!refreshpsn @user',
            value: 'Admin only. Re-checks a saved PSN registration and refreshes the member\'s hunter role.',
            inline: false,
          },
          {
            name: '!session <game> | <date/time> | <react emoji> | <notes>',
            value: 'Admin only. Posts a boosting session embed and creates or reuses a matching session channel.',
            inline: false,
          },
          {
            name: '!remindpsn',
            value: 'Admin only. Tags members who still need to run `!registerpsn`.',
            inline: false,
          },
      {
        name: '!remindrules',
        value: 'Admin only. Tags members who are still missing the `Rules Accepted` role.',
        inline: false,
      },
      {
        name: '!resetaccess',
        value: 'Admin only. Removes `The Assassin Brotherhood` from non-staff members so Jarvis can re-grant it through onboarding.',
        inline: false,
      },
    
    ],
    footer: {
      text: 'Jarvis | PlayStation Trophy Assistant | Made for No BS Trophy Hunting by Sebastian A. |',
    },
    timestamp: new Date().toISOString(),
  };
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function trimText(text, maxLength) {
  const normalized = normalizeText(text);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function scorePowerPyxResult(title, query, preferredKeywords = []) {
  const normalizedTitle = title.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let score = 0;

  if (normalizedTitle.includes(normalizedQuery)) {
    score += 100;
  }

  for (const word of normalizedQuery.split(/\s+/)) {
    if (word && normalizedTitle.includes(word)) {
      score += 10;
    }
  }

  for (const keyword of preferredKeywords) {
    if (normalizedTitle.includes(keyword.toLowerCase())) {
      score += 35;
    }
  }

  return score;
}

async function searchPowerPyx(query) {
  const searchUrl = `${POWERPYX_BASE_URL}/?s=${encodeURIComponent(query)}`;
  const response = await axios.get(searchUrl, {
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const $ = cheerio.load(response.data);
  const seenLinks = new Set();
  const results = [];

  $('article, .post, .type-post').each((_, element) => {
    const article = $(element);
    const link = article.find('h2 a, h1 a, .entry-title a').first().attr('href');
    const title = normalizeText(article.find('h2, h1, .entry-title').first().text());
    const excerpt = normalizeText(article.find('.entry-summary, .post-excerpt, .entry-content').first().text());

    if (!link || !title || seenLinks.has(link)) {
      return;
    }

    seenLinks.add(link);
    results.push({ title, link, excerpt });
  });

  return results;
}

function findBestPowerPyxResult(results, query, preferredKeywords) {
  return [...results]
    .map((result) => ({
      ...result,
      score: scorePowerPyxResult(result.title, query, preferredKeywords),
    }))
    .sort((a, b) => b.score - a.score)[0];
}

function buildSessionChannelName(game) {
  return game
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'boost-session';
}

async function findOrCreateSessionChannel(guild, game, hostId) {
  const channelName = buildSessionChannelName(game);
  const existingChannel = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.parentId === BOOSTING_SESSIONS_CATEGORY_ID &&
      channel.name === channelName
  );

  if (existingChannel) {
    return { channel: existingChannel, created: false };
  }

  const createdChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: BOOSTING_SESSIONS_CATEGORY_ID,
    topic: `Boosting session channel for ${game}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: ['ViewChannel'],
      },
      {
        id: hostId,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
      },
      ...ADMIN_ROLE_IDS.map((roleId) => ({
        id: roleId,
        allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
      })),
    ],
    reason: 'Boosting session created via Jarvis',
  });

  return { channel: createdChannel, created: true };
}

async function fetchLatestPlayStationBlogPost() {
  const candidates = await fetchLatestPlayStationBlogPostCandidates();
  return candidates[0] || null;
}

async function fetchLatestPlayStationPlusPost() {
  const candidates = await fetchLatestPlayStationBlogPostCandidates();

  return (
    candidates.find((candidate) =>
      /^PlayStation Plus Monthly Games for /i.test(candidate.title)
    ) || null
  );
}

async function fetchLatestPlayStationBlogPostCandidates() {
  const response = await axios.get(PLAYSTATION_BLOG_BASE_URL, {
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const $ = cheerio.load(response.data);
  const candidates = [];

  $('a[href*="blog.playstation.com/20"], a[href^="/20"]').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    const title = normalizeText(anchor.text());

    if (!href || !title) {
      return;
    }

    const link = href.startsWith('http') ? href : new URL(href, PLAYSTATION_BLOG_BASE_URL).toString();
    const container = anchor.closest('article, section, div');
    const containerText = normalizeText(container.text());
    const excerpt = trimText(containerText.replace(title, '').trim(), 220);
    const dateMatch = containerText.match(/Date published:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    const imageSrc = container.find('img').first().attr('src');
    const imageUrl = imageSrc ? (imageSrc.startsWith('http') ? imageSrc : new URL(imageSrc, PLAYSTATION_BLOG_BASE_URL).toString()) : null;

    if (!candidates.some((candidate) => candidate.link === link)) {
      candidates.push({
        title,
        link,
        excerpt: excerpt || 'Open the official PlayStation Blog post for full details.',
        publishedDate: dateMatch ? dateMatch[1] : null,
        imageUrl,
      });
    }
  });

  return candidates;
}

async function checkAndPostLatestPlayStationNews({ initializeOnly = false } = {}) {
  const latestPost = await fetchLatestPlayStationBlogPost();

  if (!latestPost) {
    return;
  }

  const state = loadPlayStationNewsState();

  if (!state.lastPostedUrl) {
    savePlayStationNewsState({
      lastPostedUrl: latestPost.link,
      initializedAt: new Date().toISOString(),
    });
    return;
  }

  if (state.lastPostedUrl === latestPost.link || initializeOnly) {
    return;
  }

  const channel = await client.channels.fetch(PLAYSTATION_NEWS_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error('The PlayStation news channel could not be found or is not a text channel.');
  }

  await channel.send({
    embeds: [
      {
        color: EMBED_COLOR,
        title: latestPost.title,
        url: latestPost.link,
        description: latestPost.excerpt,
        image: latestPost.imageUrl ? { url: latestPost.imageUrl } : undefined,
        footer: {
          text: latestPost.publishedDate
            ? `Official PlayStation Blog | Published ${latestPost.publishedDate}`
            : 'Official PlayStation Blog',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  savePlayStationNewsState({
    lastPostedUrl: latestPost.link,
    postedAt: new Date().toISOString(),
  });
}

async function checkAndPostLatestPlayStationPlus({ initializeOnly = false } = {}) {
  const latestPost = await fetchLatestPlayStationPlusPost();

  if (!latestPost) {
    return;
  }

  const state = loadPlayStationPlusState();

  if (!state.lastPostedUrl) {
    savePlayStationPlusState({
      lastPostedUrl: latestPost.link,
      initializedAt: new Date().toISOString(),
    });
    return;
  }

  if (state.lastPostedUrl === latestPost.link || initializeOnly) {
    return;
  }

  const channel = await client.channels.fetch(PLAYSTATION_PLUS_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error('The PlayStation Plus channel could not be found or is not a text channel.');
  }

  await channel.send({
    embeds: [
      {
        color: EMBED_COLOR,
        title: latestPost.title,
        url: latestPost.link,
        description: latestPost.excerpt,
        image: latestPost.imageUrl ? { url: latestPost.imageUrl } : undefined,
        footer: {
          text: latestPost.publishedDate
            ? `Official PlayStation Blog | Published ${latestPost.publishedDate}`
            : 'Official PlayStation Blog',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  savePlayStationPlusState({
    lastPostedUrl: latestPost.link,
    postedAt: new Date().toISOString(),
  });
}

async function fetchLatestServerShutdownPostCandidates() {
  const response = await axios.get(`${PUSHSQUARE_BASE_URL}/news`, {
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const $ = cheerio.load(response.data);
  const candidates = [];

  $('article a, h2 a, h3 a').each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr('href');
    const title = normalizeText(anchor.text());

    if (!href || !title) {
      return;
    }

    if (!/(server shutdown|shutting down|shutdown and delisting|delisting plans|will be delisted|online services)/i.test(title)) {
      return;
    }

    const link = href.startsWith('http') ? href : new URL(href, PUSHSQUARE_BASE_URL).toString();
    const container = anchor.closest('article, section, div');
    const containerText = normalizeText(container.text());
    const excerpt = trimText(containerText.replace(title, '').trim(), 220);
    const imageSrc = container.find('img').first().attr('src');
    const imageUrl = imageSrc ? (imageSrc.startsWith('http') ? imageSrc : new URL(imageSrc, PUSHSQUARE_BASE_URL).toString()) : null;

    if (!candidates.some((candidate) => candidate.link === link)) {
      candidates.push({
        title,
        link,
        excerpt: excerpt || 'Open the article for full shutdown and delisting details.',
        imageUrl,
      });
    }
  });

  return candidates;
}

async function fetchLatestServerShutdownPost() {
  const candidates = await fetchLatestServerShutdownPostCandidates();
  return candidates[0] || null;
}

async function checkAndPostLatestServerShutdowns({ initializeOnly = false } = {}) {
  const latestPost = await fetchLatestServerShutdownPost();

  if (!latestPost) {
    return;
  }

  const state = loadServerShutdownsState();

  if (!state.lastPostedUrl) {
    saveServerShutdownsState({
      lastPostedUrl: latestPost.link,
      initializedAt: new Date().toISOString(),
    });
    return;
  }

  if (state.lastPostedUrl === latestPost.link || initializeOnly) {
    return;
  }

  const channel = await client.channels.fetch(SERVER_SHUTDOWNS_CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error('The server shutdowns channel could not be found or is not a text channel.');
  }

  await channel.send({
    embeds: [
      {
        color: EMBED_COLOR,
        title: latestPost.title,
        url: latestPost.link,
        description: latestPost.excerpt,
        image: latestPost.imageUrl ? { url: latestPost.imageUrl } : undefined,
        footer: {
          text: 'Push Square | Server Shutdowns / Delistings',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  saveServerShutdownsState({
    lastPostedUrl: latestPost.link,
    postedAt: new Date().toISOString(),
  });
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);

  setTimeout(() => {
    checkAndPostLatestPlayStationNews({ initializeOnly: true }).catch(async (error) => {
      console.error('Initial PlayStation news check failed:', error.message);
      await notifyOwner(
        'playstation news init failed',
        `Error: ${error.message}`
      );
    });

    checkAndPostLatestPlayStationPlus({ initializeOnly: true }).catch(async (error) => {
      console.error('Initial PlayStation Plus check failed:', error.message);
      await notifyOwner(
        'playstation plus init failed',
        `Error: ${error.message}`
      );
    });

    checkAndPostLatestServerShutdowns({ initializeOnly: true }).catch(async (error) => {
      console.error('Initial server shutdowns check failed:', error.message);
      await notifyOwner(
        'server shutdowns init failed',
        `Error: ${error.message}`
      );
    });
  }, 5000);

  setInterval(() => {
    checkAndPostLatestPlayStationNews().catch(async (error) => {
      console.error('PlayStation news poll failed:', error.message);
      await notifyOwner(
        'playstation news poll failed',
        `Error: ${error.message}`
      );
    });
  }, PLAYSTATION_NEWS_POLL_INTERVAL_MS);

  setInterval(() => {
    checkAndPostLatestPlayStationPlus().catch(async (error) => {
      console.error('PlayStation Plus poll failed:', error.message);
      await notifyOwner(
        'playstation plus poll failed',
        `Error: ${error.message}`
      );
    });
  }, PLAYSTATION_NEWS_POLL_INTERVAL_MS);

  setInterval(() => {
    checkAndPostLatestServerShutdowns().catch(async (error) => {
      console.error('Server shutdowns poll failed:', error.message);
      await notifyOwner(
        'server shutdowns poll failed',
        `Error: ${error.message}`
      );
    });
  }, PLAYSTATION_NEWS_POLL_INTERVAL_MS);
});

client.on('messageReactionAdd', async (reaction, user) => {
  try {
    await handleRulesReactionRoleChange(reaction, user, true);
    await handleSessionReactionAccessChange(reaction, user, true);
  } catch (error) {
    console.error('Reaction add handler failed:', error.message);
    await notifyOwner(
      'reaction add failed',
      `User: ${user.tag}\nChannel: ${reaction.message.channelId}\nMessage: ${reaction.message.id}\nError: ${error.message}`
    );
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  try {
    await handleRulesReactionRoleChange(reaction, user, false);
    await handleSessionReactionAccessChange(reaction, user, false);
  } catch (error) {
    console.error('Reaction remove handler failed:', error.message);
    await notifyOwner(
      'reaction remove failed',
      `User: ${user.tag}\nChannel: ${reaction.message.channelId}\nMessage: ${reaction.message.id}\nError: ${error.message}`
    );
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  if (command === '!help') {
    return message.reply({
      embeds: [createHelpEmbed()],
    });
  }

  if (command === '!psnews') {
    try {
      const latestPost = await fetchLatestPlayStationBlogPost();

      if (!latestPost) {
        return message.reply('I could not find the latest PlayStation Blog post right now.');
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: latestPost.title,
            url: latestPost.link,
            description: latestPost.excerpt,
            image: latestPost.imageUrl ? { url: latestPost.imageUrl } : undefined,
            footer: {
              text: latestPost.publishedDate
                ? `Official PlayStation Blog | Published ${latestPost.publishedDate}`
                : 'Official PlayStation Blog',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('psnews command failed:', error.message);
      return message.reply('I could not fetch the latest PlayStation news right now. Please try again in a moment.');
    }
  }

  if (command === '!psplus') {
    try {
      const latestPost = await fetchLatestPlayStationPlusPost();

      if (!latestPost) {
        return message.reply('I could not find the latest PlayStation Plus post right now.');
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: latestPost.title,
            url: latestPost.link,
            description: latestPost.excerpt,
            image: latestPost.imageUrl ? { url: latestPost.imageUrl } : undefined,
            footer: {
              text: latestPost.publishedDate
                ? `Official PlayStation Blog | Published ${latestPost.publishedDate}`
                : 'Official PlayStation Blog',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('psplus command failed:', error.message);
      return message.reply('I could not fetch the latest PlayStation Plus update right now. Please try again in a moment.');
    }
  }

  if (command === '!shutdowns') {
    try {
      const latestPost = await fetchLatestServerShutdownPost();

      if (!latestPost) {
        return message.reply('I could not find a recent server shutdown or delisting article right now.');
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: latestPost.title,
            url: latestPost.link,
            description: latestPost.excerpt,
            image: latestPost.imageUrl ? { url: latestPost.imageUrl } : undefined,
            footer: {
              text: 'Push Square | Server Shutdowns / Delistings',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('shutdowns command failed:', error.message);
      return message.reply('I could not fetch the latest server shutdown news right now. Please try again in a moment.');
    }
  }

  if (command === '!guide') {
    const query = args.slice(1).join(' ');

    if (!query) {
      return message.reply('Use: !guide <game name>');
    }

    try {
      const results = await searchPowerPyx(query);
      const guide = findBestPowerPyxResult(results, query, ['trophy guide', 'roadmap']);

      if (!guide || guide.score <= 0) {
        return message.reply(`I couldn't find a PowerPyx trophy guide for \`${query}\`.`);
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: guide.title,
            url: guide.link,
            description: guide.excerpt || `Open the PowerPyx guide for **${query}**.`,
            footer: {
              text: 'PowerPyx Guide Search',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('Error searching PowerPyx guide:', error.message);
      return message.reply('I could not reach PowerPyx right now. Please try again in a moment.');
    }
  }

  if (command === '!playlistsetup') {
    if (!isAdminMember(message.member)) {
      return message.reply('Only Executive Officers and The Mechanic can set up the Spotify playlist.');
    }

    if (!isSpotifyConfigured()) {
      return message.reply('Spotify is not configured yet. Add `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN` in Railway first.');
    }

    const playlistName = message.content.slice(command.length).trim() || DEFAULT_SPOTIFY_PLAYLIST_NAME;

    try {
      const playlist = await ensureSpotifyPlaylist(playlistName);

      return message.reply({
        embeds: [
          {
            color: 0x1db954,
            title: 'Spotify Playlist Ready',
            description: `Jarvis is now connected to **${playlist.playlistName || playlistName}**.`,
            fields: [
              {
                name: 'Playlist',
                value: playlist.playlistName || playlistName,
                inline: false,
              },
              {
                name: 'Open Playlist',
                value: playlist.playlistUrl ? `[Open on Spotify](${playlist.playlistUrl})` : 'Not available',
                inline: false,
              },
            ],
            footer: {
              text: 'Jarvis | Spotify Playlist Setup',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('playlistsetup command failed:', error.message);
      await notifyOwner(
        'spotify playlist setup failed',
        `User: ${message.author.tag}\nError: ${error.message}`
      );
      return message.reply('I could not create or connect the Spotify playlist right now. Please check the Spotify setup and try again.');
    }
  }

  if (command === '!songadd') {
    const query = message.content.slice(command.length).trim();

    if (!query) {
      return message.reply('Use: !songadd <song name or song - artist>');
    }

    if (!isSpotifyConfigured()) {
      return message.reply('Spotify is not configured yet, so I cannot add songs right now.');
    }

    try {
      const result = await addTrackToSpotifyPlaylist(query);

      if (result.kind === 'not_found') {
        return message.reply(`I could not find a Spotify track for \`${query}\`.`);
      }

      const artistLine = result.track.artists.length ? result.track.artists.join(', ') : 'Unknown artist';

      return message.reply({
        embeds: [
          {
            color: 0x1db954,
            title: 'Song Added to Playlist',
            description: `Jarvis added **${result.track.name}** to the server playlist.`,
            url: result.track.url || undefined,
            fields: [
              {
                name: 'Track',
                value: result.track.name,
                inline: false,
              },
              {
                name: 'Artist',
                value: artistLine,
                inline: false,
              },
              {
                name: 'Album',
                value: result.track.album || 'Not available',
                inline: false,
              },
              {
                name: 'Playlist',
                value: result.playlist.playlistUrl ? `[Open playlist](${result.playlist.playlistUrl})` : (result.playlist.playlistName || 'Configured playlist'),
                inline: false,
              },
            ],
            footer: {
              text: 'Jarvis | Spotify Playlist',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('songadd command failed:', error.message);
      await notifyOwner(
        'spotify song add failed',
        `User: ${message.author.tag}\nQuery: ${query}\nError: ${error.message}`
      );
      return message.reply('I could not add that song to Spotify right now. Please try again in a moment.');
    }
  }

  if (command === '!playlistlink') {
    if (!spotifyPlaylistState.playlistUrl) {
      return message.reply('The Spotify playlist has not been set up yet.');
    }

    return message.reply({
      embeds: [
        {
          color: 0x1db954,
          title: spotifyPlaylistState.playlistName || 'Server Spotify Playlist',
          description: 'Open the server playlist on Spotify.',
          url: spotifyPlaylistState.playlistUrl,
          fields: [
            {
              name: 'Playlist Link',
              value: `[Open on Spotify](${spotifyPlaylistState.playlistUrl})`,
              inline: false,
            },
          ],
          footer: {
            text: 'Jarvis | Spotify Playlist',
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  if (command === '!random') {
    const mode = (args[1] || '').toLowerCase();

    if (!['free', 'plus'].includes(mode)) {
      return message.reply('Use: !random <free|plus>');
    }

    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    try {
      const saved = psnRegistrations[message.author.id];

      if (!saved?.username) {
        return message.reply('Please use `!registerpsn <username or link>` first so Jarvis knows which PSN profile to use.');
      }

      const [sourceResult, plattedTitles] = await Promise.all([
        mode === 'free' ? fetchOfficialFreeToPlayTitles() : fetchOfficialPlayStationPlusTitles(),
        fetchUserPlatinumTitles(saved.username).catch(() => new Set()),
      ]);
      const sourceTitles = sourceResult.titles || [];

      if (!sourceTitles.length) {
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'Random Suggestion Parsed Incompletely',
              description: `Jarvis reached the official ${mode === 'free' ? 'free-to-play' : 'PlayStation Plus'} source, but could not read the game list cleanly yet.`,
              fields: [
                {
                  name: 'Source',
                  value: mode === 'free' ? 'Official PlayStation Store Collections' : 'Official PlayStation Plus Games',
                  inline: true,
                },
                {
                  name: 'Page',
                  value: `[Open source](${mode === 'free' ? PLAYSTATION_STORE_COLLECTIONS_URL : PLAYSTATION_PLUS_GAMES_URL})`,
                  inline: false,
                },
                {
                  name: 'Text Snippet',
                  value: sourceResult.textSnippet ? `\`${trimText(sourceResult.textSnippet, 180)}\`` : 'None',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | Random Suggestion Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      const filteredTitles = sourceTitles.filter((title) => !plattedTitles.has(title.toLowerCase()));
      const candidateTitles = filteredTitles.length > 0 ? filteredTitles : sourceTitles;
      const selectedTitle = candidateTitles[Math.floor(Math.random() * candidateTitles.length)];
      const sourceLabel = mode === 'free' ? 'Official PlayStation Store Free-to-Play' : 'Official PlayStation Plus Catalog';
      const sourceUrl = mode === 'free' ? PLAYSTATION_STORE_COLLECTIONS_URL : PLAYSTATION_PLUS_GAMES_URL;

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Random Game Suggestion',
            url: sourceUrl,
            description: `Jarvis picked **${selectedTitle}** for **${saved.username}**.`,
            fields: [
              {
                name: 'Source',
                value: sourceLabel,
                inline: true,
              },
              {
                name: 'Filter',
                value: filteredTitles.length > 0 ? 'Excluded games you already appear to have platted' : 'No platinum exclusions were available',
                inline: true,
              },
              {
                name: 'Suggestion',
                value: selectedTitle,
                inline: false,
              },
            ],
            footer: {
              text: 'Jarvis | Random Backlog Suggestion',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('random command failed:', error.message);
      await notifyOwner(
        'random failed',
        `User: ${message.author.tag}\nMode: ${mode}\nError: ${error.message}`
      );
      return message.reply('I could not build a random suggestion right now. Please try again in a moment.');
    }
  }

  if (command === '!movieadd') {
    const type = 'movies';
    const value = message.content.slice(command.length).trim();

    if (!value) {
      return message.reply(`Use: \`${command} <title>\``);
    }

      const result = addWheelEntry(type, value, message.author.id);

    if (result.kind === 'invalid') {
      return message.reply(`Please provide a valid title for the ${getWheelLabel(type)}.`);
    }

      if (result.kind === 'duplicate') {
        return message.reply(`**${result.value}** is already in the ${getWheelLabel(type)}.`);
      }

      if (result.kind === 'limit') {
        return message.reply(`You can only have **${result.limit}** entries in the ${getWheelLabel(type)} at one time.`);
      }

    return message.reply(`Added **${result.value}** to the ${getWheelLabel(type)}. Current total: **${result.size}**.`);
  }

  if (command === '!movielist') {
    const type = 'movies';
    const entries = wheels[type];

    if (entries.length === 0) {
      return message.reply(`The ${getWheelLabel(type)} is currently empty.`);
    }

    return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Movie Wheel',
            description: entries.slice(0, 25).map((entry, index) => `${index + 1}. ${entry.title}`).join('\n'),
            footer: {
              text: entries.length > 25
                ? `Jarvis | Showing 25 of ${entries.length} entries`
                : `Jarvis | ${entries.length} entries`,
            },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  if (command === '!movieremove') {
    const type = 'movies';
    const value = message.content.slice(command.length).trim();

    if (!value) {
      return message.reply(`Use: \`${command} <title>\``);
    }

    const result = removeWheelEntry(type, value);

    if (result.kind === 'missing') {
      return message.reply(`I could not find **${result.value}** in the ${getWheelLabel(type)}.`);
    }

    return message.reply(`Removed **${result.value}** from the ${getWheelLabel(type)}. Remaining: **${result.size}**.`);
  }

  if (command === '!moviespin') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside the server.');
    }

    if (!canSpinMovieWheel(message.member)) {
      return message.reply('You do not have permission to spin the movie wheel.');
    }

    const type = 'movies';
    const result = spinWheel(type);

    if (result.kind === 'empty') {
      return message.reply(`The ${getWheelLabel(type)} is currently empty.`);
    }

    return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Movie Wheel Picked',
            description: `Jarvis picked **${result.value}**.`,
          fields: [
            {
              name: 'Picked',
              value: result.value,
              inline: false,
            },
            {
              name: 'Remaining Entries',
              value: String(result.remaining),
              inline: true,
            },
            {
              name: 'Status',
              value: 'Removed from the wheel',
              inline: true,
            },
          ],
          footer: {
            text: 'Jarvis | Wheel Spin',
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  if (command === '!movieclear') {
    if (!isAdminMember(message.member)) {
      return message.reply('Only Executive Officers and The Mechanic can clear the movie wheel.');
    }

    const type = 'movies';
    const targetMember = message.mentions.members.first();

    if (targetMember) {
      const beforeCount = wheels[type].length;
      wheels[type] = wheels[type].filter((entry) => entry.addedBy !== targetMember.id);
      const clearedCount = beforeCount - wheels[type].length;

      if (clearedCount === 0) {
        return message.reply(`I could not find any entries from ${targetMember}.`);
      }

      saveWheels();
      return message.reply(`Cleared **${clearedCount}** entr${clearedCount === 1 ? 'y' : 'ies'} from ${targetMember}'s movie wheel entries.`);
    }

    const clearedCount = wheels[type].length;

    if (clearedCount === 0) {
      return message.reply(`The ${getWheelLabel(type)} is already empty.`);
    }

    wheels[type] = [];
    saveWheels();

    return message.reply(`Cleared **${clearedCount}** entr${clearedCount === 1 ? 'y' : 'ies'} from the ${getWheelLabel(type)}.`);
  }

  if (command === '!goty') {
    const username = args[1];

    if (!username) {
      return message.reply('Use: !goty <psnprofiles-username>');
    }

    try {
      const result = await fetchGameOfYear(username);

      if (result.kind === 'not_found') {
        return message.reply(`PSN PlatHub page for \`${username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'Game Of The Year Blocked',
              description: `Jarvis could not reach the PSN PlatHub Game of the Year page for **${username}** right now.`,
              fields: [
                {
                  name: 'Provider',
                  value: 'PSN PlatHub',
                  inline: true,
                },
                {
                  name: 'Status',
                  value: String(result.status || 'Unknown'),
                  inline: true,
                },
                {
                  name: 'Title',
                  value: result.title || 'Unknown',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | GOTY Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      if (result.kind === 'parse_error') {
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'Game Of The Year Parsed Incompletely',
              description: `Jarvis reached the PSN PlatHub Game of the Year page for **${username}**, but needs one more parser pass to read it cleanly.`,
              fields: [
                {
                  name: 'Provider',
                  value: 'PSN PlatHub',
                  inline: true,
                },
                {
                  name: 'Page',
                  value: `[Open page](${result.gotyUrl || `${PSN_PLATHUB_BASE_URL}/game-of-the-year?psnId=${encodeURIComponent(username)}`})`,
                  inline: false,
                },
                {
                  name: 'Text Snippet',
                  value: result.textSnippet ? `\`${trimText(result.textSnippet, 180)}\`` : 'None',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | GOTY Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: result.goty.title,
            url: result.goty.url,
            description: `Game of the Year challenge progress for **${username}**`,
            fields: [
              {
                name: 'Progress',
                value: result.goty.challengeLine,
                inline: false,
              },
              {
                name: 'Recent Entries',
                value:
                  result.goty.entries && result.goty.entries.length > 0
                    ? result.goty.entries
                        .map((entry) => `${entry.year} - ${entry.game} (${entry.status})`)
                        .join('\n')
                    : 'Open the PSN PlatHub page to view the full challenge list.',
                inline: false,
              },
            ],
            image: result.goty.imageUrl ? { url: result.goty.imageUrl } : undefined,
            footer: {
              text: `PSN PlatHub GOTY | ${username}`,
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('Error fetching Game of the Year page:', error.message);
      await notifyOwner(
        'goty failed',
        `User: ${message.author.tag}\nUsername: ${username}\nError: ${error.message}`
      );
      return message.reply('Something went wrong while checking the PSN PlatHub Game of the Year page. Please try again.');
    }
  }

  if (command === '!az') {
    const username = args[1];

    if (!username) {
      return message.reply('Use: !az <psnprofiles-username>');
    }

    try {
      const result = await fetchAlphabetChallenge(username);

      if (result.kind === 'not_found') {
        return message.reply(`PSN PlatHub page for \`${username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'Alphabet Challenge Blocked',
              description: `Jarvis could not reach the PSN PlatHub Alphabet Challenge page for **${username}** right now.`,
              fields: [
                {
                  name: 'Provider',
                  value: 'PSN PlatHub',
                  inline: true,
                },
                {
                  name: 'Status',
                  value: String(result.status || 'Unknown'),
                  inline: true,
                },
                {
                  name: 'Title',
                  value: result.title || 'Unknown',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | Alphabet Challenge Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      if (result.kind === 'parse_error') {
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'Alphabet Challenge Parsed Incompletely',
              description: `Jarvis reached the PSN PlatHub Alphabet Challenge page for **${username}**, but needs one more parser pass to read it cleanly.`,
              fields: [
                {
                  name: 'Provider',
                  value: 'PSN PlatHub',
                  inline: true,
                },
                {
                  name: 'Page',
                  value: `[Open page](${result.alphabetUrl || `${PSN_PLATHUB_BASE_URL}/alphabet?psnId=${encodeURIComponent(username)}`})`,
                  inline: false,
                },
                {
                  name: 'Text Snippet',
                  value: result.textSnippet ? `\`${trimText(result.textSnippet, 180)}\`` : 'None',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | Alphabet Challenge Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: result.alphabet.title,
            url: result.alphabet.url,
            description: `Alphabet challenge progress for **${username}**`,
            fields: [
              {
                name: 'Progress',
                value: result.alphabet.challengeLine,
                inline: false,
              },
              {
                name: 'Covered Letters',
                value:
                  result.alphabet.coveredLetters && result.alphabet.coveredLetters.length > 0
                    ? result.alphabet.coveredLetters.join(', ')
                    : 'Not available',
                inline: false,
              },
              {
                name: 'Missing Letters',
                value:
                  result.alphabet.missingLetters && result.alphabet.missingLetters.length > 0
                    ? result.alphabet.missingLetters.join(', ')
                    : 'None',
                inline: false,
              },
            ],
            image: result.alphabet.imageUrl ? { url: result.alphabet.imageUrl } : undefined,
            footer: {
              text: `PSN PlatHub Alphabet | ${username}`,
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('Error fetching Alphabet Challenge page:', error.message);
      await notifyOwner(
        'az failed',
        `User: ${message.author.tag}\nUsername: ${username}\nError: ${error.message}`
      );
      return message.reply('Something went wrong while checking the PSN PlatHub Alphabet Challenge page. Please try again.');
    }
  }

  if (command === '!registerpsn') {
    const input = args.slice(1).join(' ');
    const username = extractPsnUsername(input);

    if (!username) {
      return message.reply('Use: !registerpsn <psnprofiles-username-or-link>');
    }

    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    try {
      const member = await message.guild.members.fetch(message.author.id);
      const result = await fetchPsnProfileSummaryWithRetry(username);

        if (result.kind === 'not_found') {
          return message.reply(`PSN PlatHub user \`${username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        console.error(`Profile lookup blocked for ${username}. Provider: ${result.provider || 'unknown'}. Status: ${result.status}. Title: ${result.title || 'Unknown'}`);
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'Profile Check Blocked',
              description: `Jarvis could not finish the profile check for **${username}**.`,
              fields: [
                {
                  name: 'Provider',
                  value: result.provider === 'psnplathub' ? 'PSN PlatHub' : result.provider === 'psnprofiles' ? 'PSNProfiles' : 'Unknown',
                  inline: true,
                },
                {
                  name: 'Status',
                  value: String(result.status || 'Unknown'),
                  inline: true,
                },
                {
                  name: 'Title',
                  value: result.title || 'Unknown',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | Registration Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      if (result.kind === 'parse_error') {
        return message.reply({
          embeds: [
            {
  color: 0xff9900,
  title: 'Profile Parsed Incompletely',
  description: `Jarvis reached **${username}** on PSN PlatHub, but no usable public trophy data was available. Make sure your trophies are synced and visible in your privacy settings, then try again.`,

              fields: [
                {
                  name: 'Provider',
                  value: 'PSN PlatHub',
                  inline: true,
                },
                {
                  name: 'Platinums',
                  value: formatRegistrationStat(result.profile?.platinumCount),
                  inline: true,
                },
                {
                  name: 'Trophy Level',
                  value: formatRegistrationStat(result.profile?.trophyLevel),
                  inline: true,
                },
                {
                  name: 'Debug Pattern',
                  value: result.profile?.matchedPattern ? `\`${trimText(result.profile.matchedPattern, 100)}\`` : 'None',
                  inline: false,
                },
                {
                  name: 'Text Snippet',
                  value: result.profile?.textSnippet ? `\`${trimText(result.profile.textSnippet, 180)}\`` : 'None',
                  inline: false,
                },
              ],
              footer: {
                text: 'Jarvis | Registration Debug',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      let rank = null;

      if (result.profile.trophyLevel !== null && result.profile.trophyLevel !== undefined) {
        rank = await assignHunterRank(member, result.profile.trophyLevel);
      }

      saveUserPsnRegistration(
        member,
        result.profile.username,
        result.profile.platinumCount ?? null,
        result.profile.trophyLevel ?? null
      );
      const accessRoleChange = await syncMemberAccessRole(member);
      const fetchedFrom =
        result.source === 'cache'
          ? 'Cached profile'
          : result.source === 'retry'
            ? 'Fetched after retry'
            : 'Live profile';
      const providerLabel =
        result.provider === 'psnplathub'
          ? 'PSN PlatHub'
          : result.provider === 'psnprofiles'
            ? 'PSNProfiles'
            : 'Saved data';

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Hunter Rank Updated',
            url: buildProfileUrl(result.profile.username),
            description: `Jarvis checked **${result.profile.username}** and updated your hunter rank.`,
            fields: [
              {
                name: 'PSNProfiles',
                value: `[Open profile](${buildProfileUrl(result.profile.username)})`,
                inline: false,
              },
              {
                name: 'Platinums',
                value: formatRegistrationStat(result.profile.platinumCount),
                inline: true,
              },
              {
                name: 'Assigned Role',
                value: rank ? rank.name : 'Not assigned',
                inline: true,
              },
              {
                name: 'Server Access',
                value:
                  accessRoleChange === 'granted'
                    ? 'The Assassin Brotherhood granted'
                    : member.roles.cache.has(MEMBER_ROLE_ID)
                      ? 'Already granted'
                      : 'Waiting for Rules Accepted',
                inline: true,
              },
              {
                name: 'Trophy Level',
                value: formatRegistrationStat(result.profile.trophyLevel),
                inline: true,
              },
              {
                name: 'Rank Basis',
                value: 'Trophy Level',
                inline: true,
              },
              {
                name: 'Saved',
                value: 'Yes',
                inline: true,
              },
              {
                name: 'Source',
                value: fetchedFrom,
                inline: true,
              },
              {
                name: 'Provider',
                value: providerLabel,
                inline: true,
              },
              {
                name: 'Debug Pattern',
                value: result.profile.matchedPattern ? `\`${trimText(result.profile.matchedPattern, 100)}\`` : 'None',
                inline: false,
              },
            ],
            thumbnail: { url: buildCardUrl(result.profile.username) },
            footer: {
              text: 'Jarvis | Automatic Hunter Rank',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      if (
        error.message.includes('Role "') ||
        error.message.includes('Missing Permissions') ||
        error.message.includes('Missing Access')
      ) {
        console.error('Role assignment failed:', error.message);
        await notifyOwner(
          'Role assignment failed',
          `User: ${message.author.tag}\nUsername: ${username}\nError: ${error.message}`
        );
        return message.reply('I could read the profile, but I could not assign the hunter rank role. Please check that all hunter roles exist and that Jarvis can manage them.');
      }

      console.error('Error registering PSN profile:', error.message);
      await notifyOwner(
        'registerpsn failed',
        `User: ${message.author.tag}\nUsername: ${username}\nError: ${error.message}`
      );
      return message.reply('Something went wrong while checking your PSNProfiles account. Please try again.');
    }
  }

  if (command === '!whoisregistered') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    const target = message.mentions.users.first();

    if (!target) {
      const entries = Object.entries(psnRegistrations);

      if (entries.length === 0) {
        return message.reply('No PSNProfiles registrations have been saved yet.');
      }

      const lines = entries
        .sort(([, a], [, b]) => a.username.localeCompare(b.username))
        .slice(0, 20)
        .map(([userId, saved]) => `<@${userId}> -> **${saved.username}** (${formatRegistrationStat(saved.platinumCount, '?')} plats, level ${formatRegistrationStat(saved.trophyLevel, '?')})`);

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Saved PSN Registrations',
            description: lines.join('\n'),
            footer: {
              text: entries.length > 20
                ? `Jarvis | Showing 20 of ${entries.length} saved registrations`
                : `Jarvis | ${entries.length} saved registrations`,
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }

    const saved = psnRegistrations[target.id];

    if (!saved) {
      return message.reply(`No saved PSNProfiles registration was found for **${target.tag}**.`);
    }

    return message.reply({
      embeds: [
        {
          color: EMBED_COLOR,
          title: 'Saved PSN Registration',
          url: buildProfileUrl(saved.username),
          description: `Jarvis has stored a PSNProfiles registration for **${target.tag}**.`,
          fields: [
            {
              name: 'PSN Username',
              value: saved.username,
              inline: true,
            },
            {
              name: 'Last Saved Platinum Count',
              value: formatRegistrationStat(saved.platinumCount),
              inline: true,
            },
            {
              name: 'Last Saved Trophy Level',
              value: formatRegistrationStat(saved.trophyLevel),
              inline: true,
            },
            {
              name: 'Updated At',
              value: saved.updatedAt,
              inline: false,
            },
          ],
          footer: {
            text: 'Jarvis | Admin Registration Check',
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
  }

  if (command === '!audit') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    try {
        const { memberRole, eligibleMembers, totalRoleMembers, excludedMembers, source } = await getAuditableMembersForGuild(message.guild);
        const rulesAcceptedRole = getRulesAcceptedRole(message.guild);

      const missingRegistration = [];
      const missingHunterRole = [];
      const missingRulesAccepted = [];

      for (const member of eligibleMembers.values()) {
        const saved = psnRegistrations[member.id];

        if (!saved) {
          missingRegistration.push(member);
        }

        if (!memberHasAnyHunterRole(member)) {
          missingHunterRole.push(member);
        }

        if (rulesAcceptedRole && !memberHasRulesAcceptedRole(member)) {
          missingRulesAccepted.push(member);
        }
      }

      const formatMemberList = (list) => {
        if (list.length === 0) {
          return 'None';
        }

        const visibleMembers = list
          .slice(0, 20)
          .map((member) => member.toString())
          .join(', ');
        const hiddenCount = list.length - 20;

        if (hiddenCount > 0) {
          return `${visibleMembers}\n+ ${hiddenCount} more not shown`;
        }

        return visibleMembers;
      };

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Jarvis Audit Report',
            description: `Checked **${eligibleMembers.size}** non-staff members with the **${memberRole.name}** role (**${totalRoleMembers}** total role holders, **${excludedMembers.size}** excluded as staff/bots).`,
            fields: [
              {
                name: 'Access Holders Missing PSN Registration',
                value: formatMemberList(missingRegistration),
                inline: false,
              },
              {
                name: 'Access Holders Missing Hunter Role',
                value: formatMemberList(missingHunterRole),
                inline: false,
              },
              {
                name: 'Access Holders Missing Rules Accepted',
                value: rulesAcceptedRole ? formatMemberList(missingRulesAccepted) : 'The Rules Accepted role was not found.',
                inline: false,
              },
              {
                name: 'Hunter Roles Checked',
                value: getHunterRoleNames().join(', '),
                inline: false,
              },
            ],
            footer: {
              text:
                missingRegistration.length > 20 || missingHunterRole.length > 20 || missingRulesAccepted.length > 20
                  ? 'Jarvis | Lists are capped at 20 members in the embed'
                  : source === 'role-cache' || source === 'memory-cache'
                    ? 'Jarvis | Admin audit using cached member data'
                    : 'Jarvis | Admin audit',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('Audit command failed:', error.message);
      await notifyOwner(
        'audit failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while running the audit: ${error.message}`);
    }
  }

  if (command === '!checkaccess') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    const target = message.mentions.members.first();

    if (!target) {
      return message.reply('Use: !checkaccess @user');
    }

    try {
      const saved = psnRegistrations[target.id] || null;
      const rulesAccepted = memberHasRulesAcceptedRole(target);
      const accessRole = getMemberAccessRole(message.guild);
      const hasAccessRole = accessRole ? target.roles.cache.has(accessRole.id) : false;
      const currentHunterRoles = getMemberHunterRoles(target);
      const expectedHunterRank =
        saved?.trophyLevel !== null && saved?.trophyLevel !== undefined
          ? getHunterRank(saved.trophyLevel)
          : null;
      const missingItems = [];

      if (!rulesAccepted) {
        missingItems.push('Rules Accepted');
      }

      if (!memberHasSavedRegistration(target)) {
        missingItems.push('PSN Registration');
      }

      if (!memberHasAnyHunterRole(target)) {
        missingItems.push('Hunter Role');
      }

      if (!hasAccessRole) {
        missingItems.push('The Assassin Brotherhood');
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'Access Check',
            description: `Jarvis checked ${target} for onboarding and access requirements.`,
            fields: [
              {
                name: 'Rules Accepted',
                value: rulesAccepted ? 'Yes' : 'No',
                inline: true,
              },
              {
                name: 'PSN Registration',
                value: memberHasSavedRegistration(target) ? 'Yes' : 'No',
                inline: true,
              },
              {
                name: 'Server Access',
                value: hasAccessRole ? 'Granted' : 'Not granted',
                inline: true,
              },
              {
                name: 'Saved PSN Username',
                value: saved?.username || 'Not saved',
                inline: true,
              },
              {
                name: 'Saved Trophy Level',
                value: formatRegistrationStat(saved?.trophyLevel),
                inline: true,
              },
              {
                name: 'Saved Platinums',
                value: formatRegistrationStat(saved?.platinumCount),
                inline: true,
              },
              {
                name: 'Current Hunter Role',
                value: currentHunterRoles.length > 0 ? currentHunterRoles.join(', ') : 'None',
                inline: false,
              },
              {
                name: 'Expected Hunter Role',
                value: expectedHunterRank ? expectedHunterRank.name : 'Not available',
                inline: false,
              },
              {
                name: 'Missing Requirements',
                value: missingItems.length > 0 ? missingItems.join(', ') : 'None',
                inline: false,
              },
            ],
            footer: {
              text: 'Jarvis | Access Troubleshooting',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('checkaccess command failed:', error.message);
      await notifyOwner(
        'checkaccess failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nTarget: ${target.user.tag}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while checking that member's access: ${error.message}`);
    }
  }

  if (command === '!refreshpsn') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    const target = message.mentions.members.first();

    if (!target) {
      return message.reply('Use: !refreshpsn @user');
    }

    try {
      const saved = psnRegistrations[target.id];

      if (!saved?.username) {
        return message.reply(`Jarvis does not have a saved PSN registration for ${target}.`);
      }

      const result = await fetchPsnProfileSummaryWithRetry(saved.username);

      if (result.kind === 'not_found') {
        return message.reply(`PSN PlatHub user \`${saved.username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        return message.reply({
          embeds: [
            {
              color: 0xff9900,
              title: 'PSN Refresh Blocked',
              description: `Jarvis could not refresh the PSN profile for ${target} right now.`,
              fields: [
                {
                  name: 'PSN Username',
                  value: saved.username,
                  inline: true,
                },
                {
                  name: 'Provider',
                  value: result.provider === 'psnplathub' ? 'PSN PlatHub' : result.provider === 'psnprofiles' ? 'PSNProfiles' : 'Unknown',
                  inline: true,
                },
                {
                  name: 'Status',
                  value: String(result.status || 'Unknown'),
                  inline: true,
                },
              ],
              footer: {
                text: 'Jarvis | Admin PSN Refresh',
              },
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }

      if (result.kind === 'parse_error') {
        return message.reply(`Jarvis reached **${saved.username}**, but could not turn the latest profile data into usable stats.`);
      }

      let rank = null;

      if (result.profile.trophyLevel !== null && result.profile.trophyLevel !== undefined) {
        rank = await assignHunterRank(target, result.profile.trophyLevel);
      }

      saveUserPsnRegistration(
        target,
        result.profile.username,
        result.profile.platinumCount,
        result.profile.trophyLevel ?? null
      );

      const accessStatus = await syncMemberAccessRole(target);
      const fetchedFrom =
        result.source === 'cache'
          ? 'Cached profile'
          : result.source === 'retry'
            ? 'Fetched after retry'
            : 'Live profile';
      const providerLabel =
        result.provider === 'psnplathub'
          ? 'PSN PlatHub'
          : result.provider === 'psnprofiles'
            ? 'PSNProfiles'
            : 'Unknown';

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: 'PSN Registration Refreshed',
            url: buildProfileUrl(result.profile.username),
            description: `Jarvis refreshed the saved PSN registration for ${target}.`,
            fields: [
              {
                name: 'PSN Username',
                value: result.profile.username,
                inline: true,
              },
              {
                name: 'Platinums',
                value: formatRegistrationStat(result.profile.platinumCount),
                inline: true,
              },
              {
                name: 'Trophy Level',
                value: formatRegistrationStat(result.profile.trophyLevel),
                inline: true,
              },
              {
                name: 'Hunter Role',
                value: rank ? rank.name : 'Not updated',
                inline: true,
              },
              {
                name: 'Server Access',
                value:
                  accessStatus === 'granted'
                    ? 'Granted'
                    : accessStatus === 'removed'
                      ? 'Removed'
                      : target.roles.cache.has(MEMBER_ROLE_ID)
                        ? 'Already granted'
                        : 'Waiting for Rules Accepted',
                inline: true,
              },
              {
                name: 'Provider',
                value: providerLabel,
                inline: true,
              },
              {
                name: 'Source',
                value: fetchedFrom,
                inline: true,
              },
            ],
            footer: {
              text: 'Jarvis | Admin PSN Refresh',
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      console.error('refreshpsn command failed:', error.message);
      await notifyOwner(
        'refreshpsn failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nTarget: ${target.user.tag}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while refreshing that PSN registration: ${error.message}`);
    }
  }

  if (command === '!session') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    const rawInput = message.content.slice('!session'.length).trim();
    const parts = rawInput.split('|').map((part) => part.trim());

    if (parts.length < 4 || parts.some((part) => !part)) {
      return message.reply('Use: !session <game> | <date/time> | <react emoji> | <notes>');
    }

    const [game, dateTime, reactEmoji, notes] = parts;

    try {
        const { channel, created } = await findOrCreateSessionChannel(message.guild, game, message.author.id);

        const reply = await message.reply({
          content: `${message.author}`,
          embeds: [
          {
            color: EMBED_COLOR,
            title: `${game} Boost Session`,
            description: `Jarvis has scheduled a boosting session for **${game}**.`,
            fields: [
              {
                name: 'Date / Time',
                value: dateTime,
                inline: true,
              },
              {
                name: 'React To Join',
                value: reactEmoji,
                inline: true,
              },
              {
                name: 'Session Channel',
                value: `${channel}`,
                inline: true,
              },
              {
                name: 'Notes',
                value: notes,
                inline: false,
              },
              {
                name: 'Channel Status',
                value: created ? 'Created new session channel' : 'Reused existing session channel',
                inline: false,
              },
            ],
            footer: {
              text: `Jarvis | Session created by ${message.author.tag}`,
            },
            timestamp: new Date().toISOString(),
          },
        ],
        allowedMentions: {
          users: [message.author.id],
        },
        });

        registerSessionMessage({
          guildId: message.guild.id,
          messageId: reply.id,
          channelId: channel.id,
          hostId: message.author.id,
          reactEmoji,
          game,
          dateTime,
          notes,
        });

        await reply.react(reactEmoji).catch(() => null);

        return null;
    } catch (error) {
      console.error('session command failed:', error.message);
      await notifyOwner(
        'session failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nInput: ${rawInput}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while creating that session: ${error.message}`);
    }
  }

  if (command === '!remindpsn') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    try {
      const { eligibleMembers } = await getAuditableMembersForGuild(message.guild);
      const missingRegistration = eligibleMembers.filter((member) => !psnRegistrations[member.id]);

      if (missingRegistration.size === 0) {
        return message.reply('Everyone who should be registered already has a saved PSN registration.');
      }

      const mentions = missingRegistration
        .first(20)
        .map((member) => member.toString())
        .join(' ');

      return message.reply({
        content: `${mentions}\nPlease use \`!registerpsn <your username>\` so Jarvis can assign your hunter role automatically.`,
        allowedMentions: {
          users: missingRegistration.first(20).map((member) => member.id),
        },
      });
    } catch (error) {
      console.error('remindpsn command failed:', error.message);
      await notifyOwner(
        'remindpsn failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while sending the registration reminder: ${error.message}`);
    }
  }

  if (command === '!remindrules') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    try {
      const rulesAcceptedRole = getRulesAcceptedRole(message.guild);

      if (!rulesAcceptedRole) {
        return message.reply('The `Rules Accepted` role was not found.');
      }

      const { eligibleMembers } = await getAuditableMembersForGuild(message.guild);
      const missingRulesAccepted = eligibleMembers.filter((member) => !memberHasRulesAcceptedRole(member));

      if (missingRulesAccepted.size === 0) {
        return message.reply('Everyone who should be in the server already has the `Rules Accepted` role.');
      }

      const visibleMembers = missingRulesAccepted.first(20);
      const mentions = visibleMembers.map((member) => member.toString()).join(' ');

      return message.reply({
        content: `${mentions}\nPlease read the rules channel and complete the rules step so staff can give you the \`${RULES_ACCEPTED_ROLE_NAME}\` role.`,
        allowedMentions: {
          users: visibleMembers.map((member) => member.id),
        },
      });
    } catch (error) {
      console.error('remindrules command failed:', error.message);
      await notifyOwner(
        'remindrules failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while sending the rules reminder: ${error.message}`);
    }
  }

  if (command === '!resetaccess') {
    if (!message.guild || !message.member) {
      return message.reply('This command only works inside a server.');
    }

    if (!isAdminMember(message.member)) {
      return message.reply('You do not have permission to use this command.');
    }

    try {
      const accessRole = getMemberAccessRole(message.guild);

      if (!accessRole) {
        return message.reply('The main member access role was not found.');
      }

      const members = await message.guild.members.fetch();
      const membersToReset = members.filter(
        (member) =>
          !member.user.bot &&
          !isAdminMember(member) &&
          member.roles.cache.has(accessRole.id)
      );

      if (membersToReset.size === 0) {
        return message.reply('No non-staff members currently have `The Assassin Brotherhood` to remove.');
      }

      let removedCount = 0;

      for (const member of membersToReset.values()) {
        await member.roles.remove(accessRole, 'Access reset requested by staff');
        removedCount += 1;
      }

      auditMemberCache.delete(message.guild.id);

      return message.reply(`Removed \`${accessRole.name}\` from **${removedCount}** non-staff members.`);
    } catch (error) {
      console.error('resetaccess command failed:', error.message);
      await notifyOwner(
        'resetaccess failed',
        `User: ${message.author.tag}\nGuild: ${message.guild.name}\nError: ${error.message}`
      );
      return message.reply(`Something went wrong while resetting server access: ${error.message}`);
    }
  }

  if (command === '!trophy') {
    const requestedPlatinumNumber = /^\d+$/.test(args[1] || '') ? Number.parseInt(args[1], 10) : null;
    const username = requestedPlatinumNumber !== null ? args[2] : args[1];

    if (!username) {
      return message.reply('Use: !trophy <psnprofiles-username> or !trophy <platinum-number> <psnprofiles-username>');
    }

    try {
      const result = requestedPlatinumNumber !== null
        ? await fetchSpecificTrophy(username, requestedPlatinumNumber)
        : await fetchLatestTrophyWithRetry(username);

        if (result.kind === 'not_found') {
          return message.reply(`PSN PlatHub user \`${username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        console.error(`Latest platinum lookup blocked for ${username}. Provider: ${result.provider || 'Unknown'}. Status: ${result.status}. Title: ${result.title || 'Unknown'}`);
        return message.reply({
          content: 'Jarvis could not fetch the latest platinum right now.',
          embeds: [createTrophyFallbackEmbed(username, 'blocked')],
        });
      }

      if (result.kind === 'parse_error') {
        return message.reply({
          embeds: [
            {
              ...createTrophyFallbackEmbed(username, 'parse_error'),
                title: requestedPlatinumNumber !== null ? 'Platinum History Parsed Incompletely' : 'Latest Platinum Parsed Incompletely',
                description: requestedPlatinumNumber !== null
                  ? `Jarvis reached **${username}** on PSN PlatHub, but could not read platinum #${requestedPlatinumNumber} cleanly yet.`
                  : 'Jarvis reached the latest platinum page, but could not read the full trophy details yet.',
              fields: [
                {
                  name: 'Provider',
                  value: 'PSN PlatHub',
                  inline: true,
                },
                {
                  name: requestedPlatinumNumber !== null ? 'Profile History Page' : 'Latest Platinum Page',
                  value: `[Open page](${result.latestPlatUrl || `${PSN_PLATHUB_BASE_URL}/latest-plat?psnId=${encodeURIComponent(username)}`})`,
                  inline: false,
                },
                {
                  name: 'Text Snippet',
                  value: result.textSnippet ? `\`${trimText(result.textSnippet, 180)}\`` : 'None',
                  inline: false,
                },
              ],
            },
          ],
        });
      }

      const { trophy } = result;
      const fetchedFrom =
        result.source === 'cache'
          ? 'Cached result'
          : result.source === 'retry'
            ? 'Fetched after retry'
            : 'Live result';

        return message.reply({
          embeds: [
            {
              color: PLATINUM_EMBED_COLOR,
              title: trophy.platinumNumber
                ? `${trophy.platinumNumber} • ${trophy.gameName}`
                : trophy.gameName,
              url: trophy.latestPlatUrl || `${PSN_PLATHUB_BASE_URL}/latest-plat?psnId=${encodeURIComponent(username)}`,
              author: trophy.trophyIcon
                ? {
                    name: requestedPlatinumNumber !== null ? `${username}'s Platinum Showcase` : `${username}'s Latest Platinum`,
                    icon_url: trophy.trophyIcon,
                  }
                : {
                    name: requestedPlatinumNumber !== null ? `${username}'s Platinum Showcase` : `${username}'s Latest Platinum`,
                  },
              description: requestedPlatinumNumber !== null
                ? `A highlighted platinum milestone from **${username}**'s collection.`
                : `A showcase of **${username}**'s most recent platinum trophy.`,
              fields: [
                {
                  name: 'Completion',
                  value: trophy.trophyType || 'Platinum',
                  inline: true,
                },
                {
                  name: 'Platform',
                  value: trophy.platform || 'Not available',
                inline: true,
              },
              {
                name: 'PSN Rarity',
                  value: trophy.rarity || 'Not available',
                  inline: true,
                },
                {
                  name: 'Earned On',
                  value: trophy.earnedDate || 'Not available',
                  inline: true,
                },
                ...(trophy.platinumNumber
                  ? [
                      {
                        name: 'Platinum Number',
                        value: trophy.platinumNumber,
                        inline: true,
                      },
                    ]
                  : []),
                {
                  name: 'Game',
                  value: trophy.gameName,
                  inline: false,
                },
                {
                  name: requestedPlatinumNumber !== null ? 'History Page' : 'Latest Platinum Page',
                      value: requestedPlatinumNumber !== null
                        ? `[Open profile history page](${trophy.latestPlatUrl || `${PSN_PLATHUB_BASE_URL}/mosaic?psnId=${encodeURIComponent(username)}`})`
                        : `[Open latest platinum page](${trophy.latestPlatUrl || `${PSN_PLATHUB_BASE_URL}/latest-plat?psnId=${encodeURIComponent(username)}`})`,
                  inline: false,
                },
              {
                name: 'Source',
                value: fetchedFrom,
                inline: true,
              },
            ],
            thumbnail: trophy.trophyIcon ? { url: trophy.trophyIcon } : undefined,
            image: trophy.gameImage ? { url: trophy.gameImage } : undefined,
            footer: {
              text: `PSN PlatHub | ${username}`,
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      if (error.message.includes('Executable doesn\'t exist')) {
        console.error('Playwright browser is missing. Run: npx playwright install chromium');
        return message.reply('The bot still needs its browser installed. Run `npx playwright install chromium` in the project folder first.');
      }

      if (
        error.message.includes('sandbox') ||
        error.message.includes('Target page, context or browser has been closed') ||
        error.message.includes('Failed to launch')
      ) {
        console.error('Hosted browser launch failed:', error.message);
        return message.reply('The hosted browser failed to start. Redeploy the bot, then try again.');
      }

      console.error('Error fetching trophy data:', error.message);
      return message.reply('Error fetching user. Check the username and try again.');
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  void notifyOwner('Unhandled rejection', String(error));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  void notifyOwner('Uncaught exception', String(error));
});

client.login(process.env.DISCORD_TOKEN);

process.on('SIGINT', async () => {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close();
  }

  process.exit(0);
});
