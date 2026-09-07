const http = require('http');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env
let port = 3000;

if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
            const k = trimmed.substring(0, idx).trim();
            const v = trimmed.substring(idx + 1).trim().replace(/^['"]|['"]$/g, '');
            if (k === 'PORT') {
                port = parseInt(v, 10) || 3000;
            }
        }
    }
}

// An externally-assigned PORT (e.g. from a dev-server harness using autoPort)
// takes priority over whatever is in .env, so this always binds where it's told to.
if (process.env.PORT) {
    port = parseInt(process.env.PORT, 10) || port;
}

// MIME types helper
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    // Enable CORS for ease of local testing
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Serve static files
    let rawUrl = req.url.split('?')[0].split('#')[0];
    let isRoot = rawUrl === '/' || rawUrl === '/noteworthy' || rawUrl === '/noteworthy/' || rawUrl === '/noteworthy/exp' || rawUrl === '/noteworthy/exp/';
    let filePath = isRoot
        ? './index.html'
        : '.' + rawUrl.replace(/^\/noteworthy(\/exp)?/, '');

    // Resolve path safety
    filePath = path.resolve(filePath);
    const rootPath = path.resolve('.');
    if (!filePath.startsWith(rootPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Check file existence
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Fallback to index.html for client side routing
            filePath = path.join(rootPath, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        let contentType = MIME_TYPES[ext] || 'application/octet-stream';
        // Without an explicit charset, em dashes and other non-ASCII render as mojibake.
        if (/^(text\/|application\/(json|javascript))/.test(contentType)) {
            contentType += '; charset=utf-8';
        }

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(port, () => {
    console.log(`[Server] Noteworthy local server running at http://localhost:${port}`);
});
