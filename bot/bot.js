const mineflayer = require('mineflayer');
const net = require('net');
const dns = require('dns');
const config = require('./config.json');

let bot = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let connectionAttempt = 0;
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
  console.log(`🔄 [RECONNECT] #${reconnectAttempt} in ${Math.ceil(delay / 1000)}s | ${reason}`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    createBot();
  }, delay);
}

function dnsProbe() {
  return new Promise(resolve => {
    console.log(`🔎 [DNS] Resolving ${config.serverHost}...`);
    dns.lookup(config.serverHost, { all: true }, (err, addresses) => {
      if (err) {
        console.log(`❌ [DNS] ${err.code || 'ERROR'}: ${err.message}`);
        resolve(false);
        return;
      }
      console.log(`✅ [DNS] ${addresses.map(a => a.address).join(', ')}`);
      resolve(true);
    });
  });
}

function tcpProbe() {
  return new Promise(resolve => {
    console.log(`🔎 [TCP] Checking ${config.serverHost}:${config.serverPort}...`);
    const socket = net.createConnection({ host: config.serverHost, port: config.serverPort });
    let finished = false;
    const finish = ok => {
      if (finished) return;
      finished = true;
      try { socket.destroy(); } catch (_) {}
      resolve(ok);
    };
    socket.setTimeout(8000);
    socket.once('connect', () => {
      console.log('✅ [TCP] Port is reachable.');
      finish(true);
    });
    socket.once('timeout', () => {
      console.log('⚠️ [TCP] Timeout after 8s.');
      finish(false);
    });
    socket.once('error', err => {
      console.log(`❌ [TCP] ${err.code || 'ERROR'}: ${err.message}`);
      finish(false);
    });
  });
}

async function preflight() {
  console.log(`🧪 [PREFLIGHT] ${config.serverHost}:${config.serverPort} | version=${config.version || 'auto'} | auth=offline`);
  if (!(await dnsProbe())) return false;
  return tcpProbe();
}

