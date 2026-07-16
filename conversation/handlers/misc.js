// Handler: help, default
// EXTRACTED FROM index.js:600-620

const { isLiveMode } = require('../../state/wallet');
const shared = require('../../state/shared');

function handleHelp() {
  const mode = isLiveMode() ? 'LIVE' : 'DEMO';
  const strat = shared.strategy.mode === 'pro' ? 'PRO (multi-indicatore + risk manager)' : 'autonomo (RSI)';
  return `🤖 *H2BB / Hermes ${strat}* (${mode})\n\n` +
    `• \`analisi\` · \`scanner\` · \`performance\` · \`rischio\`\n` +
    `• \`perché?\` — ultima decisione (reason code)\n` +
    `• \`come sta andando?\` · \`pausa\` · \`resume\` · \`ferma tutto\`\n` +
    `• \`compra 0.01 ETH\` · \`vendi ETH\` (manuale)\n` +
    `• \`attiva live\` · \`stato live\` · \`modalità demo\``;
}

function handleDefault(cmd) {
  return `Hmm, non ho collegato "${cmd.text}" a un'azione.\n\n` +
    `Parlami naturalmente — es: *"come va?"*, *"analizza il mercato"*, *"fermati"*, *"compra 0.01 ETH"*.\n` +
    `Scrivi *aiuto* per la lista completa.`;
}

module.exports = { handleHelp, handleDefault };
