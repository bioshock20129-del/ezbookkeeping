// Exercise production bundles, not the Vite dev server. Requires a local Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
    try {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path.endsWith('/server_settings.js')) {
            res.writeHead(200, { 'Content-Type': 'application/javascript' });
            res.end('window.EZBOOKKEEPING_SERVER_SETTINGS = {};');
            return;
        }
        const file = resolve(root, '.' + path);
        if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
        res.end(data);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const entry of ['desktop.html', 'mobile.html']) {
        const page = await browser.newPage({ viewport: entry === 'mobile.html' ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.stack || error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/${entry}`, { waitUntil: 'networkidle' });
        if (errors.length) throw new Error(`${entry}: ${errors.join('\n')}`);
        await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 15000 });
        if (errors.length) throw new Error(`${entry}: ${errors.join('\n')}`);
        console.log(`${entry}: login screen visible, no uncaught JavaScript errors`);
        await page.close();
    }
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
