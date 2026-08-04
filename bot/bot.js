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

  let movementPhase = 0;
  const STEP_INTERVAL = 1500;
  const JUMP_DURATION = 500;

  bot.on('spawn', () => {
    setTimeout(() => {
      bot.setControlState('sneak', true);
      console.log(`✅ ${config.botUsername} is Ready! Connected to ${config.serverHost}:${config.serverPort}`);
    }, 3000);

    setTimeout(movementCycle, STEP_INTERVAL);
  });

  function movementCycle() {
    if (!bot.entity) return;

    switch (movementPhase) {
      case 0:
        bot.setControlState('forward', true);
        bot.setControlState('back', false);
        bot.setControlState('jump', false);
        break;
      case 1:
        bot.setControlState('forward', false);
        bot.setControlState('back', true);
        bot.setControlState('jump', false);
        break;
      case 2:
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        bot.setControlState('jump', true);
        setTimeout(() => {
          bot.setControlState('jump', false);
        }, JUMP_DURATION);
        break;
      case 3:
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        bot.setControlState('jump', false);
        break;
    }

    movementPhase = (movementPhase + 1) % 4;

    setTimeout(movementCycle, STEP_INTERVAL);
  }

  bot.on('error', (err) => {
    console.error('⚠️ Error:', err.message);
  });

  bot.on('end', (reason) => {
    console.log(`⛔ Bot Disconnected (${reason}). Reconnecting in 5s...`);
    setTimeout(createBot, 5000);
  });

  bot.on('kicked', (reason) => {
    console.log(`🚫 Bot was kicked: ${reason}`);
  });
}

console.log(`🤖 Starting AFK Bot → ${config.serverHost}:${config.serverPort}`);
createBot();
