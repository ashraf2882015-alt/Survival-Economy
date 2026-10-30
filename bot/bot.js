const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const net = require('net');
const dns = require('dns');
const https = require('https');
const fs = require('fs');
const path = require('path');

// AuthMe credentials are supplied locally; never commit them to the repository.
const AUTHME_PASSWORD = process.env.BOT_AUTHME_PASSWORD;
const AUTH_STATE_FILE = path.join(__dirname, '.auth-state.json');
function readAuthState() {
  try { return JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveAuthState(username) {
  const state = readAuthState();
  state[username] = { registered: true };
  try { fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 }); }
  catch (err) { console.log(`⚠️ [AUTHME] Could not save local registration state: ${err.message}`); }
}
function isAuthRegistered(username) { return readAuthState()[username]?.registered === true; }
const config = require('./config.json');

// Exactly two independent server sessions are configured in config.json.
const servers = Array.isArray(config.servers) && config.servers.length
  ? config.servers.slice()
  : [`${config.serverHost}:${config.serverPort}`];

const RECONNECT_MIN = 5000;
const RECONNECT_MAX = 60000;
const SPAWN_TIMEOUT = 45000;
const CONTROL_URL = 'https://raw.githubusercontent.com/ashraf2882015-alt/Survival-Economy/main/control.json';

let shuttingDown = false;
let lastControlId = 0;
let danceEnabled = true;

function parseServer(value) {
  const text = String(value).trim();
  const lastColon = text.lastIndexOf(':');
  if (lastColon > -1 && /^\d+$/.test(text.slice(lastColon + 1))) {
    return { host: text.slice(0, lastColon), port: Number(text.slice(lastColon + 1)) };
  }
  return { host: text, port: 25565 };
}

function chance(percent) { return Math.random() * 100 < percent; }