async function createBot() {
  if (shuttingDown) return;
  cleanupTimers();
  connectionAttempt += 1;
  console.log(`\n================ ATTEMPT #${connectionAttempt} ================`);

  const reachable = await preflight();
  if (!reachable) {
    console.log('⏳ [RETRY] Server is unreachable. I will keep trying indefinitely.');
    scheduleReconnect('preflight failed');
    return;
  }

  try {
    bot = mineflayer.createBot({
      host: config.serverHost,
      port: config.serverPort,
      username: config.botUsername,
      auth: 'offline',
      version: config.version || false,
      viewDistance: config.botChunk
    });
    console.log('🚀 [MINEFLAYER] Connection started; waiting for login/spawn...');
  } catch (err) {
    console.log(`❌ [CREATE] ${err.code || 'ERROR'}: ${err.message}`);
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
    catch (err) { console.log(`⚠️ [MOVEMENT] ${err.message}`); }
    movementTimer = setTimeout(movementCycle, randomInterval(STEP_INTERVAL));
  }

  const chatMessages = ['AFK Bot is active!','Still here, keeping the server alive!','Bot running smoothly.','Server is alive and well!'];
  let chatIndex = 0;
  function sendHourlyChat() {
    if (!bot?.entity) return;
    try { const msg = chatMessages[chatIndex++ % chatMessages.length]; bot.chat(msg); console.log(`💬 [CHAT OUT] ${msg}`); }
    catch (err) { console.log(`⚠️ [CHAT] ${err.message}`); }
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
        await new Promise(r => setTimeout(r, 300));
        bot.deactivateItem();
        await new Promise(r => setTimeout(r, 200));
      }
      console.log(`🖱️ [INVENTORY] Right-clicked ${item.name} x3`);
    } catch (err) { console.log(`⚠️ [INVENTORY] ${err.message}`); }
    finally { rightClickBusy = false; }
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
          try { await bot.equip(item, slot); console.log(`🛡️ [ARMOR] ${itemName} → ${slot}`); } catch (_) {}
          break;
        }
      }
    } finally { armorBusy = false; }
  }

  function watchdog() {
    if (!bot || shuttingDown) return;
    if (!bot.entity) {
      console.log('⚠️ [WATCHDOG] No entity; reconnecting.');
      try { bot.quit('Watchdog reconnect'); } catch (_) {}
      scheduleReconnect('watchdog: no entity');
    } else if (Date.now() - lastEntityTime > 120000) {
      console.log('⚠️ [WATCHDOG] Entity inactive for 120s; reconnecting.');
      try { bot.quit('Watchdog timeout'); } catch (_) {}
      scheduleReconnect('watchdog timeout');
    }
  }

  bot.once('login', () => console.log('🔐 [LOGIN] Login accepted by server.'));
  bot.once('spawn', () => {
    reconnectAttempt = 0;
    startedAt = Date.now();
    lastEntityTime = Date.now();
    spawnTimer = safeClearTimeout(spawnTimer);
    console.log(`🎉 [SPAWN] SUCCESS — ${config.botUsername} joined ${config.serverHost}:${config.serverPort}`);
    if (bot.entity?.position) console.log(`📍 [POSITION] ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`);
    movementTimer = setTimeout(movementCycle, STEP_INTERVAL);
    armorTimer = setTimeout(equipArmor, 4000);
    rightClickInterval = setInterval(rightClickInventoryItem, 120000);
    chatInterval = setInterval(sendHourlyChat, 3600000);
    armInterval = setInterval(swingArm, 30000);
    watchdogTimer = setInterval(watchdog, WATCHDOG_INTERVAL);
  });
  bot.on('game', game => console.log(`🎮 [GAME] ${game?.dimension || 'unknown dimension'}`));
  bot.on('health', () => console.log(`❤️ [HEALTH] ${bot.health} | food=${bot.food}`));
  bot.on('resourcePack', () => console.log('📦 [RESOURCE PACK] Server requested resource pack.'));
  bot.on('kicked', reason => console.log(`🚫 [KICKED] ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', err => console.log(`❌ [ERROR] ${err.code || 'NO_CODE'}: ${err.message}`));
  bot.on('end', reason => { console.log(`⛔ [END] ${reason || 'connection closed'}`); if (!shuttingDown) scheduleReconnect(reason || 'connection ended'); });
  bot.on('chat', (username, message) => { if (username !== config.botUsername) console.log(`💬 [CHAT IN] ${username}: ${message}`); });
  bot.on('playerCollect', collector => { if (collector.username === config.botUsername) { armorTimer = safeClearTimeout(armorTimer); armorTimer = setTimeout(equipArmor, 1000); } });

  spawnTimer = setTimeout(() => {
    if (!bot?.entity && !shuttingDown) {
      console.log(`⏱️ [SPAWN TIMEOUT] No spawn after ${SPAWN_TIMEOUT / 1000}s.`);
      try { bot.quit('Spawn timeout'); } catch (_) {}
      scheduleReconnect('spawn timeout');
    }
  }, SPAWN_TIMEOUT);
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
  console.log(`🛑 [STOP] ${reason}`);
}
function reconnect(reason = 'web panel') {
  shuttingDown = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  cleanupTimers();
  try { bot?.quit(`Reconnect: ${reason}`); } catch (_) {}
  bot = null;
  console.log(`🔁 [MANUAL RECONNECT] ${reason}`);
  setTimeout(() => { if (!shuttingDown) createBot(); }, RECONNECT_MIN);
}
function chat(message) {
  if (!bot?.entity) throw new Error('Bot is offline');
  bot.chat(String(message));
}
function shutdown(signal) { stop(signal); setTimeout(() => process.exit(0), 1000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('============================================================');
console.log(`🤖 Survival Economy Bot | ${new Date().toISOString()}`);
console.log(`🎯 ${config.serverHost}:${config.serverPort} | 👤 ${config.botUsername}`);
console.log('♾️ Continuous retry: ENABLED');
console.log('============================================================');
start();

module.exports = { getBot: () => bot, getConfig: () => config, getStartedAt: () => startedAt, start, stop, reconnect, chat };
