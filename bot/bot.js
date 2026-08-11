const mineflayer = require('mineflayer');
const config = require('./config.json');

let bot;
let reconnectTimer = null;

function createBot() {
  bot = mineflayer.createBot({
    host: config.serverHost,
    port: config.serverPort,
    username: config.botUsername,
    auth: 'offline',
    version: config.version || false,
    viewDistance: config.botChunk
  });

  let movementPhase = 0;
  const STEP_INTERVAL = 1200;
  const JUMP_DURATION = 400;
  let movementTimer = null;
  let armInterval = null;
  let chatInterval = null;
  let rightClickInterval = null;
  let reconnectScheduled = false;

  const movements = [
    () => { bot.setControlState('forward', true);  bot.setControlState('back', false);  bot.setControlState('left', false);  bot.setControlState('right', false); },
    () => { bot.setControlState('forward', false); bot.setControlState('back', true);   bot.setControlState('left', false);  bot.setControlState('right', false); },
    () => { bot.setControlState('forward', false); bot.setControlState('back', false);  bot.setControlState('left', true);   bot.setControlState('right', false); },
    () => { bot.setControlState('forward', false); bot.setControlState('back', false);  bot.setControlState('left', false);  bot.setControlState('right', true);  },
    () => {
      stopAll();
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot?.entity) bot.setControlState('jump', false);
      }, JUMP_DURATION);
    },
    () => {
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot?.entity) {
          bot.setControlState('jump', false);
          bot.setControlState('forward', false);
        }
      }, JUMP_DURATION);
    },
    () => {
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
      bot.look(yaw, pitch, true).catch?.(() => {});
    },
    () => {
      bot.setControlState('sneak', true);
      setTimeout(() => {
        if (bot?.entity) bot.setControlState('sneak', false);
      }, 800);
    },
  ];

  function stopAll() {
    if (!bot) return;
    ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].forEach(state => {
      try { bot.setControlState(state, false); } catch (_) {}
    });
  }

  function randomInterval(base) {
    return base * (0.8 + Math.random() * 0.4);
  }

  function swingArm() {
    if (!bot?.entity) return;
    try { bot.swingArm(); } catch (_) {}
  }

  function movementCycle() {
    if (!bot?.entity) return;
    stopAll();
    movements[movementPhase]();
    swingArm();
    movementPhase = (movementPhase + 1) % movements.length;
    movementTimer = setTimeout(movementCycle, randomInterval(STEP_INTERVAL));
  }

  const chatMessages = [
    'AFK Bot is active!',
    'Still here, keeping the server alive!',
    'Bot running smoothly.',
    'Server is alive and well!',
  ];
  let chatIndex = 0;

  function sendHourlyChat() {
    if (!bot?.entity) return;
    const msg = chatMessages[chatIndex % chatMessages.length];
    try {
      bot.chat(msg);
      console.log(`💬 Bot said: "${msg}"`);
      chatIndex++;
    } catch (_) {}
  }

  async function rightClickInventoryItem() {
    if (!bot?.entity) return;
    const item = bot.inventory.items()[0];
    if (!item) return;

    try {
      await bot.equip(item, 'hand');
      for (let i = 0; i < 3; i++) {
        bot.activateItem();
        await new Promise(resolve => setTimeout(resolve, 300));
        bot.deactivateItem();
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      console.log(`🖱️ Right-clicked "${item.name}" 3 times`);
    } catch (_) {}
  }

  const armorSlots = {
    head: ['netherite_helmet','diamond_helmet','iron_helmet','golden_helmet','chainmail_helmet','leather_helmet'],
    torso: ['netherite_chestplate','diamond_chestplate','iron_chestplate','golden_chestplate','chainmail_chestplate','leather_chestplate'],
    legs: ['netherite_leggings','diamond_leggings','iron_leggings','golden_leggings','chainmail_leggings','leather_leggings'],
    feet: ['netherite_boots','diamond_boots','iron_boots','golden_boots','chainmail_boots','leather_boots'],
  };

  async function equipArmor() {
    if (!bot?.entity) return;
    for (const [slot, items] of Object.entries(armorSlots)) {
      for (const itemName of items) {
        const item = bot.inventory.items().find(i => i.name === itemName);
        if (!item) continue;
        try {
          await bot.equip(item, slot);
          console.log(`🛡️ Equipped ${itemName} on ${slot}`);
        } catch (_) {}
        break;
      }
    }
  }

  function cleanup() {
    stopAll();
    if (movementTimer) clearTimeout(movementTimer);
    if (armInterval) clearInterval(armInterval);
    if (chatInterval) clearInterval(chatInterval);
    if (rightClickInterval) clearInterval(rightClickInterval);
    movementTimer = null;
    armInterval = null;
    chatInterval = null;
    rightClickInterval = null;
  }

  function scheduleReconnect() {
    if (reconnectScheduled) return;
    reconnectScheduled = true;
    console.log('🔄 Reconnecting in 5 seconds...');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectScheduled = false;
      createBot();
    }, 5000);
  }

  bot.on('spawn', () => {
    console.log(`🌐 Connected to ${config.serverHost}:${config.serverPort}`);

    setTimeout(() => {
      if (!bot?.entity) return;
      bot.setControlState('sneak', true);
      console.log(`✅ ${config.botUsername} is Ready!`);
    }, 3000);

    movementTimer = setTimeout(movementCycle, STEP_INTERVAL);
    setTimeout(equipArmor, 4000);
    rightClickInterval = setInterval(rightClickInventoryItem, 2 * 60 * 1000);
    chatInterval = setInterval(sendHourlyChat, 60 * 60 * 1000);
    armInterval = setInterval(swingArm, 30000);
  });

  bot.on('playerCollect', collector => {
    if (collector.username === config.botUsername) {
      setTimeout(equipArmor, 1000);
    }
  });

  bot.on('chat', (username, message) => {
    if (username === config.botUsername) return;
    console.log(`💬 [${username}]: ${message}`);
  });

  bot.on('error', err => {
    console.error('⚠️ Error:', err.message);
  });

  bot.on('kicked', reason => {
    console.log(`🚫 Bot was kicked: ${reason}`);
  });

  bot.on('end', reason => {
    cleanup();
    console.log(`⛔ Bot Disconnected (${reason}).`);
    scheduleReconnect();
  });
}

process.on('SIGTERM', () => {
  cleanupCurrentBot();
  process.exit(0);
});

process.on('SIGINT', () => {
  cleanupCurrentBot();
  process.exit(0);
});

function cleanupCurrentBot() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  try { bot?.quit('Process shutting down'); } catch (_) {}
}

console.log(`🤖 Starting AFK Bot → ${config.serverHost}:${config.serverPort}`);
createBot();
