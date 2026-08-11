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
let armorTimer = null;

const RECONNECT_MIN = 5000;
const RECONNECT_MAX = 60000;
const SPAWN_TIMEOUT = 45000;
const WATCHDOG_INTERVAL = 15000;

// More natural movement: short walks, pauses, turns and occasional jumps.
const MOVE_MIN = 3500;
const MOVE_MAX = 9000;
const PAUSE_MIN = 2500;
const PAUSE_MAX = 7000;

function clearTimeoutSafe(t) { if (t) clearTimeout(t); return null; }
function clearIntervalSafe(t) { if (t) clearInterval(t); return null; }
function random(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function chance(percent) { return Math.random() * 100 < percent; }

function stopMovement() {
  if (!bot) return;
  for (const state of ['forward','back','left','right','jump','sneak','sprint']) {
    try { bot.setControlState(state, false); } catch (_) {}
  }
}

function cleanupTimers() {
  movementTimer = clearTimeoutSafe(movementTimer);
  armorTimer = clearTimeoutSafe(armorTimer);
  spawnTimer = clearTimeoutSafe(spawnTimer);
  watchdogTimer = clearIntervalSafe(watchdogTimer);
  armInterval = clearIntervalSafe(armInterval);
  chatInterval = clearIntervalSafe(chatInterval);
  stopMovement();
}

function randomInterval(base) { return base * (0.8 + Math.random() * 0.4); }

function scheduleReconnect(reason = 'connection ended') {
  if (shuttingDown || reconnectTimer) return;
  cleanupTimers();
  reconnectAttempt += 1;
  const delay = Math.min(RECONNECT_MAX, RECONNECT_MIN * Math.pow(2, Math.min(reconnectAttempt - 1, 4)));
  console.log(`🔄 [RECONNECT] #${reconnectAttempt} in ${Math.ceil(delay / 1000)}s | ${reason}`);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; createBot(); }, delay);
}

