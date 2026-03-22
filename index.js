require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits } = require('discord.js');
const cheerio = require('cheerio');
const { chromium } = require('playwright');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let browserPromise;
const EMBED_COLOR = 0x0070d1;
const PSNPROFILES_BASE_URL = 'https://psnprofiles.com';
const PSN_CARD_BASE_URL = 'https://card.psnprofiles.com/1';
const POWERPYX_BASE_URL = 'https://www.powerpyx.com';
const TROPHY_CACHE_TTL_MS = 10 * 60 * 1000;
const PROFILE_CACHE_TTL_MS = 60 * 60 * 1000;
const TROPHY_RETRY_DELAYS_MS = [2500, 5000];
const trophyCache = new Map();
const profileCache = new Map();
const ADMIN_ROLE_IDS = ['1482453535550341250', '1484271731618091133'];
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const PSN_REGISTRATIONS_FILE = path.join(DATA_DIR, 'psn-registrations.json');
const HUNTER_RANKS = [
  { name: 'Novice Hunter', min: 0, max: 50 },
  { name: 'Rising Hunter', min: 51, max: 100 },
  { name: 'Adept Hunter', min: 101, max: 200 },
  { name: 'Elite Hunter', min: 201, max: 300 },
  { name: 'Master Hunter', min: 301, max: 400 },
  { name: 'Grandmaster Hunter', min: 401, max: 500 },
  { name: 'Veteran Hunter', min: 501, max: 600 },
  { name: 'Legendary Hunter', min: 601, max: 700 },
  { name: 'Mythic Hunter', min: 701, max: 800 },
  { name: 'Platinum Overlord', min: 801, max: 900 },
  { name: 'Ultimate Hunter', min: 901, max: 999 },
  { name: 'Platinum God', min: 1000, max: Infinity },
];
let psnRegistrations = loadPsnRegistrations();

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

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    Object.defineProperty(navigator, 'platform', {
      get: () => 'Win32',
    });
  });

  const page = await context.newPage();
  const url = `${PSNPROFILES_BASE_URL}/${encodeURIComponent(username)}/log`;

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSNProfiles.');
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
    const trophy = parseLatestTrophy(html);

    if (trophy) {
      return { kind: 'success', trophy };
    }

    const challengeDetected =
      /just a moment|attention required|access denied|security check/i.test(title) ||
      /cf-browser-verification|cf-challenge|challenge-platform|turnstile|captcha/i.test(html);

    if (challengeDetected) {
      return { kind: 'blocked', status, title };
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const bodyLooksBlocked = /verify you are human|checking your browser|enable javascript|captcha/i.test(bodyText);

    if (bodyLooksBlocked) {
      return { kind: 'blocked', status, title };
    }

    if (!trophy) {
      return { kind: 'parse_error' };
    }
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

    return { kind: 'parse_error' };
  } finally {
    await context.close();
  }
}

