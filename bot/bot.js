const mineflayer = require('mineflayer');
const config = require('./config.json');

let bot;

function createBot() {
  bot = mineflayer.createBot({
    host: config.serverHost,
    port: config.serverPort,
    username: config.botUsername,
    auth: 'offline',
    version: config.version || false,
    viewDistance: config.botChunk
  });

  // ===== Anti-AFK Movement =====
  let movementPhase = 0;
  const STEP_INTERVAL = 1200;
  const JUMP_DURATION = 400;

  const movements = [
    () => { bot.setControlState('forward', true);  bot.setControlState('back', false);  bot.setControlState('left', false);  bot.setControlState('right', false); },
    () => { bot.setControlState('forward', false); bot.setControlState('back', true);   bot.setControlState('left', false);  bot.setControlState('right', false); },
    () => { bot.setControlState('forward', false); bot.setControlState('back', false);  bot.setControlState('left', true);   bot.setControlState('right', false); },
    () => { bot.setControlState('forward', false); bot.setControlState('back', false);  bot.setControlState('left', false);  bot.setControlState('right', true);  },
    () => {
      bot.setControlState('forward', false); bot.setControlState('back', false);
      bot.setControlState('left', false);    bot.setControlState('right', false);
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), JUMP_DURATION);
    },
    () => {
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      setTimeout(() => { bot.setControlState('jump', false); bot.setControlState('forward', false); }, JUMP_DURATION);
    },
    () => {
      // تدوير النظر في اتجاه عشوائي
      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * Math.PI * 0.5;
      bot.look(yaw, pitch, true);
    },
    () => {
      bot.setControlState('sneak', true);
      setTimeout(() => bot.setControlState('sneak', false), 800);
    },
  ];

  function stopAll() {
    ['forward','back','left','right','jump','sneak','sprint'].forEach(s => bot.setControlState(s, false));
  }

  function movementCycle() {
    if (!bot.entity) return;
    stopAll();
    movements[movementPhase]();
    movementPhase = (movementPhase + 1) % movements.length;
    setTimeout(movementCycle, STEP_INTERVAL);
  }

  // ===== Chat Message Every Hour =====
  const chatMessages = [
    'AFK Bot is active!',
    'Still here, keeping the server alive!',
    'Bot running smoothly.',
    'Server is alive and well!',
  ];
  let chatIndex = 0;

  function sendHourlyChat() {
    if (!bot.entity) return;
    const msg = chatMessages[chatIndex % chatMessages.length];
    bot.chat(msg);
    console.log(`💬 Bot said: "${msg}"`);
    chatIndex++;
  }

  let chatInterval = null;

  // ===== Events =====
  bot.on('spawn', () => {
    setTimeout(() => {
      bot.setControlState('sneak', true);
      console.log(`✅ ${config.botUsername} is Ready! Connected to ${config.serverHost}:${config.serverPort}`);
      // تغيير الشكل لروبوت عبر SkinsRestorer
      bot.chat('/skin set R0B0T_');
      console.log('🎨 Skin change command sent!');
    }, 3000);

    setTimeout(movementCycle, STEP_INTERVAL);

    // رسالة شات كل ساعة
    chatInterval = setInterval(sendHourlyChat, 60 * 60 * 1000);
  });

  bot.on('chat', (username, message) => {
    if (username === config.botUsername) return;
    console.log(`💬 [${username}]: ${message}`);
  });

  bot.on('error', (err) => {
    console.error('⚠️ Error:', err.message);
  });

  bot.on('end', (reason) => {
    if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
    console.log(`⛔ Bot Disconnected (${reason}). Reconnecting in 5s...`);
    setTimeout(createBot, 5000);
  });

  bot.on('kicked', (reason) => {
    console.log(`🚫 Bot was kicked: ${reason}`);
  });
}

console.log(`🤖 Starting AFK Bot → ${config.serverHost}:${config.serverPort}`);
createBot();
