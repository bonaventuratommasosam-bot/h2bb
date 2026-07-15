'use strict';

/**
 * Scanner multi-pair: confronta entryScore tra i pair del watchlist.
 * @param {string[]} watchlist    - es. ["ETH", "BTC", "SOL"]
 * @param {object}   strategy     - config corrente
 * @param {function} analyzeMarket - (pair, strategy) => { entryScore: { score, bias } }
 * @returns {Promise<{pair:string, score:number, bias:string}|null>}
 */
async function findBestPair(watchlist, strategy, analyzeMarket) {
  const minDelta = strategy.scannerMinScoreDelta || 5;
  const currentPair = strategy.pair;
  const results = [];

  for (const pair of watchlist) {
    if (pair === currentPair) continue;
    try {
      const analysis = await analyzeMarket(pair, strategy);
      if (analysis?.entryScore?.score != null) {
        results.push({
          pair,
          score: analysis.entryScore.score,
          bias: analysis.entryScore.bias,
        });
      }
    } catch {
      // skip pair su errore
    }
  }

  if (results.length === 0) return null;

  results.sort((a, b) => b.score - a.score);
  const best = results[0];

  if (best.bias !== 'long') return null;
  if (best.score < (strategy.minConfidenceScore || 52)) return null;

  let currentScore = 0;
  try {
    const currentAnalysis = await analyzeMarket(currentPair, strategy);
    currentScore = currentAnalysis?.entryScore?.score || 0;
  } catch {
    // fallback: 0
  }

  if (best.score - currentScore < minDelta) return null;

  return best;
}

module.exports = { findBestPair };
