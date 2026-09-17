import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

// Run from the repository root with Node 22+; set CHROME_PATH for your Chromium browser.
const root = process.cwd();
const missing = [];
const output = await mkdtemp('/tmp/portfolio-desktop-review-');
console.log('Browser artifacts:', output);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
    try {
        const contents = await readFile(file);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(contents);
    }
    catch { missing.push(pathname); response.writeHead(404).end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
    console.log(`Portfolio preview: ${base}`);
    await new Promise(() => {});
}

function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates = [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ];
    for (const bin of candidates) {
        if (existsSync(bin)) return bin;
    }
    return 'google-chrome';
}

let browser;
let socket;
try {
    browser = spawn(findChrome(), [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync',
        '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${output}/profile`, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
        let stderr = '';
        const timer = setTimeout(() => reject(new Error(`Browser startup timed out: ${stderr.slice(-1000)}`)), 20000);
        browser.stderr.on('data', chunk => {
            stderr += chunk;
            const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        browser.once('error', reject);
        browser.once('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited ${code}: ${stderr.slice(-1000)}`)); });
    });
    let pageTarget;
    const deadline = Date.now() + 10000;
    while (!pageTarget && Date.now() < deadline) {
        const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
        pageTarget = targets.find(target => target.type === 'page');
        if (!pageTarget) await delay(100);
    }
    assert(pageTarget, 'Browser did not create a page target');
    socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
    let sequence = 0;
    const pending = new Map();
    const errors = [];
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const handlers = pending.get(message.id); pending.delete(message.id);
            if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
            else handlers.resolve(message.result);
        }
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 15000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
    };
    const navigate = async path => {
        await cdp('Page.navigate', { url: `${base}${path}` });
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            if (await evaluate(`location.pathname + location.hash === ${JSON.stringify(path)} && document.readyState === 'complete'`)) {
                await evaluate('document.fonts.ready.then(() => true)');
                await delay(100); return;
            }
            await delay(100);
        }
        throw new Error(`Navigation timed out: ${path}`);
    };
    const screenshot = async name => {
        const shot = await cdp('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(output, name), Buffer.from(shot.data, 'base64'));
    };
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const rect = selector => evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const clickAt = async (x, y, { modifiers = 0, button = 'left', count = 1 } = {}) => {
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, modifiers, clickCount: count });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, modifiers, clickCount: count });
    };
    const click = async (selector, options) => {
        const r = await rect(selector);
        await clickAt(r.x + r.width / 2, r.y + r.height / 2, options);
    };
    const key = async (key, modifiers = 0) => {
        const codes = {Escape:27, Enter:13, Tab:9, ' ':32, ArrowLeft:37, ArrowUp:38, ArrowRight:39, ArrowDown:40};
        const windowsVirtualKeyCode = codes[key] || key.toUpperCase().charCodeAt(0);
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers, windowsVirtualKeyCode });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers, windowsVirtualKeyCode });
    };
    const drag = async (x, y, dx, dy, { release = true } = {}) => {
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        for (let step = 1; step <= 6; step++) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * step / 6, y: y + dy * step / 6, buttons: 1 });
        await delay(30);
        if (release) await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
    };
    const selectionCount = () => evaluate('document.querySelectorAll(".desktop-icon[aria-selected=true]").length');
    const dialogOpen = () => evaluate('!!document.querySelector(".redirect-dialog[open]")');
    const first = '.desktop-icon:nth-child(1)';
    const second = '.desktop-icon:nth-child(2)';

    for (const [width, height] of [[1920,1080], [1440,900], [1366,768], [1050,900], [768,1024], [390,844], [320,568], [844,390]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 760 });
        await navigate('/');
        const metrics = await evaluate(`(() => {
            const h=document.querySelector('.intro-heading h1').getBoundingClientRect();
            const role=document.querySelector('.terminal-role').getBoundingClientRect();
            const input=document.querySelector('#terminal-input').getBoundingClientRect();
            const screen=document.querySelector('.terminal-screen').getBoundingClientRect();
            const transcript=document.querySelector('#terminal-screen');
            return {gap:role.top-h.bottom, prompt:input.top>=screen.top && input.bottom<=screen.bottom, overflow:transcript.scrollWidth-transcript.clientWidth, pageOverflow:document.documentElement.scrollWidth-innerWidth, icons:[...document.querySelectorAll('.desktop-icon')].every(icon=>{const r=icon.getBoundingClientRect();return icon.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})};
        })()`);
        assert(metrics.gap >= 0 && metrics.gap <= 16, `Name and role stay adjacent at ${width}: ${metrics.gap}`);
        assert(metrics.prompt && metrics.icons && metrics.overflow <= 1 && metrics.pageOverflow <= 0, `Layout at ${width}: ${JSON.stringify(metrics)}`);
        await screenshot(`desktop-${width}.png`);
        console.log(`Layout ${width} × ${height}: passed`);
    }

    await cdp('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
    await navigate('/');
    await click('#show-desktop');
    const origin = await rect(first);
    const otherOrigin = await rect(second);
    await click(first);
    assert.equal(await selectionCount(), 1, 'Single click selects');
    assert(await evaluate('document.querySelector("#about").hidden'), 'Selection does not open an app');
    await click(second, {modifiers:2});
    assert.equal(await selectionCount(), 2, 'Ctrl-click adds selection');
    await drag(origin.x + origin.width/2, origin.y + origin.height/2, 270, 90);
    const moved = await rect(first);
    const otherMoved = await rect(second);
    assert.equal(Math.round(moved.x - origin.x), 270, 'Icon moved horizontally');
    assert.equal(Math.round(moved.y - origin.y), 90, 'Icon moved vertically');
    assert.equal(Math.round(otherMoved.x - otherOrigin.x), 270, 'Group preserves horizontal spacing');
    assert.equal(Math.round(otherMoved.y - otherOrigin.y), 90, 'Group preserves vertical spacing');
    assert.equal(await selectionCount(), 2, 'Drag retains group selection');
    assert(await evaluate('document.querySelector("#about").hidden'), 'Drag does not open app');
    await screenshot('group-moved.png');
    await evaluate('document.querySelector("#reset-desktop").click();document.querySelector("#show-desktop").click()');
    assert.equal(Math.round((await rect(first)).x), Math.round(origin.x), 'Reset restores icon positions');
    assert.equal(await selectionCount(), 0, 'Reset clears selection');
    await drag(8, origin.y - 8, origin.x + origin.width, otherOrigin.y + otherOrigin.height - origin.y + 12, {release:false});
    assert(await evaluate('!document.querySelector(".desktop-marquee").hidden'), 'Blue selection rectangle appears');
    assert.equal(await selectionCount(), 2, 'Rectangle selects intersecting icons');
    await screenshot('selection-rectangle.png');
    await cdp('Input.dispatchMouseEvent', {type:'mouseReleased', x:origin.x+origin.width+8, y:otherOrigin.y+otherOrigin.height+4, button:'left', clickCount:1});
    assert(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Rectangle disappears on release');
    await clickAt(500,780);
    assert.equal(await selectionCount(), 0, 'Empty desktop clears selection');
    await click(first);
    await click('.desktop-icon:nth-child(3)', {modifiers:8});
    assert.equal(await selectionCount(), 3, 'Shift-click selects a range');
    await key('a',2);
    assert.equal(await selectionCount(), 8, 'Ctrl+A selects desktop icons');
    await key('Escape');
    assert.equal(await selectionCount(), 0, 'Escape clears selection');
    await evaluate('document.querySelector(".desktop-icon").focus()');
    await key(' ');
    assert.equal(await selectionCount(), 1, 'Space selects focused icon');
    await key('ArrowRight',1);
    assert.equal(Math.round((await rect(first)).x - origin.x), 10, 'Alt+arrow moves selection');
    await key('ArrowRight',9);
    assert.equal(Math.round((await rect(first)).x - origin.x), 50, 'Alt+Shift+arrow moves farther');
    const beforeCancel=await rect(first);
    await drag(beforeCancel.x+20,beforeCancel.y+20,150,80,{release:false});
    await key('Escape');
    await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:beforeCancel.x+170,y:beforeCancel.y+100,button:'left',clickCount:1});
    assert.equal((await rect(first)).x,beforeCancel.x,'Escape cancels a drag');
    await delay(450);
    await click(first);
    await click(first,{count:2});
    assert(await evaluate('!document.querySelector("#about").hidden'), 'Double-click opens app');
    console.log('Mouse selection, rectangle, group dragging, reset, keyboard and cancellation: passed');

    await evaluate('document.querySelector("#reset-desktop").click()');
    await click('#terminal .control-close');
    assert(await evaluate('!document.querySelector(".taskbar-task[aria-controls=terminal]").hidden'), 'Closed terminal remains pinned');
    await click('.taskbar-task[aria-controls=terminal]');
    assert(await evaluate('!document.querySelector("#terminal").hidden'), 'Pinned button reopens terminal');
    await click('#terminal .control-maximize');
    assert(await evaluate('document.querySelector(".terminal-role").getBoundingClientRect().top-document.querySelector(".intro-heading h1").getBoundingClientRect().bottom<=16'), 'Maximized terminal keeps identity together');
    await click('#terminal .control-maximize');
    for (const width of [460,620,621,900]) {
        await evaluate(`Object.assign(document.querySelector('#terminal').style,{width:'${width}px',height:'520px'});document.querySelector('#terminal').classList.add('is-resized')`);
        assert(await evaluate('document.querySelector(".terminal-role").getBoundingClientRect().top-document.querySelector(".intro-heading h1").getBoundingClientRect().bottom<=16'), `Resized terminal identity at ${width}`);
    }
    console.log('Pinned terminal and terminal resize layouts: passed');

    await navigate('/');
    await evaluate('window.__opened=[];window.open=(...args)=>{window.__opened.push(args);return null}');
    await click('#show-desktop');
    await click('.desktop-icon:nth-child(6)');
    assert(!await dialogOpen(), 'Selecting external icon does not prompt');
    await key('Enter');
    assert(await dialogOpen(), 'Activating external icon prompts');
    assert.equal(await evaluate('window.__opened.length'),0,'No redirect before confirmation');
    assert(await evaluate('document.activeElement.classList.contains("redirect-cancel")'),'Cancel receives initial focus');
    for (let step=0; step<5; step++) {
        await key('Tab');
        assert(await evaluate('document.querySelector(".redirect-dialog").contains(document.activeElement)'),'Modal keeps keyboard focus inside');
    }
    await screenshot('redirect-warning.png');
    await key('Escape');
    await delay(30);
    assert(!await dialogOpen(), 'Escape cancels redirect');
    assert.equal(await evaluate('document.activeElement.textContent.trim()'),'LinkedIn','Cancel returns focus');
    await key('Enter');
    await click('.redirect-continue');
    await delay(30);
    assert.equal(await evaluate('window.__opened[0][0]'),'https://www.linkedin.com/in/bryant-villarreal/','Continue opens selected destination');
    assert.equal(await evaluate('window.__opened[0][2]'),'noopener,noreferrer','New tab isolated');
    await click('.desktop-icon:nth-child(7)', {button:'middle'});
    assert(await dialogOpen(),'Middle-click also prompts');
    await click('.redirect-cancel');
    await delay(30);
    await evaluate('document.querySelector("[data-open=about]").click()');
    await click('.profile-contact a[href^="https://github"]',{modifiers:4});
    assert(await dialogOpen(),'Command-click inside an app prompts');
    await click('.redirect-cancel');
    await delay(30);
    await evaluate('document.querySelector("[data-open=resume]").click()');
    await click('.word-actions a');
    assert(await dialogOpen(),'PDF link prompts');
    await click('.redirect-cancel');
    await delay(30);
    await click('.word-menu a:nth-child(2)');
    assert(!await dialogOpen(),'Resume section navigation stays in the desktop');
    await delay(200);
    await click('.word-menu a:nth-child(3)',{modifiers:4});
    assert(await dialogOpen(),'Opening a resume section in a new tab prompts');
    await click('.redirect-cancel');
    await delay(30);
    await evaluate('document.querySelector("#resume-document").contentDocument.querySelector("a[href^=https]").click()');
    assert(await dialogOpen(),'Embedded resume uses full desktop modal');
    await click('.redirect-cancel');
    await delay(30);
    await evaluate('document.querySelector("[data-open=contact]").click()');
    await evaluate('document.querySelector(".aim-email a").click()');
    assert(await dialogOpen(),'Email link prompts');
    assert(await evaluate('document.querySelector("#redirect-message").textContent.includes("email app")'),'Email action explained');
    await click('.redirect-cancel');
    await delay(30);
    await navigate('/assets/resume.html');
    await evaluate('document.querySelector("a[href^=https]").click()');
    assert(await dialogOpen(),'Standalone resume also prompts');
    await click('.redirect-cancel');
    console.log('External links, modified clicks, PDFs, email, embedded and standalone resume prompts: passed');

    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await navigate('/');
    const tap=async(selector)=>{
        const r=await rect(selector);
        await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2}]});
        await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await delay(50);
    };
    await tap(first);
    assert.equal(await selectionCount(),1,'Touch tap selects');
    assert(await evaluate('document.querySelector("#about").hidden'),'First touch selects without opening');
    await tap(first);
    assert(await evaluate('!document.querySelector("#about").hidden'),'Second touch opens');
    await evaluate('document.querySelector(".profile-contact a[href^=https]").click()');
    assert(await dialogOpen(),'Touch layout shows redirect prompt');
    assert(await evaluate('(()=>{const r=document.querySelector(".redirect-dialog").getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()'),'Redirect prompt fits phone');
    await screenshot('mobile-redirect.png');
    await tap('.redirect-cancel');
    await evaluate('document.querySelector("#reset-desktop").click()');
    const touchOrigin=await rect(first);
    const point={x:touchOrigin.x+touchOrigin.width/2,y:touchOrigin.y+touchOrigin.height/2};
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+30,y:point.y+20}]});
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await delay(50);
    assert.equal(Math.round((await rect(first)).x-touchOrigin.x),30,'Touch drags icon');
    assert(await evaluate('document.querySelector("#about").hidden'),'Touch drag does not open app');
    await evaluate('document.querySelector("#reset-desktop").click();document.querySelector("#tray-desktop").click()');
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 10, y: 220 }]
    });
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 200, y: 70 }]
    });
    assert(await evaluate('!document.querySelector(".desktop-marquee").hidden'), 'Touch marquee rectangle appears on mobile');
    assert(await evaluate('document.querySelectorAll(".desktop-icon.is-selected").length >= 2'), 'Mobile marquee selects intersecting icons');
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Mobile marquee hides on touch release');
    await evaluate('document.querySelector("#reset-desktop").click();document.querySelector("#tray-desktop").click()');
    await screenshot('mobile-wallpaper.png');
    assert(await evaluate('getComputedStyle(document.querySelector(".desktop-wallpaper")).backgroundImage.includes("mobile.svg")'),'Portrait wallpaper loaded');
    await cdp('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:true});
    await delay(50);
    assert(await evaluate('[...document.querySelectorAll(".desktop-icon")].every(icon=>{const r=icon.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=document.querySelector("#desktop").clientHeight})'),'Icons remain in bounds after resize');
    console.log('Touch selection, activation, dragging, wallpaper and viewport changes: passed');

    await cdp('Emulation.setTouchEmulationEnabled',{enabled:false});
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await navigate('/');
    await delay(450);
    const gapBefore=await evaluate('document.querySelector(".terminal-role").getBoundingClientRect().top-document.querySelector(".intro-heading h1").getBoundingClientRect().bottom');
    await delay(300);
    assert.equal(await evaluate('document.querySelector(".terminal-role").getBoundingClientRect().top-document.querySelector(".intro-heading h1").getBoundingClientRect().bottom'),gapBefore,'ASCII animation cannot shift role spacing');
    await cdp('Emulation.setScriptExecutionDisabled',{value:true});
    await navigate('/');
    assert(await evaluate('!document.documentElement.classList.contains("os-ready")'),'Static fallback available');
    assert(await evaluate('document.querySelector(".desktop-icon").getAttribute("href")==="#about"'),'Ordinary links retained without JS');
    assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Static mobile layout fits');
    await cdp('Emulation.setScriptExecutionDisabled',{value:false});
    assert.deepEqual(errors,[],'No browser exceptions');
    assert.deepEqual(missing,[],'No missing local assets');
    console.log('All desktop browser checks passed. No external destinations opened or messages sent.');
} finally {
    socket?.close(); browser?.kill('SIGTERM'); server.close();
}
