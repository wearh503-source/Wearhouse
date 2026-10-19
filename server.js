const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const MIME = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let [rawPath, queryString] = req.url.split('?');
  let cleanPath = rawPath.toLowerCase();

  // Route rewrites matching Firebase Hosting
  if (cleanPath === '/' || cleanPath === '') {
    cleanPath = '/index.html';
  } else if (cleanPath === '/core') {
    cleanPath = '/core.html';
  } else if (cleanPath === '/core/tees' || cleanPath === '/core/pants') {
    cleanPath = '/category.html';
  } else if (cleanPath.startsWith('/product')) {
    cleanPath = '/product.html';
  } else if (cleanPath === '/checkout') {
    cleanPath = '/checkout.html';
  } else if (cleanPath === '/order') {
    cleanPath = '/order.html';
  } else if (cleanPath === '/admin') {
    cleanPath = '/admin.html';
  } else if (cleanPath === '/policies') {
    cleanPath = '/policies.html';
  }

  // Handle local mock API fallback for checkout testing if live function isn't running
  if (cleanPath === '/api/checkout' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const total = (parsed.items || []).reduce((acc, i) => acc + (149900 * (i.qty || 1)), 0);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          orderId: 'wh_test_' + Math.random().toString(36).substring(2, 10),
          readToken: 'token_' + Math.random().toString(36).substring(2, 12),
          razorpayOrderId: 'order_test_' + Math.random().toString(36).substring(2, 10),
          amount: total || 149900,
          currency: 'INR',
          keyId: 'rzp_test_placeholder'
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (cleanPath === '/api/verify' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: "Local mock verified" }));
    return;
  }

  const filePath = path.join(__dirname, cleanPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Wearhouse server running at http://127.0.0.1:${PORT}`);
});
