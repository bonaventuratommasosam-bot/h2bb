// Routes: /chat, /message, /proactive/check
// EXTRACTED FROM index.js:780-820

const express = require('express');
const conversationAgent = require('../../conversation-agent');
const { handleMessage } = require('../../conversation/handlers');
const { getAgentContext, refreshAgentContextCache } = require('../../engine/context-cache');
const { runProactiveCheck } = require('../../engine/tick-runner');

const router = express.Router();

router.post('/proactive/check', async (req, res) => {
  try {
    const result = await runProactiveCheck();
    res.json({ ok: true, ...result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/chat', async (req, res) => {
  try {
    const { text, chatId } = req.body || {};
    if (!text) return res.json({ ok: false, error: 'Campo "text" richiesto' });
    refreshAgentContextCache().catch((e) => console.error('[CONTEXT] refresh failed:', e.message));
    const result = await conversationAgent.processMessage({
      text, chatId: chatId || 'default', context: getAgentContext(), executeEngine: handleMessage,
    });
    res.json(result);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/message', async (req, res) => {
  try {
    const { text, chatId } = req.body || {};
    if (!text) return res.json({ ok: false, error: 'Campo "text" richiesto' });
    if (chatId || process.env.CONVERSATIONAL !== '0') {
      refreshAgentContextCache().catch((e) => console.error('[CONTEXT] refresh failed:', e.message));
      const result = await conversationAgent.processMessage({
        text, chatId: chatId || 'default', context: getAgentContext(), executeEngine: handleMessage,
      });
      return res.json(result);
    }
    const reply = await handleMessage(text);
    res.json({ ok: true, reply });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;
