// CounselFlow Frontend + Reverse Proxy Server
// Serves static files on port 3001 AND proxies /api + /socket.io to backend port 5001
// This means ONE ngrok tunnel (port 3001) handles everything.

const path = require('path');
const fs   = require('fs');
const http = require('http');
const net  = require('net');

const ROOT         = __dirname;
const PORT         = process.env.PORT || 3001;
const BACKEND_PORT = process.env.BACKEND_PORT || 5001;
const BACKEND_HOST = process.env.BACKEND_HOST || 'localhost';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css',
  '.js'  : 'application/javascript',
  '.json': 'application/json',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff' : 'font/woff',
  '.ttf'  : 'font/ttf',
  '.mp3'  : 'audio/mpeg',
};

function resolveStaticPath(requestPath) {
  if (requestPath === '/' || requestPath === '') {
    return '/index.html';
  }

  return requestPath;
}

//  Reverse Proxy helper (HTTP requests) 
function proxyHttpRequest(req, res) {
  const options = {
    hostname: BACKEND_HOST,
    port    : BACKEND_PORT,
    path    : req.url,
    method  : req.method,
    headers : { ...req.headers, host: `${BACKEND_HOST}:${BACKEND_PORT}` },
  };

  const proxy = http.request(options, (proxyRes) => {
    // Forward CORS headers so browser doesn't block
    const headers = {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin' : '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxy.on('error', (err) => {
    console.error('[Proxy] Backend unreachable:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend server (port 5001) is not running. Start it with: node server/index.js' }));
  });

  req.pipe(proxy, { end: true });
}

//  Static file server 
const server = http.createServer((req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin' : '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    res.end();
    return;
  }

  // Proxy /api/* and /socket.io/* to backend
  if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
    proxyHttpRequest(req, res);
    return;
  }

  if (req.url.split('?')[0] === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Static file serving
  const requestPath = req.url.split('?')[0]; // Strip query strings
  const filePath = resolveStaticPath(requestPath);
  const fullPath   = path.join(ROOT, filePath);
  const ext        = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`File not found: ${filePath}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

//  WebSocket Upgrade Proxy (for Socket.IO long-polling + ws upgrade) 
server.on('upgrade', (req, clientSocket, head) => {
  if (req.url.startsWith('/socket.io')) {
    console.log('[WS Proxy] Upgrading WebSocket to backend:', req.url);

    const backendSocket = net.connect(BACKEND_PORT, BACKEND_HOST, () => {
      // Reconstruct HTTP upgrade request headers
      const headersStr = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');

      backendSocket.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        headersStr + '\r\n\r\n'
      );
      if (head && head.length) backendSocket.write(head);
    });

    backendSocket.on('error', (err) => {
      console.error('[WS Proxy] Backend WebSocket error:', err.message);
      if (!clientSocket.destroyed) clientSocket.destroy();
    });

    clientSocket.on('error', (err) => {
      console.error('[WS Proxy] Client WebSocket error:', err.message);
      if (!backendSocket.destroyed) backendSocket.destroy();
    });

    backendSocket.pipe(clientSocket).on('error', () => {});
    clientSocket.pipe(backendSocket).on('error', () => {});
  }
});

server.listen(PORT, () => {
  console.log(` CounselFlow Frontend + Proxy: http://localhost:${PORT}`);
  console.log(`   → Static files served from: ${ROOT}`);
  console.log(`   → /api/* and /socket.io/* proxied to: http://localhost:${BACKEND_PORT}`);
  console.log(`\n Using ngrok on port ${PORT}? Everything works through ONE tunnel!`);
});
