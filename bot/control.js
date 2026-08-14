const http = require('http');
const fs = require('fs');
const path = require('path');
const botApi = require('./bot.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const INDEX = path.join(__dirname, '..', 'index.html');

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function status() {
  const bots = typeof botApi.getBots === 'function' ? botApi.getBots() : [];
  const config = botApi.getConfig();
  const servers = Array.isArray(config.servers) ? config.servers : [];

  return {
    online: bots.filter(bot => Boolean(bot?.entity)).length,
    total: bots.length,
    connecting: bots.filter(Boolean).length,
    servers,
    bots: bots.map((bot, index) => ({
      index: index + 1,
      online: Boolean(bot?.entity),
      connecting: Boolean(bot),
      username: bot?.username || `${config.botUsername || 'Bot'}${index + 1}`,
      health: bot?.health ?? null,
      food: bot?.food ?? null,
      position: bot?.entity?.position ? {
        x: Number(bot.entity.position.x.toFixed(1)),
        y: Number(bot.entity.position.y.toFixed(1)),
        z: Number(bot.entity.position.z.toFixed(1))
      } : null
    }))
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/api/status') return json(res, 200, status());

  if (req.method === 'POST' && req.url === '/api/action') {
    try {
      const body = await readBody(req);
      const action = String(body.action || '');
      if (action === 'start') botApi.start();
      else if (action === 'stop') botApi.stop('Stopped from web panel');
      else if (action === 'reconnect') botApi.reconnect('Web panel reconnect');
      else if (action === 'chat') {
        if (!body.message || String(body.message).length > 500) return json(res, 400, { error: 'Invalid message' });
        botApi.chat(String(body.message));
      } else return json(res, 400, { error: 'Unknown action' });
      return json(res, 200, { ok: true, status: status() });
    } catch (err) {
      return json(res, 400, { error: err.message || 'Action failed' });
    }
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(INDEX, (err, data) => {
      if (err) return json(res, 500, { error: 'index.html not found' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`🌐 [WEB] Control panel listening on http://${HOST}:${PORT}`);
});

// A malformed/unsupported packet should not leave the GitHub runner dead.
// Mineflayer can surface protocol decoder failures as uncaught exceptions.
process.on('uncaughtException', err => {
  console.error(`💥 [PROCESS] Uncaught exception: ${err?.stack || err}`);
  try {
    botApi.reconnect('protocol/process exception');
  } catch (reconnectError) {
    console.error(`💥 [PROCESS] Recovery failed: ${reconnectError?.stack || reconnectError}`);
  }
});

process.on('unhandledRejection', reason => {
  console.error(`💥 [PROCESS] Unhandled rejection: ${reason?.stack || reason}`);
});

function shutdown() {
  server.close();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
