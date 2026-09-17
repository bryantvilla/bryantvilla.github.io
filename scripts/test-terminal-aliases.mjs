import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const root = process.cwd();
console.log('--- Testing Terminal File Alias Commands & Auto-completion ---');

function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates = [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
    for (const bin of candidates) {
        if (existsSync(bin)) return bin;
    }
    return 'google-chrome';
}

const chromeBin = findChrome();
const output = await mkdtemp('/tmp/portfolio-term-test-');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
    try {
        const contents = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(contents);
    } catch { res.writeHead(404).end(); }
});

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let browser;
let socket;

try {
    browser = spawn(chromeBin, [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync',
        '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${output}/profile`, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const endpoint = await new Promise((res, rej) => {
        let stderr = '';
        const timer = setTimeout(() => rej(new Error(`Browser startup timed out: ${stderr.slice(-1000)}`)), 20000);
        browser.stderr.on('data', chunk => {
            stderr += chunk;
            const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timer); res(match[1]); }
        });
        browser.once('error', rej);
        browser.once('exit', code => rej(new Error(`Browser exited ${code}: ${stderr.slice(-1000)}`)));
    });

    let pageTarget;
    const deadline = Date.now() + 10000;
    while (!pageTarget && Date.now() < deadline) {
        const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
        pageTarget = targets.find(t => t.type === 'page');
        if (!pageTarget) await delay(100);
    }
    assert(pageTarget, 'Browser page target created');

    socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res); socket.addEventListener('error', rej); });

    let seq = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { res, rej } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) rej(new Error(msg.error.message));
            else res(msg.result);
        }
    });

    const send = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        socket.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    await send('Page.navigate', { url: `${base}/index.html` });
    await delay(1200);

    async function evalCode(expression) {
        const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (res.exceptionDetails) {
            throw new Error(res.exceptionDetails.exception?.description || 'Eval error');
        }
        return res.result.value;
    }

    console.log('1. Testing "cat readme.txt"...');
    const catReadme = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        const form = document.getElementById('terminal-form');
        input.value = 'cat readme.txt';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const lastEntry = document.querySelector('#terminal-screen .terminal-entry:last-child');
        return lastEntry ? lastEntry.textContent : '';
    })()`);
    assert(catReadme.includes('Bryant Villarreal'), 'cat readme.txt should print bio');
    assert(catReadme.includes('readme.txt'), 'cat readme.txt should print header');
    console.log('✅ cat readme.txt passed');

    console.log('2. Testing "cat resume.doc"...');
    const catResume = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        const form = document.getElementById('terminal-form');
        input.value = 'cat resume.doc';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const lastEntry = document.querySelector('#terminal-screen .terminal-entry:last-child');
        const resumeWindow = document.getElementById('resume');
        return {
            text: lastEntry ? lastEntry.textContent : '',
            resumeOpen: !resumeWindow.hidden && !resumeWindow.hasAttribute('inert')
        };
    })()`);
    assert(catResume.text.includes('Software Engineer II @ UKG'), 'cat resume.doc should print summary');
    assert(catResume.resumeOpen, 'cat resume.doc should open resume window');
    console.log('✅ cat resume.doc passed');

    console.log('3. Testing "cat about/" directory error...');
    const catDir = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        const form = document.getElementById('terminal-form');
        input.value = 'cat about/';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const lastEntry = document.querySelector('#terminal-screen .terminal-entry:last-child');
        return lastEntry ? lastEntry.textContent : '';
    })()`);
    assert(catDir.includes('Is a directory'), 'cat about/ should report directory error');
    console.log('✅ cat about/ directory handling passed');

    console.log('4. Testing "cd work/"...');
    const cdWork = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        const form = document.getElementById('terminal-form');
        input.value = 'cd work/';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const workWindow = document.getElementById('work');
        return !workWindow.hidden && !workWindow.hasAttribute('inert');
    })()`);
    assert(cdWork, 'cd work/ should open work window');
    console.log('✅ cd work/ passed');

    console.log('5. Testing "cd readme.txt" file error...');
    const cdFile = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        const form = document.getElementById('terminal-form');
        input.value = 'cd readme.txt';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const lastEntry = document.querySelector('#terminal-screen .terminal-entry:last-child');
        return lastEntry ? lastEntry.textContent : '';
    })()`);
    assert(cdFile.includes('Not a directory'), 'cd readme.txt should warn not a directory');
    console.log('✅ cd readme.txt file handling passed');

    console.log('6. Testing direct file execution "readme.txt"...');
    const directFile = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        const form = document.getElementById('terminal-form');
        input.value = 'readme.txt';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const readmeWindow = document.getElementById('readme');
        return !readmeWindow.hidden && !readmeWindow.hasAttribute('inert');
    })()`);
    assert(directFile, 'readme.txt should open readme window');
    console.log('✅ readme.txt passed');

    console.log('7. Testing Tab auto-completion...');
    const tabCatRes = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        input.value = 'cat res';
        const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        input.dispatchEvent(ev);
        return input.value;
    })()`);
    assert.equal(tabCatRes, 'cat resume.doc', 'cat res should tab complete to cat resume.doc');

    const tabCdW = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        input.value = 'cd w';
        const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        input.dispatchEvent(ev);
        return input.value;
    })()`);
    assert.equal(tabCdW, 'cd work/', 'cd w should tab complete to cd work/');

    const tabType = await evalCode(`(() => {
        const input = document.getElementById('terminal-input');
        input.value = 'type read';
        const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        input.dispatchEvent(ev);
        return input.value;
    })()`);
    assert.equal(tabType, 'type readme.txt', 'type read should tab complete to type readme.txt');

    console.log('✅ Tab auto-completion passed');

    console.log('\n--- All Terminal Alias Tests Passed! ---');
} finally {
    if (socket) socket.close();
    if (browser) browser.kill('SIGKILL');
    server.close();
}