async function fetchPsnProfileSummaryWithRetry(username) {
  const cachedProfile = getCachedProfileSummary(username);

  if (cachedProfile) {
    return { kind: 'success', profile: cachedProfile, source: 'cache' };
  }

  let lastResult = null;

  for (let attempt = 0; attempt <= TROPHY_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await fetchPsnProfileSummary(username);
    lastResult = result;

    if (result.kind === 'success') {
      setCachedProfileSummary(username, result.profile);
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

function saveUserPsnRegistration(member, username, platinumCount) {
  psnRegistrations[member.id] = {
    discordTag: member.user.tag,
    username,
    platinumCount,
    updatedAt: new Date().toISOString(),
  };
  setCachedProfileSummary(username, {
    username,
    platinumCount,
  });

  savePsnRegistrations();
}

function getHunterRank(platinumCount) {
  return HUNTER_RANKS.find((rank) => platinumCount >= rank.min && platinumCount <= rank.max) || null;
}

async function assignHunterRank(member, platinumCount) {
  const guildRoles = member.guild.roles.cache;
  const targetRank = getHunterRank(platinumCount);

  if (!targetRank) {
    throw new Error(`No hunter rank found for ${platinumCount} platinums.`);
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
    description: 'Trophy lookups, profile cards, and guide searches for PlayStation hunters.',
    fields: [
      {
        name: '!ping',
        value: 'Checks if the bot is online.',
        inline: true,
      },
      {
        name: '!trophy <username>',
        value: 'Shows the latest trophy earned on PSNProfiles.',
        inline: false,
      },
      {
        name: '!psn <username>',
        value: 'Shows the user\'s PSNProfiles card.',
        inline: false,
      },
      {
        name: '!guide <game name>',
        value: 'Finds the best PowerPyx trophy guide.',
        inline: false,
      },
      {
        name: '!trophylist <game name>',
        value: 'Finds a PowerPyx trophy page for the game.',
        inline: false,
      },
      {
        name: '!platinum <game name>',
        value: 'Shows key platinum roadmap details from PowerPyx.',
        inline: false,
      },
      {
        name: '!psnguide <game name>',
        value: 'Finds the best matching PSNProfiles guide.',
        inline: false,
      },
      {
        name: '!registerpsn <username or link>',
        value: 'Checks your PSNProfiles account and assigns your hunter rank role automatically.',
        inline: false,
      },
    ],
    footer: {
      text: 'Jarvis | PlayStation Trophy Assistant | Made for No BS Trophy Hunting |',
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

async function fetchPowerPyxRoadmap(link) {
  const response = await axios.get(link, {
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const $ = cheerio.load(response.data);
  const bulletItems = [];

  $('li').each((_, element) => {
    const text = normalizeText($(element).text());

    if (
      text.startsWith('Estimated trophy difficulty:') ||
      text.startsWith('Approximate amount of time to platinum:') ||
      text.startsWith('Number of missable trophies:') ||
      text.startsWith('Glitched trophies:') ||
      text.startsWith('Minimum Playthroughs:')
    ) {
      bulletItems.push(text);
    }
  });

  return bulletItems;
}

function extractRoadmapValue(items, label) {
  const item = items.find((entry) => entry.toLowerCase().startsWith(label.toLowerCase()));

  if (!item) {
    return null;
  }

  return item.slice(label.length).trim() || null;
}

async function searchPsnProfilesGuides(query) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  const searchUrl = `${PSNPROFILES_BASE_URL}/search/guides?q=${encodeURIComponent(query)}`;

  try {
    const response = await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response) {
      throw new Error('No response received from PSNProfiles guides.');
    }

    const status = response.status();

    if (status >= 400) {
      return { kind: 'blocked', status };
    }

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(2000);

    const html = await page.content();
    const title = await page.title();
    const $ = cheerio.load(html);
    const results = [];

    $('a[href*="/guide/"]').each((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href');
      const container = anchor.closest('li, tr, article, .guide, .box');
      const headingText = normalizeText(
        container.find('h1, h2, h3, h4, .title').first().text() || anchor.text()
      );
      const text = trimText(headingText, 200);

      if (!href || !text) {
        return;
      }

      const link = href.startsWith('http') ? href : new URL(href, PSNPROFILES_BASE_URL).toString();

      if (!results.some((result) => result.link === link)) {
        results.push({
          title: text,
          link,
          score: scorePowerPyxResult(text, query, ['guide', 'roadmap']),
        });
      }
    });

    if (results.length > 0) {
      results.sort((a, b) => b.score - a.score);
      return { kind: 'success', results };
    }

    const challengeDetected =
      /just a moment|attention required|access denied|security check/i.test(title) ||
      /cf-browser-verification|cf-challenge|challenge-platform|turnstile|captcha/i.test(html);

    if (challengeDetected) {
      return { kind: 'blocked', status, title };
    }

    return { kind: 'not_found' };
  } finally {
    await context.close();
  }
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  if (command === '!ping') {
    return message.reply('pong');
  }

  if (command === '!help') {
    return message.reply({
      embeds: [createHelpEmbed()],
    });
  }

  if (command === '!psn') {
    const username = args[1];

    if (!username) {
      return message.reply('Use: !psn <psnprofiles-username>');
    }

    const cardUrl = buildCardUrl(username);

    return message.reply({
      embeds: [
        {
          ...createBaseEmbed(username, `${username}'s PSN Card`),
          description: `[Open PSNProfiles profile](${buildProfileUrl(username)})`,
          image: { url: cardUrl },
        },
      ],
    });
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
      const savedRegistration = psnRegistrations[member.id];
      let result;

      if (
        savedRegistration &&
        savedRegistration.username.toLowerCase() === username.toLowerCase()
      ) {
        result = {
          kind: 'success',
          profile: {
            username: savedRegistration.username,
            platinumCount: savedRegistration.platinumCount,
          },
          source: 'saved',
        };
      } else {
        result = await fetchPsnProfileSummaryWithRetry(username);
      }

      if (result.kind === 'not_found') {
        return message.reply(`PSNProfiles user \`${username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        console.error(`PSNProfiles profile blocked for ${username}. Status: ${result.status}. Title: ${result.title || 'Unknown'}`);
        return message.reply('PSNProfiles blocked the profile check right now. Please try again in a moment.');
      }

      if (result.kind === 'parse_error') {
        return message.reply('I found the profile, but could not read the platinum count.');
      }

      const rank = await assignHunterRank(member, result.profile.platinumCount);
      saveUserPsnRegistration(member, result.profile.username, result.profile.platinumCount);
      const fetchedFrom =
        result.source === 'saved'
          ? 'Saved registration'
          : result.source === 'cache'
            ? 'Cached profile'
            : result.source === 'retry'
              ? 'Fetched after retry'
              : 'Live profile';

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
                value: String(result.profile.platinumCount),
                inline: true,
              },
              {
                name: 'Assigned Role',
                value: rank.name,
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
        return message.reply('I could read the profile, but I could not assign the hunter rank role. Please check that all hunter roles exist and that Jarvis can manage them.');
      }

      console.error('Error registering PSN profile:', error.message);
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
        .map(([userId, saved]) => `<@${userId}> -> **${saved.username}** (${saved.platinumCount} plats)`);

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
              value: String(saved.platinumCount),
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
          },
        ],
      });
    } catch (error) {
      console.error('Error searching PowerPyx guide:', error.message);
      return message.reply('I could not reach PowerPyx right now. Please try again in a moment.');
    }
  }

  if (command === '!trophylist') {
    const query = args.slice(1).join(' ');

    if (!query) {
      return message.reply('Use: !trophylist <game name>');
    }

    try {
      const results = await searchPowerPyx(query);
      const trophyList = findBestPowerPyxResult(results, query, ['trophy list', 'trophy guide', 'roadmap']);

      if (!trophyList || trophyList.score <= 0) {
        return message.reply(`I couldn't find a PowerPyx trophy page for \`${query}\`.`);
      }

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: `${query} Trophy Page`,
            url: trophyList.link,
            description: `[Open on PowerPyx](${trophyList.link})\n\n${trophyList.title}`,
            footer: {
              text: 'PowerPyx Trophy Search',
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error searching PowerPyx trophy list:', error.message);
      return message.reply('I could not reach PowerPyx right now. Please try again in a moment.');
    }
  }

  if (command === '!platinum') {
    const query = args.slice(1).join(' ');

    if (!query) {
      return message.reply('Use: !platinum <game name>');
    }

    try {
      const results = await searchPowerPyx(query);
      const guide = findBestPowerPyxResult(results, query, ['trophy guide', 'roadmap']);

      if (!guide || guide.score <= 0) {
        return message.reply(`I couldn't find a PowerPyx platinum roadmap for \`${query}\`.`);
      }

      const roadmapItems = await fetchPowerPyxRoadmap(guide.link);
      const difficulty = extractRoadmapValue(roadmapItems, 'Estimated trophy difficulty:');
      const time = extractRoadmapValue(roadmapItems, 'Approximate amount of time to platinum:');
      const missables = extractRoadmapValue(roadmapItems, 'Number of missable trophies:');
      const glitched = extractRoadmapValue(roadmapItems, 'Glitched trophies:');
      const playthroughs = extractRoadmapValue(roadmapItems, 'Minimum Playthroughs:');

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: `${query} Platinum Overview`,
            url: guide.link,
            description: `[Open full PowerPyx roadmap](${guide.link})`,
            fields: [
              {
                name: 'Difficulty',
                value: difficulty || 'Not found',
                inline: true,
              },
              {
                name: 'Time',
                value: time || 'Not found',
                inline: true,
              },
              {
                name: 'Playthroughs',
                value: playthroughs || 'Not found',
                inline: true,
              },
              {
                name: 'Missables',
                value: missables || 'Not found',
                inline: false,
              },
              {
                name: 'Glitched Trophies',
                value: glitched || 'Not found',
                inline: true,
              },
            ],
            footer: {
              text: 'PowerPyx Platinum Search',
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error searching PowerPyx platinum info:', error.message);
      return message.reply('I could not read the PowerPyx roadmap right now. Please try again in a moment.');
    }
  }

  if (command === '!psnguide') {
    const query = args.slice(1).join(' ');

    if (!query) {
      return message.reply('Use: !psnguide <game name>');
    }

    try {
      const result = await searchPsnProfilesGuides(query);

      if (result.kind === 'blocked') {
        console.error(`PSNProfiles guide search blocked for "${query}". Status: ${result.status}. Title: ${result.title || 'Unknown'}`);
        return message.reply('PSNProfiles blocked the guide search right now. Please try again in a moment.');
      }

      if (result.kind === 'not_found' || !result.results?.length) {
        return message.reply(`I couldn't find a PSNProfiles guide for \`${query}\`.`);
      }

      const guide = result.results[0];

      return message.reply({
        embeds: [
          {
            color: EMBED_COLOR,
            title: trimText(guide.title, 256),
            url: guide.link,
            description: `[Open PSNProfiles guide](${guide.link})`,
            footer: {
              text: 'PSNProfiles Guide Search',
            },
          },
        ],
      });
    } catch (error) {
      console.error('Error searching PSNProfiles guides:', error.message);
      return message.reply('I could not reach PSNProfiles guides right now. Please try again in a moment.');
    }
  }

  if (command === '!trophy') {
    const username = args[1];

    if (!username) {
      return message.reply('Use: !trophy <psnprofiles-username>');
    }

    try {
      const result = await fetchLatestTrophyWithRetry(username);

      if (result.kind === 'not_found') {
        return message.reply(`PSNProfiles user \`${username}\` was not found.`);
      }

      if (result.kind === 'blocked') {
        console.error(`PSNProfiles challenge page for ${username}. Status: ${result.status}. Title: ${result.title || 'Unknown'}`);
        return message.reply({
          content: 'PSNProfiles blocked the request right now, so I could not fetch the latest trophy automatically.',
          embeds: [createTrophyFallbackEmbed(username, 'blocked')],
        });
      }

      if (result.kind === 'parse_error') {
        return message.reply({
          content: 'I found the profile, but could not read the latest trophy entry.',
          embeds: [createTrophyFallbackEmbed(username, 'parse_error')],
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
            ...createBaseEmbed(username, trophy.trophyName),
            description: `Latest trophy for **${username}**`,
            fields: [
              {
                name: 'Game',
                value: trophy.gameName,
                inline: true,
              },
              {
                name: 'Type',
                value: trophy.trophyType,
                inline: true,
              },
              {
                name: 'Rarity',
                value: trophy.rarity,
                inline: true,
              },
              {
                name: 'Profile',
                value: `[Open trophy log](${buildLogUrl(username)})`,
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

client.login(process.env.DISCORD_TOKEN);

process.on('SIGINT', async () => {
  if (browserPromise) {
    const browser = await browserPromise.catch(() => null);
    await browser?.close();
  }

  process.exit(0);
});
