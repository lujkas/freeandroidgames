const gplay = require('google-play-scraper');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const CONFIG = {
  templateDir: './template',
  templateAssetsSource: './verti/assets',
  outputDir: './public',
  imagesDir: './public/images/games',
  gameListPath: './scripts/game-list.json',
  publishedPath: './scripts/published-games.json',
  postsPerDay: 1,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: 'gemini-2.0-flash-exp',
  siteName: 'Free Android Games',
  siteTagline: 'Daily Game Reviews',
  articlePrompt: `Write a comprehensive, engaging, and SEO optimized 600 to 700 word review article about this Android game.

Game: {TITLE} by {DEVELOPER}
Genre: {GENRE}
Rating: {RATING}
Downloads: {DOWNLOADS}
Description: {DESCRIPTION}

Write 600 to 700 words in an enthusiastic, conversational tone keeping SEO optimization in mind. Focus on gameplay, why it's fun, and who would enjoy it.`
};

async function loadTemplate(name) {
  return await fs.readFile(path.join(CONFIG.templateDir, name), 'utf8');
}

function populateTemplate(template, data) {
  let html = template;
  for (const [key, value] of Object.entries(data)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return html;
}

async function copyTemplateAssets() {
  console.log('📁 Copying template assets...');
  const dest = path.join(CONFIG.outputDir, 'assets');
  if (await fs.pathExists(CONFIG.templateAssetsSource)) {
    await fs.copy(CONFIG.templateAssetsSource, dest);
    console.log('  ✓ Assets copied\n');
  }
}

async function loadPublishedGames() {
  try {
    if (await fs.pathExists(CONFIG.publishedPath)) {
      return await fs.readJson(CONFIG.publishedPath);
    }
  } catch (e) {}
  return { games: [], totalPublished: 0 };
}

async function savePublishedGames(data) {
  await fs.writeJson(CONFIG.publishedPath, data, { spaces: 2 });
}

async function downloadImage(url, filepath) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    await fs.outputFile(filepath, response.data);
    return true;
  } catch (e) {
    return false;
  }
}

function createSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function generateArticleWithGemini(game) {
  console.log('  🤖 Calling Google Gemini AI...');
  try {
    const prompt = CONFIG.articlePrompt
      .replace('{TITLE}', game.title)
      .replace('{DEVELOPER}', game.developer || 'Unknown')
      .replace('{GENRE}', game.genre || 'Game')
      .replace('{RATING}', game.scoreText || game.score || 'N/A')
      .replace('{DOWNLOADS}', game.installs || 'N/A')
      .replace('{DESCRIPTION}', game.description?.substring(0, 500) || 'A popular mobile game');
    
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.geminiModel}:generateContent?key=${CONFIG.geminiApiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    
    const article = response.data.candidates[0].content.parts[0].text;
    console.log(`  ✓ Article generated (${article.split(/\s+/).length} words)\n`);
    return article.trim();
  } catch (error) {
    console.log('  ⚠️  Using fallback article\n');
    return `${game.title} is an exciting ${game.genre || 'game'} with ${game.installs} downloads and a ${game.scoreText || game.score} rating. ${game.description?.substring(0, 400) || 'Players love this game!'} Download it today!`;
  }
}

async function getNextGamesToPublish(count) {
  const gameList = await fs.readJson(CONFIG.gameListPath);
  const published = await loadPublishedGames();
  const publishedIds = new Set(published.games.map(g => g.appId));
  
  const unpublished = gameList.games.filter(g => !publishedIds.has(g.appId));
  
  if (unpublished.length === 0) {
    console.log('⚠️  No games to publish. Run update-top-charts.js\n');
    return [];
  }
  
  return unpublished.slice(0, count);
}

async function fetchGameDetails(appId) {
  try {
    return await gplay.app({ appId });
  } catch (e) {
    return null;
  }
}

async function downloadGameImages(game, slug) {
  console.log('  📥 Downloading images...');
  const images = { icon: null, headerImage: null, screenshots: [] };
  
  if (game.icon) {
    const iconPath = path.join(CONFIG.imagesDir, `${slug}-icon.png`);
    if (await downloadImage(game.icon, iconPath)) {
      images.icon = `/images/games/${slug}-icon.png`;
      console.log('    ✓ Icon');
    }
  }
  
  if (game.headerImage) {
    const headerPath = path.join(CONFIG.imagesDir, `${slug}-header.jpg`);
    if (await downloadImage(game.headerImage, headerPath)) {
      images.headerImage = `/images/games/${slug}-header.jpg`;
      console.log('    ✓ Header');
    }
  }
  
  if (game.screenshots) {
    for (let i = 0; i < Math.min(3, game.screenshots.length); i++) {
      const ssPath = path.join(CONFIG.imagesDir, `${slug}-screenshot-${i+1}.jpg`);
      if (await downloadImage(game.screenshots[i], ssPath)) {
        images.screenshots.push(`/images/games/${slug}-screenshot-${i+1}.jpg`);
        console.log(`    ✓ Screenshot ${i+1}`);
      }
    }
  }
  
  console.log();
  return images;
}