function dnsProbe() {
  return new Promise(resolve => {
    console.log(`🔎 [DNS] Resolving ${config.serverHost}...`);
    dns.lookup(config.serverHost, { all: true }, (err, addresses) => {
      if (err) { console.log(`❌ [DNS] ${err.code || 'ERROR'}: ${err.message}`); resolve(false); return; }
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
    const finish = ok => { if (finished) return; finished = true; try { socket.destroy(); } catch (_) {} resolve(ok); };
    socket.setTimeout(8000);
    socket.once('connect', () => { console.log('✅ [TCP] Port is reachable.'); finish(true); });
    socket.once('timeout', () => { console.log('⚠️ [TCP] Timeout after 8s.'); finish(false); });
    socket.once('error', err => { console.log(`❌ [TCP] ${err.code || 'ERROR'}: ${err.message}`); finish(false); });
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

  if (!(await preflight())) {
    console.log('⏳ [RETRY] Server unreachable. I will keep trying.');
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

  let lastEntityTime = Date.now();
  let currentAction = 0;

  // Natural-looking idle/movement cycle. It does not run constantly:
  // the bot walks for a while, stops, looks around, then chooses another action.
  function lookAround() {
    if (!bot?.entity) return;
    try {
      const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.8;
      const pitch = Math.max(-0.45, Math.min(0.45, bot.entity.pitch + (Math.random() - 0.5) * 0.5));
      bot.look(yaw, pitch, true);
    } catch (_) {}
  }

  function doShortWalk(direction, duration) {
    if (!bot?.entity) return;
    stopMovement();
    bot.setControlState(direction, true);
    if (chance(18)) bot.setControlState('sprint', true);
    if (chance(12)) {
      setTimeout(() => { if (bot?.entity) bot.setControlState('jump', true); }, random(500, Math.max(501, duration - 500)));
      setTimeout(() => { if (bot?.entity) bot.setControlState('jump', false); }, random(700, 1000));
    }
    movementTimer = setTimeout(() => {
      stopMovement();
      lookAround();
      scheduleNextMovement(random(PAUSE_MIN, PAUSE_MAX));
    }, duration);
  }

  function scheduleNextMovement(delay = random(PAUSE_MIN, PAUSE_MAX)) {
    movementTimer = clearTimeoutSafe(movementTimer);
    movementTimer = setTimeout(() => {
      if (!bot?.entity || shuttingDown) return;

      const actions = [
        () => doShortWalk('forward', random(MOVE_MIN, MOVE_MAX)),
        () => doShortWalk('back', random(2500, 6000)),
        () => doShortWalk('left', random(2200, 5000)),
        () => doShortWalk('right', random(2200, 5000)),
        () => { lookAround(); scheduleNextMovement(random(3000, 6500)); },
        () => {
          lookAround();
          if (chance(45)) bot.swingArm();
          scheduleNextMovement(random(3500, 7500));
        }
      ];

      // Avoid repeating the exact same action twice in a row.
      let next;
      do { next = random(0, actions.length - 1); } while (actions.length > 1 && next === currentAction);
      currentAction = next;
      actions[next]();
    }, delay);
  }

  function occasionalLook() {
    if (!bot?.entity) return;
    if (chance(70)) lookAround();
  }

  const armorSlots = {
    head: ['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet'],
    torso: ['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
    legs: ['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
    feet: ['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots']
  };

  let armorBusy = false;
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
    spawnTimer = clearTimeoutSafe(spawnTimer);
    console.log(`🎉 [SPAWN] SUCCESS — ${config.botUsername} joined ${config.serverHost}:${config.serverPort}`);
    if (bot.entity?.position) console.log(`📍 [POSITION] ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`);

    // Start with a short natural pause instead of instantly moving.
    lookAround();
    scheduleNextMovement(random(3000, 7000));
    armorTimer = setTimeout(equipArmor, 4000);
    armInterval = setInterval(occasionalLook, 25000);
    chatInterval = setInterval(() => {
      // No automatic chat spam; only a harmless status log.
      if (bot?.entity) console.log(`💚 [ALIVE] ${Math.floor((Date.now() - startedAt) / 1000)}s | hp=${bot.health} | food=${bot.food}`);
    }, 5 * 60 * 1000);
    watchdogTimer = setInterval(watchdog, 15000);
  });

  bot.on('move', () => { if (bot?.entity) lastEntityTime = Date.now(); });
  bot.on('game', game => console.log(`🎮 [GAME] ${game?.dimension || 'unknown dimension'}`));
  bot.on('health', () => console.log(`❤️ [HEALTH] ${bot.health} | food=${bot.food}`));
  bot.on('kicked', reason => console.log(`🚫 [KICKED] ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
  bot.on('error', err => console.log(`❌ [ERROR] ${err.code || 'NO_CODE'}: ${err.message}`));
  bot.on('end', reason => { console.log(`⛔ [END] ${reason || 'connection closed'}`); if (!shuttingDown) scheduleReconnect(reason || 'connection ended'); });
  bot.on('chat', (username, message) => { if (username !== config.botUsername) console.log(`💬 [CHAT IN] ${username}: ${message}`); });
  bot.on('playerCollect', collector => { if (collector.username === config.botUsername) { armorTimer = clearTimeoutSafe(armorTimer); armorTimer = setTimeout(equipArmor, 1000); } });

  spawnTimer = setTimeout(() => {
    if (!bot?.entity && !shuttingDown) {
      console.log(`⏱️ [SPAWN TIMEOUT] No spawn after ${SPAWN_TIMEOUT / 1000}s.`);
      try { bot.quit('Spawn timeout'); } catch (_) {}
      scheduleReconnect('spawn timeout');
    }
  }, SPAWN_TIMEOUT);
}

function start() { if (bot?.entity) return; shuttingDown = false; if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; createBot(); }
function stop(reason = 'manual stop') { shuttingDown = true; if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; cleanupTimers(); startedAt = null; try { bot?.quit(reason); } catch (_) {} bot = null; console.log(`🛑 [STOP] ${reason}`); }
function reconnect(reason = 'manual reconnect') { shuttingDown = false; if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; cleanupTimers(); try { bot?.quit(`Reconnect: ${reason}`); } catch (_) {} bot = null; console.log(`🔁 [MANUAL RECONNECT] ${reason}`); setTimeout(() => { if (!shuttingDown) createBot(); }, RECONNECT_MIN); }
function chat(message) { if (!bot?.entity) throw new Error('Bot is offline'); bot.chat(String(message)); }
function shutdown(signal) { stop(signal); setTimeout(() => process.exit(0), 1000).unref(); }
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('============================================================');
console.log(`🤖 Survival Economy Bot | ${new Date().toISOString()}`);
console.log(`🎯 ${config.serverHost}:${config.serverPort} | 👤 ${config.botUsername}`);
console.log('♾️ Continuous retry: ENABLED');
console.log('🧍 Natural movement: ENABLED');
console.log('============================================================');
start();

module.exports = { getBot: () => bot, getConfig: () => config, getStartedAt: () => startedAt, start, stop, reconnect, chat };
