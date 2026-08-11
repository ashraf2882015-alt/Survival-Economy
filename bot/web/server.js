const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const botModule = require('../bot.js');

const PORT = Number(process.env.WEB_PORT || 3000);
const HOST = process.env.WEB_HOST || '127.0.0.1';
const PASSWORD = process.env.CONTROL_PASSWORD || '';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function authorized(req) {
  if (!PASSWORD) return true;
  return req.headers.authorization === `Bearer ${PASSWORD}`;
}

function status() {
  const bot = botModule.getBot();
  const startedAt = botModule.getStartedAt();
  return {
    online: Boolean(bot?.entity),
    username: botModule.getConfig().botUsername,
    host: botModule.getConfig().serverHost,
    port: botModule.getConfig().serverPort,
    uptime: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    health: bot?.health ?? null,
    food: bot?.food ?? null,
    position: bot?.entity?.position ? {
      x: Number(bot.entity.position.x.toFixed(2)),
      y: Number(bot.entity.position.y.toFixed(2)),
      z: Number(bot.entity.position.z.toFixed(2))
    } : null
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, status());
  }

  if (url.pathname === '/api/control' && req.method === 'POST') {
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const action = JSON.parse(body).action;
        if (action === 'reconnect') botModule.reconnect('web panel');
        else if (action === 'stop') botModule.stop('web panel');
        else if (action === 'start') botModule.start();
        else return json(res, 400, { error: 'Unknown action' });
        json(res, 200, { ok: true, action });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const message = JSON.parse(body).message;
        if (typeof message !== 'string' || !message.trim()) {
          return json(res, 400, { error: 'Message is required' });
        }
        botModule.chat(message.slice(0, 200));
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    });
    return;
  }

  const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  const filePath = path.join(__dirname, file);
  if (!filePath.startsWith(path.resolve(__dirname)) || !fs.existsSync(filePath)) {
    return json(res, 404, { error: 'Not found' });
  }

  const ext = path.extname(filePath);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`🌐 Control panel: http://${HOST}:${PORT}`);
});