async function generateGamePage(game, article, images, slug) {
  const template = await loadTemplate('game-page.html');
  return populateTemplate(template, {
    SITE_NAME: CONFIG.siteName,
    TITLE: game.title,
    DESCRIPTION: game.summary?.substring(0, 150) || '',
    GENRE: game.genre || 'Game',
    RATING: game.scoreText || game.score || 'N/A',
    DOWNLOADS: game.installs || 'N/A',
    DEVELOPER: game.developer || 'Unknown',
    ICON: images.icon || '/images/placeholder.png',
    PLAY_STORE_URL: game.url,
    VERSION: game.version || 'Latest',
    UPDATED: game.updated || 'Recently',
    YEAR: new Date().getFullYear(),
    ARTICLE_CONTENT: article.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('\n'),
    FEATURED_IMAGE: images.headerImage ? `<span class="image featured"><img src="${images.headerImage}" /></span>` : '',
    SCREENSHOTS_SECTION: images.screenshots.length ? `
      <section>
        <header><h3>Screenshots</h3></header>
        <div class="row">
          ${images.screenshots.map(img => `<div class="col-4"><span class="image fit"><img src="${img}" /></span></div>`).join('')}
        </div>
      </section>` : ''
  });
}

async function generateHomepage(latestGames) {
  const template = await loadTemplate('homepage.html');
  const cardTemplate = await loadTemplate('game-card.html');
  
  const cards = latestGames.map((gd, i) => {
    return populateTemplate(cardTemplate, {
      SLUG: gd.slug,
      TITLE: gd.game.title,
      ICON: gd.images.icon || '/images/placeholder.png',
      GENRE: gd.game.genre || 'Game',
      RATING: gd.game.scoreText || gd.game.score,
      DOWNLOADS: gd.game.installs,
      EXCERPT: (gd.game.summary || '').substring(0, 120) + '...',
      PLAY_STORE_URL: gd.game.url,
      NEW_BADGE: i === 0 ? '<span style="position:absolute;top:1em;right:1em;background:#47d474;color:#fff;padding:0.4em 0.8em;border-radius:4px;font-size:0.7em;font-weight:700;">NEW TODAY</span>' : ''
    });
  }).join('\n');
  
  const html = populateTemplate(template, {
    SITE_NAME: CONFIG.siteName,
    SITE_TITLE: `${CONFIG.siteName} - Download Best Mobile Games`,
    SITE_TAGLINE: CONFIG.siteTagline,
    HERO_TITLE: 'Discover Amazing Free Android Games Daily',
    HERO_DESCRIPTION: 'AI-powered reviews of the best free games',
    GAME_CARDS: cards,
    YEAR: new Date().getFullYear()
  });
  
  await fs.writeFile(path.join(CONFIG.outputDir, 'index.html'), html);
}

async function generateAllGamesPage(allGames) {
  const template = await loadTemplate('all-games.html');
  
  const cards = allGames.map(g => {
    const slug = g.slug || createSlug(g.title);
    return `
      <div class="col-4 col-12-medium">
        <section class="box">
          <a href="/games/${slug}.html" class="image featured">
            <img src="/images/games/${slug}-icon.png" alt="${g.title}" onerror="this.src='/images/placeholder.png'" />
          </a>
          <header><h3><a href="/games/${slug}.html">${g.title}</a></h3></header>
          <p>⭐ ${g.rating} • 📥 ${g.downloads}</p>
          <ul class="buttons">
            <li><a href="/games/${slug}.html" class="button small">Read Review</a></li>
          </ul>
        </section>
      </div>
    `;
  }).join('\n');
  
  const html = populateTemplate(template, {
    SITE_NAME: CONFIG.siteName,
    TOTAL_GAMES: allGames.length,
    GAME_CARDS: cards,
    YEAR: new Date().getFullYear()
  });
  
  await fs.writeFile(path.join(CONFIG.outputDir, 'all-games.html'), html);
}

async function publishDailyGames() {
  console.log('🚀 Publishing daily games...\n');
  
  await fs.ensureDir(CONFIG.outputDir);
  await fs.ensureDir(CONFIG.imagesDir);
  await fs.ensureDir(path.join(CONFIG.outputDir, 'games'));
  
  await copyTemplateAssets();
  
  const gamesToPublish = await getNextGamesToPublish(CONFIG.postsPerDay);
  if (gamesToPublish.length === 0) return;
  
  const published = await loadPublishedGames();
  const newlyPublished = [];
  
  for (let i = 0; i < gamesToPublish.length; i++) {
    const gameBasic = gamesToPublish[i];
    console.log(`[${i+1}/${gamesToPublish.length}] ${gameBasic.title}\n`);
    
    const game = await fetchGameDetails(gameBasic.appId);
    if (!game) continue;
    
    const slug = createSlug(game.title);
    const images = await downloadGameImages(game, slug);
    const article = await generateArticleWithGemini(game);
    
    console.log('  📄 Creating page...');
    const html = await generateGamePage(game, article, images, slug);
    await fs.writeFile(path.join(CONFIG.outputDir, 'games', `${slug}.html`), html);
    console.log('  ✓ Page created\n');
    
    published.games.push({
      appId: game.appId,
      title: game.title,
      slug: slug,
      publishedDate: new Date().toISOString(),
      rating: game.scoreText || game.score,
      downloads: game.installs
    });
    
    newlyPublished.push({ game, slug, images });
  }
  
  published.totalPublished = published.games.length;
  await savePublishedGames(published);
  
  console.log('🏠 Generating homepage...\n');
  await generateHomepage(newlyPublished.slice(0, 5));
  
  console.log('📚 Generating all games page...\n');
  await generateAllGamesPage(published.games);
  
  console.log(`✅ Published ${newlyPublished.length} game(s)!\n`);
  console.log(`📊 Total: ${published.totalPublished} games\n`);
}

publishDailyGames()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });