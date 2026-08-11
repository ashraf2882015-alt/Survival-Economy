const mineflayer = require('mineflayer');
const config = require('./config.json');

let bot = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let shuttingDown = false;
let startedAt = null;
let spawnTimer = null;
let watchdogTimer = null;
let movementTimer = null;
let armInterval = null;
let chatInterval = null;
let rightClickInterval = null;
let armorTimer = null;
let rightClickBusy = false;
let armorBusy = false;

const RECONNECT_MIN = 5000;
const RECONNECT_MAX = 60000;
const SPAWN_TIMEOUT = 45000;
const WATCHDOG_INTERVAL = 15000;
const STEP_INTERVAL = 1200;
const JUMP_DURATION = 400;

function safeClearTimeout(timer) { if (timer) clearTimeout(timer); return null; }
function safeClearInterval(timer) { if (timer) clearInterval(timer); return null; }

function stopMovement() {
  if (!bot) return;
  for (const state of ['forward','back','left','right','jump','sneak','sprint']) {
    try { bot.setControlState(state, false); } catch (_) {}
  }
}

function cleanupTimers() {
  movementTimer = safeClearTimeout(movementTimer);
  armorTimer = safeClearTimeout(armorTimer);
  spawnTimer = safeClearTimeout(spawnTimer);
  watchdogTimer = safeClearInterval(watchdogTimer);
  armInterval = safeClearInterval(armInterval);
  chatInterval = safeClearInterval(chatInterval);
  rightClickInterval = safeClearInterval(rightClickInterval);
  rightClickBusy = false;
  armorBusy = false;
  stopMovement();
}

function randomInterval(base) { return base * (0.8 + Math.random() * 0.4); }

function scheduleReconnect(reason = 'connection ended') {
  if (shuttingDown || reconnectTimer) return;
  cleanupTimers();
  reconnectAttempt += 1;
  const delay = Math.min(RECONNECT_MAX, RECONNECT_MIN * Math.pow(2, Math.min(reconnectAttempt - 1, 4)));
  console.log(`🔄 Reconnect #${reconnectAttempt} in ${Math.ceil(delay / 1000)}s — ${reason}`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);
}

function createBot() {
  if (shuttingDown) return;
  cleanupTimers();

  try {
    bot = mineflayer.createBot({
      host: config.serverHost,
      port: config.serverPort,
      username: config.botUsername,
      auth: 'offline',
      version: config.version || false,
      viewDistance: config.botChunk
    });
  } catch (err) {
    console.error('❌ createBot failed:', err.message);
    scheduleReconnect('createBot error');
    return;
  }

  let movementPhase = 0;
  let lastEntityTime = Date.now();
  const movements = [
    () => bot.setControlState('forward', true),
    () => bot.setControlState('back', true),
    () => bot.setControlState('left', true),
    () => bot.setControlState('right', true),
    () => { bot.setControlState('jump', true); setTimeout(() => bot?.entity && bot.setControlState('jump', false), JUMP_DURATION); },
    () => { bot.setControlState('forward', true); bot.setControlState('jump', true); setTimeout(() => { if (bot?.entity) { bot.setControlState('jump', false); bot.setControlState('forward', false); } }, JUMP_DURATION); },
    () => bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * Math.PI * 0.5, true),
    () => { bot.setControlState('sneak', true); setTimeout(() => bot?.entity && bot.setControlState('sneak', false), 800); }
  ];

  function swingArm() { if (bot?.entity) try { bot.swingArm(); } catch (_) {} }

  function movementCycle() {
    if (!bot?.entity || shuttingDown) return;
    lastEntityTime = Date.now();
    try { stopMovement(); movements[movementPhase](); swingArm(); movementPhase = (movementPhase + 1) % movements.length; }
    catch (err) { console.log('⚠️ Movement error:', err.message); }
    movementTimer = setTimeout(movementCycle, randomInterval(STEP_INTERVAL));
  }

  const chatMessages = ['AFK Bot is active!','Still here, keeping the server alive!','Bot running smoothly.','Server is alive and well!'];
  let chatIndex = 0;
  function sendHourlyChat() {
    if (!bot?.entity) return;
    try { const msg = chatMessages[chatIndex++ % chatMessages.length]; bot.chat(msg); console.log(`💬 Bot said: "${msg}"`); }
    catch (err) { console.log('⚠️ Chat error:', err.message); }
  }

  async function rightClickInventoryItem() {
    if (!bot?.entity || rightClickBusy) return;
    const item = bot.inventory.items()[0];
    if (!item) return;
    rightClickBusy = true;
    try {
      await bot.equip(item, 'hand');
      for (let i = 0; i < 3; i++) {
        if (!bot?.entity) return;
        bot.activateItem();
        await new Promise(resolve => setTimeout(resolve, 300));
        bot.deactivateItem();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      console.log(`🖱️ Right-clicked "${item.name}" 3 times`);
    } catch (_) {} finally { rightClickBusy = false; }
  }

  const armorSlots = {
    head: ['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet'],
    torso: ['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
    legs: ['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
    feet: ['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots']
  };

  async function equipArmor() {
    if (!bot?.entity || armorBusy) return;
    armorBusy = true;
    try {
      for (const [slot, items] of Object.entries(armorSlots)) {
        if (!bot?.entity) return;
        for (const itemName of items) {
          const item = bot.inventory.items().find(i => i.name === itemName);
          if (!item) continue;
          try { await bot.equip(item, slot); console.log(`🛡️ Equipped ${itemName} on ${slot}`); } catch (_) {}
          break;
        }
      }
    } finally { armorBusy = false; }
  }

  function watchdog() {
    if (!bot || shuttingDown) return;
    if (!bot.entity) { try { bot.quit('Watchdog reconnect'); } catch (_) {} scheduleReconnect('watchdog: no entity'); return; }
    if (Date.now() - lastEntityTime > 120000) { try { bot.quit('Watchdog timeout'); } catch (_) {} scheduleReconnect('watchdog timeout'); }
  }

  bot.once('spawn', () => {
    reconnectAttempt = 0;
    startedAt = Date.now();
    lastEntityTime = Date.now();
    spawnTimer = safeClearTimeout(spawnTimer);
    console.log(`✅ ${config.botUsername} connected to ${config.serverHost}:${config.serverPort}`);
    setTimeout(() => { if (bot?.entity) try { bot.setControlState('sneak', true); } catch (_) {} }, 3000);
    movementTimer = setTimeout(movementCycle, STEP_INTERVAL);
    armorTimer = setTimeout(equipArmor, 4000);
    rightClickInterval = setInterval(rightClickInventoryItem, 2 * 60 * 1000);
    chatInterval = setInterval(sendHourlyChat, 60 * 60 * 1000);
    armInterval = setInterval(swingArm, 30000);
    watchdogTimer = setInterval(watchdog, WATCHDOG_INTERVAL);
  });

  spawnTimer = setTimeout(() => {
    if (!bot?.entity && !shuttingDown) { try { bot.quit('Spawn timeout'); } catch (_) {} scheduleReconnect('spawn timeout'); }
  }, SPAWN_TIMEOUT);

  bot.on('playerCollect', collector => {
    if (collector.username === config.botUsername) { armorTimer = safeClearTimeout(armorTimer); armorTimer = setTimeout(equipArmor, 1000); }
  });
  bot.on('chat', (username, message) => { if (username !== config.botUsername) console.log(`💬 [${username}]: ${message}`); });
  bot.on('error', err => console.error('⚠️ Error:', err.message));
  bot.on('kicked', reason => console.log(`🚫 Bot was kicked: ${reason}`));
  bot.on('end', reason => { console.log(`⛔ Bot disconnected: ${reason || 'unknown reason'}`); scheduleReconnect(reason || 'connection ended'); });
}

function start() {
  if (bot?.entity) return;
  shuttingDown = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  createBot();
}

function stop(reason = 'web panel') {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  cleanupTimers();
  startedAt = null;
  try { bot?.quit(reason); } catch (_) {}
  bot = null;
  console.log(`🛑 Bot stopped (${reason})`);
}

function reconnect(reason = 'web panel') {
  shuttingDown = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  cleanupTimers();
  try { bot?.quit(`Reconnect: ${reason}`); } catch (_) {}
  bot = null;
  setTimeout(() => { if (!shuttingDown) createBot(); }, RECONNECT_MIN);
}

function chat(message) {
  if (!bot?.entity) throw new Error('Bot is offline');
  bot.chat(String(message));
}

function shutdown(signal) {
  stop(signal);
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`🤖 Starting AFK Bot → ${config.serverHost}:${config.serverPort}`);
start();

module.exports = {
  getBot: () => bot,
  getConfig: () => config,
  getStartedAt: () => startedAt,
  start,
  stop,
  reconnect,
  chat
};