function makeSession(serverValue, index) {
  const server = parseServer(serverValue);
  const state = {
    index,
    server,
    bot: null,
    reconnectTimer: null,
    spawnTimer: null,
    movementTimer: null,
    armorTimer: null,
    armInterval: null,
    reconnectAttempt: 0,
    connectionAttempt: 0,
    nextUsername: `${config.botUsername || 'Bot'}${index > 1 ? index : ''}`.slice(0, 16),
    startWandering: null,
    startedAt: null,
    kickHandled: false
  };

  const prefix = () => `[BOT ${state.index} ${state.server.host}:${state.server.port}]`;

  function clearTimer(name) {
    if (state[name]) clearTimeout(state[name]);
    state[name] = null;
  }
  function clearIntervalTimer(name) {
    if (state[name]) clearInterval(state[name]);
    state[name] = null;
  }
  function stopMovement() {
    if (!state.bot) return;
    for (const key of ['forward','back','left','right','jump','sneak','sprint']) {
      try { state.bot.setControlState(key, false); } catch (_) {}
    }
  }
  function cleanup() {
    clearTimer('movementTimer');
    state.startWandering = null;
    try { state.bot?.pathfinder?.setGoal(null); } catch (_) {}
    clearTimer('armorTimer');
    clearTimer('spawnTimer');
    clearIntervalTimer('armInterval');
    stopMovement();
  }
  function scheduleReconnect(reason) {
    if (shuttingDown || state.reconnectTimer) return;
    cleanup();
    state.reconnectAttempt += 1;
    const delay = Math.min(RECONNECT_MAX, RECONNECT_MIN * Math.pow(2, Math.min(state.reconnectAttempt - 1, 4)));
    console.log(`${prefix()} 🔄 Reconnect #${state.reconnectAttempt} in ${Math.ceil(delay / 1000)}s | ${reason}`);
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (!shuttingDown) createBot();
    }, delay);
  }
  function dnsProbe() {
    return new Promise(resolve => {
      console.log(`${prefix()} 🔎 DNS ${state.server.host}`);
      dns.lookup(state.server.host, { all: true }, (err, addresses) => {
        if (err) { console.log(`${prefix()} ❌ DNS ${err.code || 'ERROR'}: ${err.message}`); resolve(false); return; }
        console.log(`${prefix()} ✅ DNS ${addresses.map(a => a.address).join(', ')}`);
        resolve(true);
      });
    });
  }
  function tcpProbe() {
    return new Promise(resolve => {
      const socket = net.createConnection({ host: state.server.host, port: state.server.port });
      let finished = false;
      const finish = ok => { if (finished) return; finished = true; try { socket.destroy(); } catch (_) {} resolve(ok); };
      socket.setTimeout(8000);
      socket.once('connect', () => { console.log(`${prefix()} ✅ TCP reachable`); finish(true); });
      socket.once('timeout', () => { console.log(`${prefix()} ⚠️ TCP timeout`); finish(false); });
      socket.once('error', err => { console.log(`${prefix()} ❌ TCP ${err.code || 'ERROR'}: ${err.message}`); finish(false); });
    });
  }
  async function preflight() {
    console.log(`${prefix()} 🧪 Preflight | version=${config.version || 'auto'}`);
    if (!(await dnsProbe())) return false;
    return tcpProbe();
  }

  async function createBot() {
    if (shuttingDown || state.bot) return;
    cleanup();
    state.connectionAttempt += 1;
    const username = state.nextUsername;
    console.log(`\n${prefix()} ================ ATTEMPT #${state.connectionAttempt} ================`);
    console.log(`${prefix()} 👤 ${username}`);
    if (!(await preflight())) {
      scheduleReconnect('preflight failed');
      return;
    }
    try {
      state.bot = mineflayer.createBot({
        host: state.server.host,
        port: state.server.port,
        username,
        auth: 'offline',
        version: config.version || false,
        viewDistance: config.botChunk
      });
      console.log(`${prefix()} 🚀 Connection started`);
    } catch (err) {
      state.bot = null;
      console.log(`${prefix()} ❌ Create: ${err.code || 'ERROR'}: ${err.message}`);
      scheduleReconnect('createBot error');
      return;
    }

    const bot = state.bot;
    let danceIndex = 0;
    const armorSlots = {
      head:['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet'],
      torso:['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
      legs:['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
      feet:['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots']
    };
    let armorBusy = false;
    function lookAround() {
      if (!bot?.entity) return;
      try { bot.look(bot.entity.yaw + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 0.35, true); } catch (_) {}
    }
    function chooseWanderTarget() {
      if (!bot?.entity || shuttingDown || !danceEnabled) return;
      const pos = bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      const distance = 8 + Math.random() * 12;
      const x = Math.floor(pos.x + Math.cos(angle) * distance);
      const z = Math.floor(pos.z + Math.sin(angle) * distance);
      const y = Math.floor(pos.y);
      try {
        bot.pathfinder.setGoal(new GoalNear(x, y, z, 2));
        console.log(`${prefix()} 🧭 Wandering toward ${x}, ${y}, ${z}`);
      } catch (err) {
        console.log(`${prefix()} ⚠️ Path goal: ${err.message}`);
        state.movementTimer = setTimeout(chooseWanderTarget, 3000);
      }
    }
    function startWandering() {
      if (!bot?.entity || shuttingDown || !danceEnabled) return;
      clearTimer('movementTimer');
      chooseWanderTarget();
    }
    async function equipArmor() {
      if (!bot?.entity || armorBusy) return;
      armorBusy = true;
      try {
        for (const [slot, items] of Object.entries(armorSlots)) {
          for (const itemName of items) {
            const item = bot.inventory.items().find(i => i.name === itemName);
            if (!item) continue;
            try { await bot.equip(item, slot); console.log(`${prefix()} 🛡️ ${itemName} → ${slot}`); } catch (_) {}
            break;
          }
        }
      } finally { armorBusy = false; }
    }

    bot.loadPlugin(pathfinder);
    bot.once('login', () => console.log(`${prefix()} 🔐 Login accepted as ${username}`));
    bot.once('spawn', () => {
      state.reconnectAttempt = 0;
      // Register this dedicated bot account once, then login on later joins.
      setTimeout(() => {
        if (state.bot !== bot || !bot.player) return;
        if (!AUTHME_PASSWORD) {
          console.log(`${prefix()} ⚠️ Set BOT_AUTHME_PASSWORD locally to enable AuthMe`);
          return;
        }
        try {
          if (isAuthRegistered(username)) {
            bot.chat(`/login ${AUTHME_PASSWORD}`);
            console.log(`${prefix()} 🔐 AuthMe login command sent`);
          } else {
            bot.chat(`/register ${AUTHME_PASSWORD} ${AUTHME_PASSWORD}`);
            console.log(`${prefix()} 📝 AuthMe first-time register command sent`);
          }
        } catch (err) {
          console.log(`${prefix()} ⚠️ AuthMe command failed: ${err.message}`);
        }
      }, 1800);
      state.startedAt = Date.now();
      clearTimer('spawnTimer');
      console.log(`${prefix()} 🎉 SPAWN SUCCESS — ${username}`);
      if (bot.entity?.position) console.log(`${prefix()} 📍 ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`);
      const movement = new Movements(bot);
      movement.canDig = false;
      movement.allow1by1towers = false;
      movement.allowParkour = false;
      movement.allowSprinting = true;
      bot.pathfinder.setMovements(movement);
      state.startWandering = startWandering;
      if (danceEnabled) startWandering();
      bot.on('goal_reached', () => {
        clearTimer('movementTimer');
        state.movementTimer = setTimeout(chooseWanderTarget, 1200 + Math.random() * 1800);
      });
      bot.on('path_update', result => {
        if (result.status === 'noPath' || result.status === 'timeout') {
          clearTimer('movementTimer');
          state.movementTimer = setTimeout(chooseWanderTarget, 2500);
        }
      });
      state.armorTimer = setTimeout(equipArmor, 4000);
      state.armInterval = setInterval(() => { if (bot?.entity && chance(70)) lookAround(); }, 8000);
    });
    bot.on('game', game => console.log(`${prefix()} 🎮 ${game?.dimension || 'unknown dimension'}`));
    bot.on('health', () => console.log(`${prefix()} ❤️ hp=${bot.health} food=${bot.food}`));
    bot.on('kicked', reason => { console.log(`${prefix()} 🚫 KICKED ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`); });
    bot.on('error', err => console.log(`${prefix()} ❌ ERROR ${err.code || 'NO_CODE'}: ${err.message}`));
    bot.on('end', reason => {
      state.bot = null;
      console.log(`${prefix()} ⛔ END ${reason || 'connection closed'}`);
      if (!shuttingDown) scheduleReconnect(reason || 'connection ended');
    });
    bot.on('messagestr', message => {
      const text = String(message || '').toLowerCase();
      if (text.includes('successfully registered') || text.includes('registration successful') || text.includes('you are now registered')) {
        saveAuthState(username);
        console.log(`${prefix()} ✅ AuthMe registration confirmed and saved locally`);
      } else if (text.includes('already registered')) {
        saveAuthState(username);
        console.log(`${prefix()} ℹ️ AuthMe says account is already registered; logging in`);
        if (state.bot === bot && AUTHME_PASSWORD) bot.chat(`/login ${AUTHME_PASSWORD}`);
      } else if (text.includes('successfully logged in') || text.includes('successful login') || text.includes('you are now logged in')) {
        console.log(`${prefix()} ✅ AuthMe login confirmed`);
      } else if (text.includes('wrong password') || text.includes('incorrect password') || text.includes('invalid password')) {
        console.log(`${prefix()} ❌ AuthMe rejected the configured bot password`);
      }
    });
    bot.on('chat', (usernameIn, message) => { if (usernameIn !== username) console.log(`${prefix()} 💬 ${usernameIn}: ${message}`); });
    bot.on('playerCollect', collector => { if (collector.username === username) { clearTimer('armorTimer'); state.armorTimer = setTimeout(equipArmor, 1000); } });
    state.spawnTimer = setTimeout(() => {
      if (!state.bot?.entity && !shuttingDown) {
        console.log(`${prefix()} ⏱️ Spawn timeout`);
        try { bot.quit('Spawn timeout'); } catch (_) {}
        scheduleReconnect('spawn timeout');
      }
    }, SPAWN_TIMEOUT);
  }

  function stop(reason = 'manual stop') {
    cleanup();
    clearTimer('reconnectTimer');
    state.startedAt = null;
    try { state.bot?.quit(reason); } catch (_) {}
    state.bot = null;
  }
  function reconnect(reason = 'manual reconnect') {
    if (shuttingDown) return;
    cleanup();
    clearTimer('reconnectTimer');
    try { state.bot?.quit(`Reconnect: ${reason}`); } catch (_) {}
    state.bot = null;
    setTimeout(() => { if (!shuttingDown) createBot(); }, RECONNECT_MIN);
  }

  return { state, createBot, stop, reconnect };
}

const sessions = servers.map((server, i) => makeSession(server, i + 1));

function startAll() {
  console.log(`🚀 Starting ${sessions.length} Minecraft bot connection(s)...`);
  for (const session of sessions) session.createBot();
}
function stopAll(reason = 'manual stop') {
  for (const session of sessions) session.stop(reason);
}
function reconnectAll(reason = 'manual reconnect') {
  for (const session of sessions) session.reconnect(reason);
}
function chatAll(message) {
  for (const session of sessions) {
    try { session.state.bot?.chat(String(message)); } catch (_) {}
  }
}
function setNameAll(name) {
  const clean = String(name || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  if (!clean) throw new Error('Invalid username');
  sessions.forEach((session, i) => {
    session.state.nextUsername = `${clean}${i + 1}`.slice(0, 16);
    session.reconnect(`name changed to ${clean}`);
  });
}
function setMovement(enabled) {
  danceEnabled = Boolean(enabled);
  sessions.forEach(s => {
    try {
      if (!danceEnabled) {
        s.state.bot?.pathfinder?.setGoal(null);
      } else if (s.state.startWandering) {
        s.state.startWandering();
      }
    } catch (_) {}
  });
}

function pollControl() {
  https.get(`${CONTROL_URL}?t=${Date.now()}`, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const c = JSON.parse(data);
        if (!c || Number(c.id || 0) <= lastControlId) return;
        lastControlId = Number(c.id);
        console.log(`🎛️ [CONTROL] ${c.action}`);
        if (c.action === 'stop') stopAll('Web control');
        else if (c.action === 'start') startAll();
        else if (c.action === 'reconnect') reconnectAll('Web control');
        else if (c.action === 'chat') chatAll(String(c.value || ''));
        else if (c.action === 'name') setNameAll(c.value);
        else if (c.action === 'movement') setMovement(c.value === true || c.value === 'on' || c.value === 1);
      } catch (e) { console.log(`⚠️ [CONTROL] ${e.message}`); }
    });
  }).on('error', e => console.log(`⚠️ [CONTROL] ${e.message}`));
}

function shutdown(signal) {
  shuttingDown = true;
  stopAll(signal);
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('============================================================');
console.log(`🤖 Survival Economy Bot | ${new Date().toISOString()}`);
console.log(`🎯 Servers: ${servers.length}`);
servers.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
console.log(`👤 Base username: ${config.botUsername || 'Bot'}`);
console.log('♾️ Continuous retry: ENABLED');
console.log('🧭 Free roaming with pathfinder: ENABLED');
console.log('🔄 Reconnect on disconnect: ENABLED');
console.log('🛡️ Entity-movement watchdog: DISABLED');
console.log('🎛️ GitHub control polling: ENABLED');
console.log('============================================================');

setInterval(pollControl, 3000);
pollControl();
startAll();

module.exports = {
  getBots: () => sessions.map(s => s.state.bot),
  getConfig: () => config,
  start: startAll,
  stop: stopAll,
  reconnect: reconnectAll,
  chat: chatAll,
  setName: setNameAll,
  setMovement
};
