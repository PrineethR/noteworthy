const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Load environment variables from .env
let port = 3000;
let vaultPathSetting = '';

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
            } else if (k === 'OBSIDIAN_VAULT_PATH') {
                vaultPathSetting = v;
            }
        }
    }
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

    // 1. Handle API sync endpoint
    if (req.method === 'POST' && req.url === '/api/sync') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            let profile = 'prineeth';
            try {
                if (body) {
                    const parsed = JSON.parse(body);
                    if (parsed.profile) profile = parsed.profile;
                }
            } catch (e) {}

            console.log(`[Server] Manual sync requested for profile: ${profile}`);
            
            // Resolve vault path (fallback to workspace vault subfolder)
            const vaultPath = vaultPathSetting || path.join(__dirname, 'Noteworthy-Obsidian-Vault');
            const cmd = `node sync.js --vault "${vaultPath}" --profile "${profile}"`;
            
            console.log(`[Server] Running: ${cmd}`);
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[Server] Sync error: ${error.message}`);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: error.message, stderr }));
                    return;
                }
                console.log(`[Server] Sync completed successfully.`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, stdout }));
            });
        });
        return;
    }

    // 2. Serve static files
    let rawUrl = req.url.split('?')[0].split('#')[0];
    let filePath = rawUrl === '/' || rawUrl === '/noteworthy' || rawUrl === '/noteworthy/'
        ? './index.html'
        : '.' + rawUrl.replace(/^\/noteworthy/, '');

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
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(port, () => {
    console.log(`[Server] Noteworthy local server running at http://localhost:${port}`);
});
