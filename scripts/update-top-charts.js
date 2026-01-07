// scripts/update-top-charts.js
const gplay = require('google-play-scraper');
const fs = require('fs-extra');

const CONFIG = {
  maxGames: 100,
  categories: ['GAME', 'GAME_ACTION', 'GAME_ADVENTURE', 'GAME_ARCADE', 'GAME_PUZZLE', 'GAME_CASUAL'],
  minRating: 3.5,
  minInstalls: 1000000,
  excludeKeywords: ['casino', 'betting', 'gambling', 'slot'],
  gameListPath: './scripts/game-list.json'
};

async function fetchTopFreeGames(category, limit = 100) {
  try {
    console.log(`  Fetching top ${limit} from ${category}...`);
    const games = await gplay.list({
      category: category,
      collection: 'TOP_FREE', // Changed from gplay.collection.TOP_FREE
      num: limit,
      country: 'us',
      lang: 'en',
      fullDetail: false
    });
    return games;
  } catch (error) {
    console.error(`  Error: ${error.message}`);
    return [];
  }
}

function filterGame(game) {
  if (game.score && game.score < CONFIG.minRating) return false;
  if (game.minInstalls && game.minInstalls < CONFIG.minInstalls) return false;
  
  const titleLower = game.title.toLowerCase();
  for (const keyword of CONFIG.excludeKeywords) {
    if (titleLower.includes(keyword)) return false;
  }
  return true;
}

function generateKeywords(game) {
  const title = game.title.toLowerCase();
  const genre = game.genre || '';
  const titleWords = title.split(/\s+/).slice(0, 3).join(' ');
  return `${titleWords} ${genre} mobile game`.trim();
}

function calculatePriority(game) {
  const installs = game.minInstalls || 0;
  const rating = game.score || 0;
  
  if (installs >= 100000000 && rating >= 4.5) return 'high';
  if (installs >= 10000000 && rating >= 3.5) return 'medium';
  return 'low';
}

async function updateTopCharts() {
  console.log('🚀 Updating top charts...\n');
  
  const allGames = new Map();
  
  for (const category of CONFIG.categories) {
    const games = await fetchTopFreeGames(category, 100);
    console.log(`   ✓ ${category}: ${games.length} games\n`);
    
    for (const game of games) {
      if (!allGames.has(game.appId)) {
        allGames.set(game.appId, game);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`📊 Total games found: ${allGames.size}\n`);
  console.log('🔍 Filtering games...\n');
  
  const filteredGames = [];
  for (const [appId, game] of allGames) {
    if (!filterGame(game)) continue;
    
    filteredGames.push({
      appId: appId,
      title: game.title,
      developer: game.developer,
      keywords: generateKeywords(game),
      priority: calculatePriority(game),
      rating: game.score,
      installs: game.installs || game.minInstalls,
      categories: [game.genre],
      icon: game.icon,
      addedDate: new Date().toISOString().split('T')[0]
    });
  }
  
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  filteredGames.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return (b.rating || 0) - (a.rating || 0);
  });
  
  const finalGames = filteredGames.slice(0, CONFIG.maxGames);
  
  const data = {
    lastUpdated: new Date().toISOString(),
    totalGames: finalGames.length,
    games: finalGames
  };
  
  await fs.writeJson(CONFIG.gameListPath, data, { spaces: 2 });
  
  console.log(`✅ Saved ${finalGames.length} games!\n`);
  console.log(`📁 File: ${CONFIG.gameListPath}\n`);
}

updateTopCharts()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });