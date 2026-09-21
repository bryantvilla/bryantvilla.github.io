import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const root = process.cwd();
console.log('--- Running Desktop Selection & Layout Unit Tests ---');

// ============================================================================
// PART 1: PURE UNIT TESTS - SELECTION MATH, GEOMETRY & BOUNDS
// ============================================================================
console.log('\n[Section 1] Testing Marquee Math & Geometry Functions...');

function normalizeRect(startX, startY, currentX, currentY) {
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const right = Math.max(startX, currentX);
    const bottom = Math.max(startY, currentY);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function isIntersecting(boxA, boxB) {
    return (
        boxA.left < boxB.right &&
        boxA.right > boxB.left &&
        boxA.top < boxB.bottom &&
        boxA.bottom > boxB.top
    );
}

function clampGroupDelta(items, dx, dy, desktopArea) {
    if (!items.length) return { dx: 0, dy: 0 };
    const minLeft = Math.min(...items.map(item => item.bounds.left));
    const maxRight = Math.max(...items.map(item => item.bounds.right));
    const minTop = Math.min(...items.map(item => item.bounds.top));
    const maxBottom = Math.max(...items.map(item => item.bounds.bottom));

    const clampedDx = Math.max(desktopArea.left - minLeft, Math.min(dx, desktopArea.right - maxRight));
    const clampedDy = Math.max(desktopArea.top - minTop, Math.min(dy, desktopArea.bottom - maxBottom));
    return { dx: clampedDx, dy: clampedDy };
}

// Test Quadrant 1: Dragging Down-Right
{
    const r = normalizeRect(100, 100, 250, 200);
    assert.equal(r.left, 100);
    assert.equal(r.top, 100);
    assert.equal(r.right, 250);
    assert.equal(r.bottom, 200);
    assert.equal(r.width, 150);
    assert.equal(r.height, 100);
}

// Test Quadrant 2: Dragging Down-Left
{
    const r = normalizeRect(250, 100, 100, 200);
    assert.equal(r.left, 100);
    assert.equal(r.top, 100);
    assert.equal(r.right, 250);
    assert.equal(r.bottom, 200);
    assert.equal(r.width, 150);
    assert.equal(r.height, 100);
}

// Test Quadrant 3: Dragging Up-Left
{
    const r = normalizeRect(250, 200, 100, 100);
    assert.equal(r.left, 100);
    assert.equal(r.top, 100);
    assert.equal(r.right, 250);
    assert.equal(r.bottom, 200);
    assert.equal(r.width, 150);
    assert.equal(r.height, 100);
}

// Test Quadrant 4: Dragging Up-Right
{
    const r = normalizeRect(100, 200, 250, 100);
    assert.equal(r.left, 100);
    assert.equal(r.top, 100);
    assert.equal(r.right, 250);
    assert.equal(r.bottom, 200);
    assert.equal(r.width, 150);
    assert.equal(r.height, 100);
}
console.log('✅ [PASS] 4-Quadrant Marquee normalization unit tests passed');

// Test Intersection Detection Edge Cases
{
    const icon = { left: 100, top: 100, right: 180, bottom: 180 };

    // Completely inside
    assert.ok(isIntersecting({ left: 50, top: 50, right: 250, bottom: 250 }, icon), 'Enclosing marquee intersects');

    // Partial overlap top-left
    assert.ok(isIntersecting({ left: 50, top: 50, right: 120, bottom: 120 }, icon), 'Top-left overlap intersects');

    // Partial overlap bottom-right
    assert.ok(isIntersecting({ left: 150, top: 150, right: 250, bottom: 250 }, icon), 'Bottom-right overlap intersects');

    // Edge touches without area overlap (should not intersect)
    assert.ok(!isIntersecting({ left: 0, top: 0, right: 100, bottom: 100 }, icon), 'Corner touch without overlap does not intersect');
    assert.ok(!isIntersecting({ left: 0, top: 100, right: 100, bottom: 180 }, icon), 'Left edge touch without overlap does not intersect');
    assert.ok(!isIntersecting({ left: 180, top: 100, right: 250, bottom: 180 }, icon), 'Right edge touch without overlap does not intersect');

    // Completely separated
    assert.ok(!isIntersecting({ left: 0, top: 0, right: 50, bottom: 50 }, icon), 'Separate marquee does not intersect');
}
console.log('✅ [PASS] Intersection geometry edge cases unit tests passed');

// Test Boundary Clamping
{
    const desktop = { left: 0, top: 0, right: 800, bottom: 600 };
    const items = [
        { bounds: { left: 100, top: 100, right: 180, bottom: 180 } },
        { bounds: { left: 200, top: 100, right: 280, bottom: 180 } }
    ];

    // Inside bounds: move by +50, +50
    const normal = clampGroupDelta(items, 50, 50, desktop);
    assert.equal(normal.dx, 50);
    assert.equal(normal.dy, 50);

    // Overflows right edge: attempt to move +1000px
    const rightOverflow = clampGroupDelta(items, 1000, 0, desktop);
    assert.equal(rightOverflow.dx, 800 - 280); // maxRight must not exceed desktop.right (800)

    // Overflows left edge: attempt to move -500px
    const leftOverflow = clampGroupDelta(items, -500, 0, desktop);
    assert.equal(leftOverflow.dx, 0 - 100); // minLeft must not exceed desktop.left (0)

    // Overflows bottom edge: attempt to move +800px
    const bottomOverflow = clampGroupDelta(items, 0, 800, desktop);
    assert.equal(bottomOverflow.dy, 600 - 180);

    // Overflows top edge: attempt to move -500px
    const topOverflow = clampGroupDelta(items, 0, -500, desktop);
    assert.equal(topOverflow.dy, 0 - 100);
}
console.log('✅ [PASS] Boundary clamping unit tests passed');

// ============================================================================
// PART 2: BROWSER LAYOUT, FORMAT & EDGE CASE TESTS (CDP)
// ============================================================================
console.log('\n[Section 2] Initializing Headless Browser for Layouts & Scenarios...');

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

const chromeBin = findChrome();
console.log(`Using Chromium binary: ${chromeBin}`);

const output = await mkdtemp('/tmp/portfolio-selection-test-');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.ttf': 'font/ttf' };

const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
    try {
        const contents = await readFile(file);
        response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(contents);
    } catch { response.writeHead(404).end(); }
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
    assert(pageTarget, 'Browser created page target');

    socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => { socket.addEventListener('open', res); socket.addEventListener('error', rej); });

    let seq = 0;
    const pending = new Map();
    const runtimeErrors = [];

    socket.addEventListener('message', event => {
        const msg = JSON.parse(event.data);
        if (msg.id) {
            const h = pending.get(msg.id);
            pending.delete(msg.id);
            if (h) {
                if (msg.error) h.reject(new Error(JSON.stringify(msg.error)));
                else h.resolve(msg.result);
            }
        }
        if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
    });

    const cdp = (method, params = {}) => new Promise((res, rej) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); rej(new Error(`Command timed out: ${method}`)); }, 15000);
        pending.set(id, { resolve: v => { clearTimeout(timer); res(v); }, reject: e => { clearTimeout(timer); rej(e); } });
        socket.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async expr => {
        const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
        return res.result.value;
    };

    const navigate = async path => {
        await cdp('Page.navigate', { url: `${base}${path}` });
        const d = Date.now() + 15000;
        while (Date.now() < d) {
            if (await evaluate(`location.pathname + location.hash === ${JSON.stringify(path)} && document.readyState === 'complete'`)) {
                await evaluate('document.fonts.ready.then(() => true)');
                await delay(80);
                return;
            }
            await delay(80);
        }
        throw new Error(`Navigation timed out: ${path}`);
    };

    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

    // ------------------------------------------------------------------------
    // Format & Layout verification across 8 standard viewports
    // ------------------------------------------------------------------------
    console.log('\n[Section 3] Verifying Desktop Layouts and Formats Across Viewports...');
    const viewports = [
        { width: 1920, height: 1080, mobile: false, name: '1920x1080 (FHD Desktop)' },
        { width: 1512, height: 982, mobile: false, name: '1512x982 (14-inch MacBook Pro Fullscreen)' },
        { width: 1512, height: 882, mobile: false, name: '1512x882 (14-inch MacBook Pro Desktop Safari)' },
        { width: 1440, height: 900, mobile: false, name: '1440x900 (Desktop)' },
        { width: 1440, height: 824, mobile: false, name: '1440x824 (13-inch MacBook Pro Safari)' },
        { width: 1366, height: 768, mobile: false, name: '1366x768 (Laptop)' },
        { width: 1050, height: 900, mobile: false, name: '1050x900 (Compact Desktop)' },
        { width: 768, height: 1024, mobile: false, name: '768x1024 (Tablet Portrait)' },
        { width: 390, height: 844, mobile: true, name: '390x844 (Mobile Phone Portrait)' },
        { width: 320, height: 568, mobile: true, name: '320x568 (Small Mobile Portrait)' },
        { width: 844, height: 390, mobile: true, name: '844x390 (Mobile Phone Landscape)' }
    ];

    for (const vp of viewports) {
        await cdp('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
        await cdp('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile });
        await navigate('/');
        await delay(120);

        const check = await evaluate(`(() => {
            const d = document.querySelector('#desktop');
            const tb = document.querySelector('.taskbar');
            const icons = [...document.querySelectorAll('.desktop-icon')];
            const marquee = document.querySelector('.desktop-marquee');
            const dRect = d.getBoundingClientRect();
            const tbRect = tb.getBoundingClientRect();
            const launcher = document.querySelector('.assistant-launcher');
            let launcherOverlap = false;
            let launcherClearance = Infinity;
            let iconHitTestPassed = true;
            if (launcher && getComputedStyle(launcher).display !== 'none') {
                const aRect = launcher.getBoundingClientRect();
                launcherOverlap = icons.some(icon => {
                    const r = icon.getBoundingClientRect();
                    return !(r.right <= aRect.left || r.left >= aRect.right || r.bottom <= aRect.top || r.top >= aRect.bottom);
                });
                const lastIcon = icons[icons.length - 1];
                if (lastIcon) {
                    const lRect = lastIcon.getBoundingClientRect();
                    launcherClearance = aRect.top - lRect.bottom;
                }
                const lastIconRect = icons[icons.length - 1].getBoundingClientRect();
                const bottomTarget = document.elementFromPoint(lastIconRect.left + lastIconRect.width / 2, lastIconRect.bottom - 4);
                iconHitTestPassed = !launcher.contains(bottomTarget);
            }

            return {
                desktopExists: !!d,
                taskbarExists: !!tb,
                marqueeExists: !!marquee,
                marqueeInitiallyHidden: marquee ? marquee.hidden : false,
                marqueeAriaHidden: marquee ? marquee.getAttribute('aria-hidden') === 'true' : false,
                noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
                iconsInBounds: icons.every(icon => {
                    const r = icon.getBoundingClientRect();
                    return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= dRect.bottom;
                }),
                taskbarPinnedBottom: tbRect.bottom === window.innerHeight,
                launcherOverlap,
                launcherClearance,
                iconHitTestPassed,
                iconCount: icons.length
            };
        })()`);

        assert.ok(check.desktopExists, `Desktop container exists in ${vp.name}`);
        assert.ok(check.taskbarExists, `Taskbar exists in ${vp.name}`);
        assert.ok(check.marqueeExists, `Marquee element exists in ${vp.name}`);
        assert.ok(check.marqueeInitiallyHidden, `Marquee initially hidden in ${vp.name}`);
        assert.ok(check.marqueeAriaHidden, `Marquee aria-hidden=true in ${vp.name}`);
        assert.ok(check.noHorizontalOverflow, `No horizontal overflow in ${vp.name}`);
        assert.ok(check.iconsInBounds, `All desktop icons stay within viewport bounds in ${vp.name}`);
        assert.ok(!check.launcherOverlap, `No desktop icons overlap with Clip launcher in ${vp.name}`);
        if (!vp.mobile) {
            assert.ok(check.launcherClearance >= 10, `Clip launcher maintains at least 10px clearance below shortcuts in ${vp.name} (actual: ${check.launcherClearance.toFixed(1)}px)`);
            assert.ok(check.iconHitTestPassed, `Desktop icon bottom hit test not obscured by Clip launcher in ${vp.name}`);
        }
        assert.ok(check.taskbarPinnedBottom, `Taskbar stays pinned at bottom in ${vp.name}`);
        assert.equal(check.iconCount, 8, `Expected 8 desktop icons in ${vp.name}`);

        console.log(`✅ [PASS] Layout format verified: ${vp.name}`);
    }

    // ------------------------------------------------------------------------
    // Edge Cases: Selection Scenarios (Desktop & Mobile)
    // ------------------------------------------------------------------------
    console.log('\n[Section 4] Testing Desktop & Mobile Selection Scenarios...');

    const getRect = selector => evaluate(`(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    })()`);

    // Scenario A: Desktop Mouse Drag Marquee (All Quadrants)
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    await navigate('/');
    await delay(100);
    await evaluate('document.querySelector("#show-desktop").click()');

    const iconRect1 = await getRect('.desktop-icon:nth-child(1)');
    const iconRect2 = await getRect('.desktop-icon:nth-child(2)');

    // Quadrant 1 drag (down-right) enclosing icon 1 and 2
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 8, y: Math.round(iconRect1.top - 10), button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(iconRect2.right + 10), y: Math.round(iconRect2.bottom - 2), button: 'left' });
    assert.ok(await evaluate('!document.querySelector(".desktop-marquee").hidden'), 'Desktop mouse marquee appears');
    assert.equal(await evaluate('document.querySelectorAll(".desktop-icon.is-selected").length'), 2, 'Marquee selected intersecting icons');

    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(iconRect2.right + 10), y: Math.round(iconRect2.bottom - 2), button: 'left', clickCount: 1 });
    assert.ok(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Desktop marquee disappears on release');
    assert.equal(await evaluate('document.querySelectorAll(".desktop-icon.is-selected").length'), 2, 'Selection retained on release');

    // Empty tap clears selection
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 500, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 500, y: 500, button: 'left', clickCount: 1 });
    assert.equal(await evaluate('document.querySelectorAll(".desktop-icon.is-selected").length'), 0, 'Empty desktop click clears selection');
    console.log('✅ [PASS] Desktop mouse marquee selection & clearing passed');

    // Scenario B: Native window touch scrolling vs empty desktop marquee
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await navigate('/');
    await delay(150);

    // Open terminal window
    await evaluate('document.querySelector("[data-open=terminal]").click()');
    await delay(150);
    assert.ok(await evaluate('!document.querySelector("#terminal").hidden'), 'Terminal window opened');

    // Touching inside terminal window should NOT activate marquee
    const termRect = await getRect('#terminal .terminal-screen');
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: Math.round(termRect.left + 50), y: Math.round(termRect.top + 50) }]
    });
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(termRect.left + 50), y: Math.round(termRect.top + 120) }]
    });
    assert.ok(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Touching inside open window does NOT activate desktop marquee');
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // Touching taskbar should NOT activate marquee
    const tbRect = await getRect('.taskbar');
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: Math.round(tbRect.left + 200), y: Math.round(tbRect.top + 15) }]
    });
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: Math.round(tbRect.left + 250), y: Math.round(tbRect.top + 15) }]
    });
    assert.ok(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Touching taskbar does NOT activate desktop marquee');
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    console.log('✅ [PASS] Window content and taskbar touch isolation passed');

    // Scenario C: Touch on empty mobile wallpaper
    await evaluate('document.querySelector("#reset-desktop").click()');
    await evaluate('document.querySelector("#show-desktop").click()');
    await delay(100);

    const mIcon1 = await getRect('.desktop-icon:nth-child(1)');
    const mIcon2 = await getRect('.desktop-icon:nth-child(2)');

    // Drag touch across empty wallpaper upwards into icons (Quadrant 3)
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 10, y: 220 }]
    });
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 160, y: 70 }]
    });

    const isMarqueeActive = await evaluate('!document.querySelector(".desktop-marquee").hidden');
    assert.ok(isMarqueeActive, 'Mobile touch drag across empty wallpaper activates marquee selection');
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Mobile marquee disappears on release');
    assert.ok((await evaluate('document.querySelectorAll(".desktop-icon.is-selected").length')) > 0, 'Mobile marquee selected intersecting icons');

    // Drag touch across lower empty wallpaper area
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 50, y: 300 }]
    });
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 200, y: 450 }]
    });
    assert.ok(await evaluate('!document.querySelector(".desktop-marquee").hidden'), 'Lower empty wallpaper drag shows marquee');
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await evaluate('document.querySelector(".desktop-marquee").hidden'), 'Marquee hidden on release');

    // Tap on empty desktop clears selection on mobile
    await cdp('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 300, y: 700 }]
    });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(50);
    assert.equal(await evaluate('document.querySelectorAll(".desktop-icon.is-selected").length'), 0, 'Tap on empty desktop clears selection on mobile');
    console.log('✅ [PASS] Mobile touch marquee selection and clearing passed');

    assert.deepEqual(runtimeErrors, [], 'No browser runtime exceptions during unit test suite');
    console.log('\n--- All Unit Tests & Scenarios Completed Successfully ---');

} finally {
    socket?.close();
    browser?.kill('SIGTERM');
    server.close();
}
