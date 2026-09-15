/* The desktop enhances static HTML. Commands never execute code or shell input. */
(() => {
    'use strict';

    const desktop = document.getElementById('desktop');
    const terminalInput = document.getElementById('terminal-input');
    const terminalScreen = document.getElementById('terminal-screen');
    const terminalOutput = document.getElementById('terminal-output');
    const terminalWelcome = document.getElementById('terminal-welcome');
    const taskbar = document.getElementById('taskbar-tasks');
    const startButton = document.getElementById('start-button');
    const startMenu = document.getElementById('start-menu');
    const announcement = document.getElementById('os-announcement');
    const windows = new Map();
    const motions = new Map();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionEase = 'cubic-bezier(.22, 1, .36, 1)';
    const commandHistory = [];
    let historyIndex = 0;
    let historyDraft = '';
    let zIndex = 10;
    let activeWindow = 'terminal';
    let desktopSnapshot = null;
    let activeDrag = null;
    let activeResize = null;
    let startOpen = false;

    function makeIcon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        svg.setAttribute('aria-hidden', 'true');
        use.setAttribute('href', '#icon-' + name);
        svg.append(use);
        return svg;
    }

    function announce(message) { announcement.textContent = message; }

    function canAnimate() {
        return !reducedMotion.matches && !document.hidden && typeof desktop.animate === 'function';
    }

    function finishMotion(element) { motions.get(element)?.finish(); }

    // Canceling also runs cleanup, so interrupted exits cannot hide a reopened app.
    function animateElement(element, keyframes, { duration = 320, delay = 0, complete = () => {} } = {}) {
        finishMotion(element);
        if (!canAnimate()) { complete(); return; }
        const animation = element.animate(keyframes, { duration, delay, easing: motionEase, fill: 'both' });
        const finish = () => {
            if (motions.get(element)?.animation !== animation) return;
            motions.delete(element);
            animation.cancel();
            complete();
        };
        motions.set(element, { animation, finish });
        animation.finished.then(finish, finish);
    }

    function finishAllMotion() { [...motions.keys()].forEach(finishMotion); }
    reducedMotion.addEventListener('change', () => {
        if (reducedMotion.matches) finishAllMotion();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) finishAllMotion();
    });
    window.addEventListener('beforeprint', finishAllMotion);

    function captureWindow(state) {
        return { bounds: state.element.getBoundingClientRect(), opacity: getComputedStyle(state.element).opacity };
    }

    // FLIP: apply the final layout once, then animate only its transform and opacity.
    function windowKeyframe(bounds, destination, opacity = 1) {
        return {
            transform: `translate(${bounds.left - destination.left}px, ${bounds.top - destination.top}px) scale(${bounds.width / destination.width}, ${bounds.height / destination.height})`,
            transformOrigin: 'top left', opacity
        };
    }

    function arrivalBounds(bounds) {
        return { left: bounds.left + bounds.width * .02, top: bounds.top + bounds.height * .02 + 10, width: bounds.width * .96, height: bounds.height * .96 };
    }

    function taskBounds(state) {
        const bounds = state.task.getBoundingClientRect();
        const strip = taskbar.getBoundingClientRect();
        const width = Math.min(bounds.width, strip.width);
        // On narrow screens, an offscreen task lands at the nearest visible edge.
        return { left: Math.max(strip.left, Math.min(bounds.left, strip.right - width)), top: bounds.top, width, height: bounds.height };
    }

    function animateWindowIn(state, from = null, delay = 0) {
        const bounds = state.element.getBoundingClientRect();
        animateElement(state.element, [
            windowKeyframe(from?.bounds || arrivalBounds(bounds), bounds, from?.opacity ?? 0),
            windowKeyframe(bounds, bounds)
        ], { delay });
    }

    function revealWindow(state) {
        if (state.open && !state.minimized) return;
        const restoring = state.minimized;
        const from = state.exiting ? captureWindow(state) : null;
        finishMotion(state.element);
        state.open = true;
        state.minimized = false;
        syncWindows();
        constrainWindow(state);
        animateWindowIn(state, from || (restoring ? { bounds: taskBounds(state), opacity: .15 } : null));
    }

    function dismissWindow(state, close = false) {
        const from = captureWindow(state);
        finishMotion(state.element);
        const bounds = state.element.getBoundingClientRect();
        const destination = close ? arrivalBounds(bounds) : taskBounds(state);
        state.exiting = canAnimate();
        state.minimized = !close;
        if (close) state.open = false;
        animateElement(state.element, [
            windowKeyframe(from.bounds, bounds, from.opacity),
            ...(!close ? [{ opacity: .8, offset: .65 }] : []),
            windowKeyframe(destination, bounds, 0)
        ], {
            duration: close ? 180 : 260,
            complete: () => { state.exiting = false; syncWindows(); }
        });
    }

    function syncWindows() {
        windows.forEach((state, id) => {
            const visible = state.open && !state.minimized;
            state.element.hidden = !visible && !state.exiting;
            state.element.inert = !visible;
            if (!state.exiting) state.element.classList.toggle('is-active', visible && activeWindow === id);
            state.task.hidden = !state.open;
            state.task.setAttribute('aria-pressed', String(visible && activeWindow === id));
            state.task.setAttribute('aria-label', (visible && activeWindow === id ? 'Minimize ' : 'Restore ') + state.title);
        });
        const anyVisible = [...windows.values()].some(state => state.open && !state.minimized);
        for (const id of ['show-desktop', 'tray-desktop']) {
            const button = document.getElementById(id);
            button.setAttribute('aria-label', anyVisible ? 'Show desktop' : 'Restore windows');
            button.title = anyVisible ? 'Show desktop' : 'Restore windows';
        }
    }

    function focusWindow(id, focusContent = false) {
        const state = windows.get(id);
        if (!state || !state.open || state.minimized) return;
        activeWindow = id;
        if (zIndex > 9000) {
            [...windows.values()].sort((a, b) => a.layer - b.layer).forEach((item, index) => {
                item.layer = index + 10;
                item.element.style.zIndex = String(item.layer);
            });
            zIndex = 20;
        }
        state.layer = ++zIndex;
        state.element.style.zIndex = String(state.layer);
        syncWindows();
        if (focusContent) {
            const target = id === 'terminal' ? terminalInput : state.element.querySelector('.title-bar h2');
            target.focus({ preventScroll: true });
        }
    }

    function updateLocation(id) {
        try { history.replaceState(null, '', '#' + id); } catch { /* Local file previews still work. */ }
    }

    function constrainWindow(state) {
        const element = state.element;
        finishMotion(element);
        if (element.hidden || element.classList.contains('is-maximized')) return;
        const area = desktop.getBoundingClientRect();
        if (element.classList.contains('is-resized')) {
            element.style.width = Math.min(parseFloat(element.style.width), area.width - 12) + 'px';
            element.style.height = Math.min(parseFloat(element.style.height), area.height - 12) + 'px';
        }
        const bounds = element.getBoundingClientRect();
        const left = Math.max(0, Math.min(bounds.left - area.left, area.width - bounds.width));
        const top = Math.max(0, Math.min(bounds.top - area.top, area.height - bounds.height));
        if (element.style.left || Math.abs(left - (bounds.left - area.left)) > 1 || Math.abs(top - (bounds.top - area.top)) > 1) {
            element.style.left = left + 'px';
            element.style.top = top + 'px';
            element.style.right = 'auto';
        }
    }

    function openWindow(id, { focus = true, updateHash = true } = {}) {
        const state = windows.get(id);
        if (!state) return false;
        if (!state.open || state.minimized) state.returnFocus = document.activeElement;
        desktopSnapshot = null;
        revealWindow(state);
        focusWindow(id, focus);
        if (updateHash) updateLocation(id);
        announce(state.title + ' opened.');
        return true;
    }

    function chooseNextWindow() {
        const next = [...windows.entries()].filter(([, state]) => state.open && !state.minimized).sort((a, b) => b[1].layer - a[1].layer)[0];
        activeWindow = next ? next[0] : null;
        syncWindows();
        updateLocation(next ? next[0] : 'desktop');
    }

    function restoreFocus(state) {
        const previous = state.returnFocus;
        if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length && !previous.closest('[hidden], [inert]')) {
            previous.focus({ preventScroll: true });
        } else if (activeWindow) {
            windows.get(activeWindow).task.focus({ preventScroll: true });
        } else {
            startButton.focus({ preventScroll: true });
        }
    }

    function hideWindow(id, close = false) {
        finishDrag();
        finishResize();
        const state = windows.get(id);
        if (!state || !state.open || state.minimized) return;
        dismissWindow(state, close);
        desktopSnapshot = null;
        if (activeWindow === id) chooseNextWindow();
        else syncWindows();
        restoreFocus(state);
        announce(state.title + (close ? ' closed.' : ' minimized. Restore it from the taskbar.'));
    }

    function maximizeWindow(id) {
        finishDrag();
        finishResize();
        const state = windows.get(id);
        if (!state || !state.open || state.minimized) return;
        const from = captureWindow(state);
        finishMotion(state.element);
        const maximized = state.element.classList.toggle('is-maximized');
        const button = state.element.querySelector('.control-maximize');
        button.setAttribute('aria-label', (maximized ? 'Restore size of ' : 'Maximize ') + state.title);
        button.title = maximized ? 'Restore down' : 'Maximize';
        if (!maximized) constrainWindow(state);
        focusWindow(id);
        animateWindowIn(state, from);
        announce(state.title + (maximized ? ' maximized.' : ' restored to its previous size.'));
    }

    function finishDrag(event) {
        if (!activeDrag || (event && event.pointerId !== activeDrag.pointerId)) return;
        const drag = activeDrag;
        activeDrag = null;
        cancelAnimationFrame(drag.frame);
        drag.element.style.left = (drag.left + drag.dx) + 'px';
        drag.element.style.top = (drag.top + drag.dy) + 'px';
        drag.element.style.right = 'auto';
        drag.element.style.transform = '';
        drag.element.style.willChange = '';
        drag.element.classList.remove('is-dragging');
        if (drag.bar.hasPointerCapture(drag.pointerId)) drag.bar.releasePointerCapture(drag.pointerId);
    }

    function attachDragging(state) {
        const bar = state.element.querySelector('.title-bar');
        bar.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('button') || state.element.classList.contains('is-maximized')) return;
            finishDrag();
            finishResize();
            finishMotion(state.element);
            const bounds = state.element.getBoundingClientRect();
            const area = desktop.getBoundingClientRect();
            event.preventDefault();
            state.element.style.willChange = 'transform';
            state.element.classList.add('is-dragging');
            activeDrag = {
                element: state.element, bar, pointerId: event.pointerId,
                startX: event.clientX, startY: event.clientY, left: bounds.left - area.left, top: bounds.top - area.top,
                maxX: Math.max(0, area.width - bounds.width), maxY: Math.max(0, area.height - bounds.height),
                dx: 0, dy: 0, frame: 0
            };
            bar.setPointerCapture(event.pointerId);
        });
        bar.addEventListener('pointermove', event => {
            const drag = activeDrag;
            if (!drag || event.pointerId !== drag.pointerId) return;
            drag.dx = Math.max(0, Math.min(drag.maxX, drag.left + event.clientX - drag.startX)) - drag.left;
            drag.dy = Math.max(0, Math.min(drag.maxY, drag.top + event.clientY - drag.startY)) - drag.top;
            if (!drag.frame) drag.frame = requestAnimationFrame(() => {
                drag.frame = 0;
                drag.element.style.transform = 'translate(' + drag.dx + 'px, ' + drag.dy + 'px)';
            });
        });
        for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(eventName, finishDrag);
        bar.addEventListener('dblclick', event => {
            if (!event.target.closest('button')) maximizeWindow(state.element.id);
        });
    }

    function windowBounds(element) {
        const bounds = element.getBoundingClientRect();
        const area = desktop.getBoundingClientRect();
        return { left: bounds.left - area.left, top: bounds.top - area.top, width: bounds.width, height: bounds.height };
    }

    function applyWindowBounds(element, bounds) {
        element.classList.add('is-resized');
        element.style.right = 'auto';
        for (const property of ['left', 'top', 'width', 'height']) element.style[property] = bounds[property] + 'px';
    }

    function resizedBounds(origin, direction, dx, dy) {
        const area = desktop.getBoundingClientRect();
        const minimumWidth = Math.min(280, area.width - 12);
        const minimumHeight = Math.min(220, area.height - 12);
        const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
        let { left, top, width, height } = origin;
        if (direction.includes('e')) {
            const availableWidth = area.width - left - 4;
            width = clamp(width + dx, Math.min(minimumWidth, availableWidth), availableWidth);
        }
        if (direction.includes('s')) {
            const availableHeight = area.height - top - 4;
            height = clamp(height + dy, Math.min(minimumHeight, availableHeight), availableHeight);
        }
        if (direction.includes('w')) {
            left = clamp(left + dx, 4, origin.left + origin.width - minimumWidth);
            width = origin.left + origin.width - left;
        }
        if (direction.includes('n')) {
            top = clamp(top + dy, 4, origin.top + origin.height - minimumHeight);
            height = origin.top + origin.height - top;
        }
        return { left, top, width, height };
    }

    function announceSize(state) {
        const bounds = state.element.getBoundingClientRect();
        announce(state.title + ' resized to ' + Math.round(bounds.width) + ' by ' + Math.round(bounds.height) + ' pixels.');
    }

    function finishResize(event) {
        if (!activeResize || (event && event.pointerId !== activeResize.pointerId)) return;
        const resize = activeResize;
        activeResize = null;
        cancelAnimationFrame(resize.frame);
        applyWindowBounds(resize.state.element, resize.bounds);
        resize.state.element.classList.remove('is-resizing');
        if (resize.handle.hasPointerCapture(resize.pointerId)) resize.handle.releasePointerCapture(resize.pointerId);
        announceSize(resize.state);
    }

    function attachResizing(state) {
        for (const direction of ['n', 'e', 's', 'w', 'ne', 'nw', 'sw', 'se']) {
            const handle = document.createElement(direction === 'se' ? 'button' : 'div');
            handle.className = 'window-resize-handle resize-' + direction;
            if (direction === 'se') {
                handle.type = 'button';
                handle.setAttribute('aria-label', 'Resize ' + state.title);
                handle.setAttribute('aria-describedby', 'window-resize-help');
                handle.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight');
                handle.title = 'Drag to resize, or use arrow keys. Shift resizes faster.';
                handle.addEventListener('keydown', event => {
                    const step = event.shiftKey ? 40 : 10;
                    const directions = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                    if (!directions[event.key]) return;
                    event.preventDefault();
                    finishDrag();
                    finishResize();
                    finishMotion(state.element);
                    const [dx, dy] = directions[event.key];
                    applyWindowBounds(state.element, resizedBounds(windowBounds(state.element), 'se', dx, dy));
                    announceSize(state);
                });
                handle.addEventListener('click', event => {
                    if (event.detail === 0) announce('Use arrow keys to resize ' + state.title + '. Hold Shift for larger steps.');
                });
            } else handle.setAttribute('aria-hidden', 'true');
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0 || state.element.classList.contains('is-maximized')) return;
                event.preventDefault();
                finishDrag();
                finishResize();
                focusWindow(state.element.id);
                if (direction === 'se') handle.focus({ preventScroll: true });
                constrainWindow(state);
                const origin = windowBounds(state.element);
                applyWindowBounds(state.element, origin);
                state.element.classList.add('is-resizing');
                activeResize = { state, handle, direction, origin, bounds: origin, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, frame: 0 };
                handle.setPointerCapture(event.pointerId);
            });
            handle.addEventListener('pointermove', event => {
                const resize = activeResize;
                if (!resize || resize.pointerId !== event.pointerId) return;
                resize.bounds = resizedBounds(resize.origin, resize.direction, event.clientX - resize.startX, event.clientY - resize.startY);
                if (!resize.frame) resize.frame = requestAnimationFrame(() => {
                    resize.frame = 0;
                    applyWindowBounds(resize.state.element, resize.bounds);
                });
            });
            for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(eventName, finishResize);
            state.element.append(handle);
        }
    }

    document.querySelectorAll('[data-window]').forEach((element, index) => {
        const id = element.dataset.window;
        const state = {
            element, title: element.dataset.title, open: id === 'terminal' || (id === 'readme' && window.innerWidth > 1050),
            minimized: false, exiting: false, layer: index + 1, returnFocus: null, task: document.createElement('button')
        };
        state.task.type = 'button';
        state.task.className = 'taskbar-task';
        state.task.setAttribute('aria-controls', id);
        state.task.append(makeIcon(element.dataset.icon));
        const label = document.createElement('span');
        label.textContent = state.title;
        state.task.append(label);
        state.task.addEventListener('click', () => {
            if (state.open && !state.minimized && activeWindow === id) hideWindow(id);
            else openWindow(id);
        });
        taskbar.append(state.task);
        windows.set(id, state);
        element.style.zIndex = String(state.layer);
        element.querySelector('.title-bar h2').tabIndex = -1;
        const controls = element.querySelector('.window-controls');
        for (const action of ['minimize', 'maximize', 'close']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'control-' + action;
            button.setAttribute('aria-label', action[0].toUpperCase() + action.slice(1) + ' ' + state.title);
            button.title = action[0].toUpperCase() + action.slice(1);
            const mark = document.createElement('span');
            mark.setAttribute('aria-hidden', 'true');
            if (action === 'close') mark.textContent = '×';
            button.append(mark);
            button.addEventListener('click', () => {
                if (action === 'maximize') maximizeWindow(id);
                else hideWindow(id, action === 'close');
            });
            controls.append(button);
        }
        element.addEventListener('pointerdown', () => focusWindow(id));
        element.addEventListener('focusin', () => {
            if (activeWindow !== id) focusWindow(id);
        });
        attachDragging(state);
        attachResizing(state);
    });

    function setStartOpen(open) {
        const current = motions.has(startMenu) ? getComputedStyle(startMenu) : null;
        const from = current ? { transform: current.transform, opacity: current.opacity }
            : { transform: open ? 'translateY(10px) scale(.98)' : 'none', opacity: open ? 0 : 1 };
        finishMotion(startMenu);
        startOpen = open;
        startMenu.hidden = false;
        startMenu.inert = !open;
        startButton.setAttribute('aria-expanded', String(open));
        animateElement(startMenu, [from, { transform: open ? 'none' : 'translateY(8px) scale(.98)', opacity: open ? 1 : 0 }], {
            duration: open ? 220 : 150,
            complete: () => { startMenu.hidden = !startOpen; }
        });
    }

    function closeStart(restore = false) {
        if (!startOpen) return;
        setStartOpen(false);
        if (restore) startButton.focus({ preventScroll: true });
    }

    startButton.addEventListener('click', () => {
        setStartOpen(!startOpen);
        if (startOpen) startMenu.querySelector('a').focus({ preventScroll: true });
    });
    document.addEventListener('pointerdown', event => {
        if (!startMenu.contains(event.target) && !startButton.contains(event.target)) closeStart();
    });
    document.addEventListener('focusin', event => {
        if (startOpen && !startMenu.contains(event.target) && !startButton.contains(event.target)) closeStart();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && startOpen) {
            event.preventDefault();
            closeStart(true);
        }
    });
    startMenu.addEventListener('keydown', event => {
        const items = [...startMenu.querySelectorAll('a, button')];
        const current = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        }
    });

    document.addEventListener('click', event => {
        const link = event.target.closest('[data-open]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        closeStart();
        openWindow(link.dataset.open);
    });

    function showDesktop() {
        finishDrag();
        finishResize();
        closeStart();
        const visible = [...windows.entries()].filter(([, state]) => state.open && !state.minimized).map(([id]) => id);
        if (visible.length) {
            desktopSnapshot = { ids: visible, active: activeWindow };
            if (document.activeElement.closest('[data-window]')) startButton.focus({ preventScroll: true });
            visible.forEach(id => dismissWindow(windows.get(id)));
            activeWindow = null;
            syncWindows();
            announce('Desktop shown. Use the taskbar or Start to restore a window.');
        } else {
            const snapshot = desktopSnapshot;
            desktopSnapshot = null;
            const restore = snapshot ? snapshot.ids : [...windows.entries()].filter(([, state]) => state.open).map(([id]) => id);
            restore.forEach(id => revealWindow(windows.get(id)));
            if (restore.length) focusWindow(snapshot?.active || restore[restore.length - 1]);
            else openWindow('terminal');
            announce('Windows restored.');
        }
    }
    document.getElementById('show-desktop').addEventListener('click', showDesktop);
    document.getElementById('tray-desktop').addEventListener('click', showDesktop);

    function appendEntry(command) {
        const entry = document.createElement('div');
        entry.className = 'terminal-entry';
        const echo = document.createElement('p');
        echo.className = 'terminal-entry-command';
        echo.textContent = 'visitor@bryantOS:~$ ' + command;
        const result = document.createElement('div');
        result.className = 'terminal-result';
        entry.append(echo, result);
        terminalOutput.append(entry);
        if (terminalOutput.children.length > 80) terminalOutput.firstElementChild.remove();
        return result;
    }

    function appendLink(parent, label, href) {
        const link = document.createElement('a');
        link.textContent = label;
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        parent.append(link);
    }

    const helpCommands = [
        ['about', 'The person behind the work'],
        ['work', 'My engineering contributions at UKG'],
        ['skills', 'Tools, languages & practice'],
        ['archive', 'Projects from my FIU years'],
        ['resume', 'My resume, open in Word'],
        ['contact', "Let's start a conversation"],
        ['whoami', 'A quick introduction'],
        ['theme', 'Switch chrome / midnight wallpaper'],
        ['clear', 'A fresh terminal'],
        ['home', 'Bring back the welcome screen']
    ];
    const commandNames = ['help', 'about', 'work', 'projects', 'skills', 'archive', 'resume', 'contact', 'whoami', 'theme', 'clear', 'cls', 'home', 'ls', 'dir', 'pwd', 'open', 'github', 'linkedin', 'date', 'history', 'echo'];
    const aliases = { projects: 'work', cls: 'clear', dir: 'ls' };
    const openNames = ['terminal', 'about', 'work', 'skills', 'archive', 'resume', 'contact', 'readme'];

    function scrollTerminal() { terminalScreen.scrollTop = terminalScreen.scrollHeight; }

    function applyWallpaper(theme, persist = true) {
        document.documentElement.dataset.wallpaper = theme;
        document.getElementById('wallpaper-button').setAttribute('aria-label', 'Switch to ' + (theme === 'chrome' ? 'midnight' : 'chrome') + ' wallpaper');
        document.querySelector('meta[name="theme-color"]').content = theme === 'chrome' ? '#cedae8' : '#252d43';
        if (persist) {
            try { localStorage.setItem('bryantos-wallpaper', theme); } catch { /* The setting still works for this visit. */ }
        }
    }

    function runCommand(rawCommand) {
        const text = rawCommand.trim();
        if (!text) return;
        commandHistory.push(text);
        if (commandHistory.length > 100) commandHistory.shift();
        historyIndex = commandHistory.length;
        historyDraft = '';
        terminalInput.value = '';
        const [name, ...args] = text.split(/\s+/);
        const command = aliases[name.toLowerCase()] || name.toLowerCase();
        const argument = args.join(' ');

        if (command === 'clear' || command === 'home') {
            terminalOutput.replaceChildren();
            terminalWelcome.hidden = command === 'clear';
            openWindow('terminal', { updateHash: false });
            terminalScreen.scrollTop = 0;
            announce(command === 'clear' ? 'Terminal cleared.' : 'Welcome screen restored.');
            return;
        }

        const result = appendEntry(text);
        switch (command) {
            case 'help': {
                const intro = document.createElement('p');
                intro.textContent = 'A few ways to explore. Click a command or type it below.';
                const list = document.createElement('div');
                list.className = 'terminal-help';
                for (const [name, description] of helpCommands) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.command = name;
                    button.textContent = name;
                    const detail = document.createElement('span');
                    detail.textContent = description;
                    list.append(button, detail);
                }
                const extra = document.createElement('p');
                extra.textContent = '\nAlso: ls, pwd, open <window>, github, linkedin, date, history, echo.\nTab completes a command. ↑ / ↓ revisit your history.';
                result.append(intro, document.createElement('br'), list, extra);
                break;
            }
            case 'whoami':
                result.textContent = "Bryant Villarreal\nSoftware Engineer II @ UKG\nBackend engineering · Identity & Access Management\nM.S. Computer Science, FIU, December 2025\n\nCurious about systems. Serious about the details.";
                break;
            case 'about':
            case 'work':
            case 'skills':
            case 'archive':
            case 'resume':
            case 'contact':
                result.textContent = 'Opening ' + windows.get(command).title + '...';
                openWindow(command);
                break;
            case 'open': {
                const target = argument.toLowerCase();
                if (openNames.includes(target)) {
                    result.textContent = 'Opening ' + windows.get(target).title + '...';
                    openWindow(target);
                } else result.textContent = 'Usage: open <window>\nAvailable: ' + openNames.join(', ');
                break;
            }
            case 'github':
                appendLink(result, 'github.com/bryantvilla ↗', 'https://github.com/bryantvilla');
                break;
            case 'linkedin':
                appendLink(result, 'Bryant Villarreal on LinkedIn ↗', 'https://www.linkedin.com/in/bryant-villarreal/');
                break;
            case 'ls':
                result.textContent = 'C:\\Bryant\\\n';
                for (const [name] of helpCommands.filter(([name]) => ['about', 'work', 'skills', 'archive', 'resume', 'contact'].includes(name))) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.command = name;
                    button.textContent = name === 'resume' ? 'resume.doc' : name + '/';
                    result.append(button, document.createTextNode('  '));
                }
                break;
            case 'pwd':
                result.textContent = 'C:\\Bryant\\Portfolio\nYou are right where you should be.';
                break;
            case 'date':
                result.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date());
                break;
            case 'history':
                result.textContent = commandHistory.map((item, index) => String(index + 1).padStart(2, ' ') + '  ' + item).join('\n');
                break;
            case 'echo':
                result.textContent = argument || '(An echo needs a little something to say.)';
                break;
            case 'theme': {
                const theme = argument.toLowerCase() || (document.documentElement.dataset.wallpaper === 'chrome' ? 'midnight' : 'chrome');
                if (!['chrome', 'midnight'].includes(theme)) {
                    result.textContent = 'Usage: theme chrome  or  theme midnight';
                    break;
                }
                applyWallpaper(theme);
                result.textContent = 'Wallpaper set to ' + theme + '. Make yourself at home.';
                break;
            }
            case 'sudo':
                result.textContent = "Nice try. You're already very welcome here.\nTry help to see what you can do.";
                break;
            default: {
                const error = document.createElement('span');
                error.className = 'result-error';
                error.textContent = 'Command not found: ' + name;
                result.append(error, document.createTextNode('\nType help for a list of commands.'));
            }
        }
        scrollTerminal();
        if (activeWindow === 'terminal') terminalInput.focus({ preventScroll: true });
    }

    document.getElementById('terminal-form').addEventListener('submit', event => {
        event.preventDefault();
        runCommand(terminalInput.value);
    });
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-command]');
        if (!button) return;
        openWindow('terminal', { focus: false, updateHash: false });
        runCommand(button.dataset.command);
    });

    terminalInput.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            if (!commandHistory.length) return;
            event.preventDefault();
            if (historyIndex === commandHistory.length) historyDraft = terminalInput.value;
            historyIndex = Math.max(0, Math.min(commandHistory.length, historyIndex + (event.key === 'ArrowUp' ? -1 : 1)));
            terminalInput.value = historyIndex === commandHistory.length ? historyDraft : commandHistory[historyIndex];
            terminalInput.setSelectionRange(terminalInput.value.length, terminalInput.value.length);
        } else if (event.key === 'Tab' && !event.shiftKey && terminalInput.value.trim()) {
            const current = terminalInput.value.toLowerCase();
            const choices = current.startsWith('open ') ? openNames.map(name => 'open ' + name)
                : current.startsWith('theme ') ? ['theme chrome', 'theme midnight'] : commandNames;
            const matches = choices.filter(name => name.startsWith(current));
            if (matches.length === 1 && matches[0] !== current) {
                event.preventDefault();
                terminalInput.value = matches[0];
            } else if (matches.length > 1) {
                event.preventDefault();
                const result = appendEntry('autocomplete: ' + current);
                result.textContent = matches.join('  ');
                scrollTerminal();
            }
        } else if (event.key === 'l' && event.ctrlKey) {
            event.preventDefault();
            runCommand('clear');
        } else if (event.key === 'Escape') {
            terminalInput.value = '';
            historyIndex = commandHistory.length;
        }
    });
    terminalInput.addEventListener('input', () => { historyIndex = commandHistory.length; });
    terminalInput.addEventListener('focus', () => {
        terminalInput.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });

    document.getElementById('wallpaper-button').addEventListener('click', () => {
        const next = document.documentElement.dataset.wallpaper === 'chrome' ? 'midnight' : 'chrome';
        applyWallpaper(next);
        announce(next[0].toUpperCase() + next.slice(1) + ' wallpaper applied.');
    });
    try {
        const saved = localStorage.getItem('bryantos-wallpaper');
        if (saved === 'chrome' || saved === 'midnight') applyWallpaper(saved, false);
    } catch { /* Storage is optional. */ }

    document.getElementById('copy-email').addEventListener('click', async event => {
        const button = event.currentTarget;
        try {
            await navigator.clipboard.writeText('bryantavillarreal@gmail.com');
            button.textContent = 'Email copied!';
            announce('Email address copied to clipboard.');
        } catch {
            button.textContent = 'Use the email link above';
            announce('Copy is unavailable. Use the email link above, or select the address to copy it.');
        }
    });

    const contactForm = document.forms.portfolio_contact;
    const contactWindow = document.getElementById('contact');
    const contactFeedback = document.getElementById('contact-feedback');
    const contactSubmit = contactForm.querySelector('[type="submit"]');
    const contactSubmitLabel = document.getElementById('contact-submit-label');
    const contactDelivery = document.getElementById('contact-delivery-status');
    const sendAnother = document.getElementById('send-another');
    let sendingMessage = false;

    function showContactFeedback(success, title, message) {
        contactWindow.dataset.delivery = success ? 'sent' : 'error';
        contactFeedback.hidden = false;
        document.getElementById('contact-feedback-mark').textContent = success ? '✓' : '!';
        document.getElementById('contact-feedback-title').textContent = title;
        document.getElementById('contact-feedback-message').textContent = message;
        sendAnother.hidden = !success;
        contactDelivery.textContent = success ? 'Message sent' : 'Check your message';
        announce(title + ' ' + message);
        // A response must not pull visitors away from another app they opened.
        if (activeWindow === 'contact' && !contactWindow.inert) {
            contactFeedback.focus({ preventScroll: true });
            contactFeedback.scrollIntoView({ block: 'nearest', behavior: 'instant' });
            animateElement(contactFeedback, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 220 });
        }
    }

    contactForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (sendingMessage || !contactForm.reportValidity()) return;
        const data = new FormData(contactForm);
        const fields = [...contactForm.querySelectorAll('input, textarea')];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        sendingMessage = true;
        contactFeedback.hidden = true;
        contactSubmit.disabled = true;
        fields.forEach(field => { field.readOnly = true; });
        contactForm.setAttribute('aria-busy', 'true');
        contactWindow.dataset.delivery = 'sending';
        contactSubmitLabel.textContent = 'Sending…';
        contactDelivery.textContent = 'Sending message…';
        announce('Sending your message.');
        try {
            const response = await fetch(contactForm.action, {
                method: 'POST', body: data, headers: { Accept: 'application/json' }, signal: controller.signal
            });
            const result = await response.json().catch(error => {
                if (error.name === 'AbortError') throw error;
                return null;
            });
            if (response.ok && result?.ok === true) {
                contactForm.reset();
                contactForm.hidden = true;
                showContactFeedback(true, 'Message sent!', 'Thanks for reaching out. I’ll reply to ' + data.get('email') + '.');
            } else if (!response.ok || result?.ok === false || result?.errors?.length) {
                const errors = Array.isArray(result?.errors) ? result.errors.map(error => error?.message).filter(message => typeof message === 'string').join(' ') : '';
                showContactFeedback(false, 'Couldn’t send your message.', (errors || 'Please try again in a moment.') + ' Your draft is still here. You can also use the email link below.');
            } else {
                showContactFeedback(false, 'Couldn’t confirm delivery.', 'The server returned an unexpected response. Your draft is still here. Try again, or use the email link below.');
            }
        } catch (error) {
            const reason = error.name === 'AbortError' ? 'The request took too long.' : 'The connection was interrupted.';
            showContactFeedback(false, 'Couldn’t confirm delivery.', reason + ' Your draft is still here. Try again, or use the email link below.');
        } finally {
            clearTimeout(timeout);
            sendingMessage = false;
            fields.forEach(field => { field.readOnly = false; });
            contactForm.removeAttribute('aria-busy');
            contactSubmit.disabled = false;
            contactSubmitLabel.textContent = contactForm.hidden ? 'Send message' : 'Try again';
        }
    });

    sendAnother.addEventListener('click', () => {
        finishMotion(contactFeedback);
        contactFeedback.hidden = true;
        contactForm.hidden = false;
        delete contactWindow.dataset.delivery;
        contactSubmitLabel.textContent = 'Send message';
        contactDelivery.textContent = 'Ready to send';
        contactForm.elements.name.focus();
    });

    const resumeDocument = document.getElementById('resume-document');
    document.getElementById('print-resume').addEventListener('click', () => {
        resumeDocument.contentWindow.focus();
        resumeDocument.contentWindow.print();
    });
    // Focus and pointer events inside an iframe do not bubble to its desktop window.
    const focusResume = () => focusWindow('resume');
    const connectResume = () => {
        const page = resumeDocument.contentDocument;
        if (!page) return;
        page.defaultView.addEventListener('focus', focusResume);
        page.addEventListener('pointerdown', focusResume);
        page.addEventListener('focusin', focusResume);
    };
    resumeDocument.addEventListener('load', connectResume);
    connectResume();

    document.getElementById('reset-desktop').addEventListener('click', () => {
        finishDrag();
        finishResize();
        finishAllMotion();
        windows.forEach((state, id) => {
            state.open = id === 'terminal' || (id === 'readme' && window.innerWidth > 1050);
            state.minimized = false;
            state.element.classList.remove('is-maximized', 'is-resized');
            for (const property of ['left', 'top', 'right', 'width', 'height', 'transform', 'animation', 'will-change']) state.element.style.removeProperty(property);
            state.element.querySelector('.control-maximize').setAttribute('aria-label', 'Maximize ' + state.title);
            state.element.querySelector('.control-maximize').title = 'Maximize';
        });
        terminalWelcome.hidden = false;
        terminalOutput.replaceChildren();
        terminalInput.value = '';
        desktopSnapshot = null;
        closeStart();
        focusWindow('terminal');
        windows.forEach(state => {
            if (state.open) animateWindowIn(state);
        });
        terminalScreen.scrollTop = 0;
        updateLocation('terminal');
        startButton.focus({ preventScroll: true });
        announce('Desktop reset. Welcome back.');
    });

    function routeHash() {
        const id = location.hash.slice(1);
        if (windows.has(id)) openWindow(id, { focus: false, updateHash: false });
        else {
            const oldLinks = { home: 'terminal', main: 'terminal', education: 'about', 'undergraduate-work': 'archive', 'authentication-security': 'work', 'enterprise-sso': 'work' };
            if (oldLinks[id]) {
                openWindow(oldLinks[id], { focus: false, updateHash: false });
                const details = document.getElementById(id);
                if (details instanceof HTMLDetailsElement) {
                    details.open = true;
                    details.scrollIntoView({ block: 'nearest' });
                }
            }
        }
    }
    window.addEventListener('hashchange', routeHash);

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
        if (resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            finishDrag();
            finishResize();
            finishAllMotion();
            windows.forEach(constrainWindow);
        });
    });
    window.addEventListener('blur', () => { finishDrag(); finishResize(); });

    const donutElement = document.getElementById('terminal-donut');
    if (donutElement) {
        const donutFrames = [
            "           $$$$##########$$$$           \n         ##*****!******!*****##         \n       **!!!!!!!!!!!!!!!!!!*!!!**       \n      !!!!=====;;;;;;;;;;======!!!      \n     ====;;;:::~~~~~~~~~~:::;;;====     \n     ;;;::~~--,,...  ...,,--~~::;;;     \n     ::~~-,,..            ..,--~~::     \n     ~~-,,.  ...-      ~...  .,,-~~     \n     --,,..  ...:!####!:...  ..,,--     \n      ,,.......,;*#$$#!;,.......,.      \n        ....,,-:=!!**!!=:-,,....        \n           .,,-:;=!!!!=;:-,..           \n               .,,----,,.               \n                                        \n                                        \n                                        ",
            "           $$$$############$$           \n         ###**********!!!!****#         \n       ***!**!!!!!!!!!!!!!!!!!!!*       \n      !!!!!!===;;;;;;;;;;;;===!!=!      \n     ==!==;;:::~~~------~~~:::;;==      \n     ==;;::~---,...    ...,,-~~::;:     \n     ;::~~--,.             ..,-~~::     \n     :~~-,,.  ..       ,..   .,,-~      \n     ~---,... ..:!*!##!;......,,--      \n      ,,,,.....,;!#$$#*=~,,..,,,,       \n       .,,,,,,-:;!**#*!=;~--,,.         \n         ..,,-~:;=!!*!=;:~-,.           \n             ..,-~:::~~-,               \n                                        \n                                        \n                                        ",
            "           $$$#############$$           \n         ####******!!!!!!!!***#         \n       ***!*!!!!!!!!!!!!!!!!!!!!        \n      !!!!!!!===;;;::::::;;;==!!=       \n     =!!!==;;:::~~--,,,---~~::;;=;      \n    ;===;;::~~-,,.       ..,--~:;;      \n    ;;;;:~~-,,.            ..,-~~:      \n    :::~~--,. ..       ..  ...,--~      \n     ~~~--,,....~=  !*!;.....,,--       \n     -----,,...,;!#$@$*!:~--,,,,        \n      ,,,,,,,--:=!*##**!=:~~--.         \n        .,,,-~~:;!!!!*!=;:~-.           \n           .,,-~~:;;;;:~-.              \n                                        \n                                        \n                                        ",
            "           $$$$############$            \n         ####****!!**!*!!*****          \n       #***!*!*!!!!!!!!!=!!==!!!        \n      *!!**!!!==;;;::::::;;;==!==       \n     !!!!===;;::~~--,,,,--~~::;=;       \n    =====;;::~-,..       ..,--~:;       \n    ;=;;:::~-,.            .,,-~:       \n    ;;:::~~-,.         ......,--~       \n    ~:::~--,....~    *!=...,,----       \n     ~~~~--,,...;!#$@$#*;~~~---,        \n      --------~:=!*#$#*!=;:~~-.         \n       ,,----~:;=!!!!!!!=::~.           \n          .,,-~::;====;:~,              \n                ....                    \n                                        \n                                        ",
            "           $$$$$###########$            \n         ####*******!!!!!!!***          \n       ##****!!**!!!====!!=!=!!         \n      ***!!!!!===;::::::::;;==!=        \n     !!!!!===;::~---,,,,---~:;;=;       \n    =!!!==;;:~--,.       ..,-~:;;       \n    ===;;;:~~-,            .,-~::       \n    ;;;;::~~-,         ....,,-~~~       \n    :::::~~-,...-    !!=,,----~~        \n     ~:~~~~--,,,;!#$@$#*;:::~~~,        \n     -~~~~~~~~~:=!*#$$#*!=;::~.         \n       ----~~~:;==!!***!!=;~,           \n         ,---~::;==!!!=;:-.             \n             .,,-----,                  \n                                        \n                                        ",
            "           $$$$$$########$$             \n         #####*****!*!!!!!!**           \n       ##****!*!!!!!=!!!!!=!!!!         \n      ***!**!!!=;;;::::::;;=====        \n     !!*!!!!=;;:~~-,,,,,,-~~:;==        \n    =!!!===;::~-,.       ..-~~:;:       \n    =====;;:~-,.          .,-~~::       \n    ;==;;;:~-,.        ....--~~:~       \n    ;;;;:::~-,..-    =!=--~~~~~~        \n    ~:::::~~--,-:=*$@$$#*;;:::~,        \n     ~~:::~~~~~:=!*$$$$*!!=;:~.         \n      ,-~~~~:::;==!****!*!=:-           \n        ,--~~::;==!=!!!=;:,             \n           .,,-~~::::~-.                \n                                        \n                                        ",
            "           $$$$$$$#######$              \n         $$####****!*!!!!!**#           \n       ###****!!*!!====!!!=!!!          \n      ******!!!==;;::::::;;==!=         \n     !*!!!!!=;;:~~--,,,,,-~:;;==        \n    =!!!!!==;:~-,.       .,-~:;;        \n    =!!===;;:~-.         ..--~:;        \n    =====;;:~-,        ...,~~:::        \n    ;;;;;;::~-..,     !!~~~::::~        \n    ::;;;:::~~--;=*#$$$#*==;;;:         \n     ~:::::::::;=!*$$$$##!==;:.         \n      -~~:::::;;=!!*****!!=;~           \n       .-~~~::;;=!=!!!!!=;~             \n          .,-~~::;;;;::-.               \n                                        \n                                        ",
            "            $$$$$$$###$$$$              \n         $$$####***!!!!!!**#            \n       ####***!!**!!!!!!!!!!!*          \n      *****!!*!==;;:::::;;====!         \n     ***!!*!!=;::~-,,.,,-~~:;===        \n    =!!!!!!=;:~~,.      ..-~:;=;        \n    =!!!===;:~-,        ..-~~:;;        \n    ======;:~~,.       ..,-~::;:        \n    ;====;;:~-,.,     !!~::;;;;:        \n    :;;;;;;::~~:;=!*$$$$#*===;:         \n     ::;;;;;;::==!*#$@@$#*!!=:,         \n      ~::::;;;;==!**###*!*!=:           \n       ,~~~::;;==!!!!!!!!=:,            \n         .--~~::;;====;:-               \n              ..,,,,.                   \n                                        ",
            "            $$$$$$$$$$$$$               \n         $$$$###*****!!***##            \n       #####****!!!!!!=!!==!*           \n      *#****!!!!=;;::::;;==!=!!         \n     ****!*!!=;;:~-,,,,,-~:;=!=         \n    =!!!*!!==;:~,.      .,-~;;=;        \n    =!!!!!=;;~-,        .,-~:;;;        \n    =!!!===;:~-.       ..-~:;;;;        \n    ;=====;;:~-.,     =!:;;;;;;:        \n    :;===;;;;:~;;=!*$$$$##!!==;         \n     :;;;;;;;;;=!!*#$@@$##*!!;-         \n      ~:;;;;;;==!!*#####*!*=;,          \n       -~::;;;====!!!!!!!!;~            \n         ,-~:::;;;=====;~,              \n            .,,------,                  \n                                        ",
            "             @@$$$$$$$$$                \n         $$$$####****!***##             \n       #####***!!!!*!!!!!!!**           \n      ###*****!!==;;::;;;=!!!!          \n     *******!==;:~--,,,--~;;===         \n    =****!!==;:~-.     ..,~:;==;        \n    =!!!!!!=;:~,        .,~:;;=;        \n    =!!!!!=;;:-.       .,~:;;==;        \n    ==!====;::-,-     =!!;=====:        \n    ;=======;;;;;=!*#$$$##*!!=;         \n     :;======;==!**#$@@@$#*!!=~         \n     -:;;;;====!!**######*!!;~          \n       ~::;;;===!!!!!!!!!!=:            \n        .-~:::;;====!!!=;~.             \n            ,--~~~:~~--                 \n                                        ",
            "             @@@@$$$$$$                 \n          $$$$###*******###             \n        #####**!!!!!!!!!!!!**           \n      ####****!!==;;;;;;==!!!!          \n     ******!!!=;:~--,,,-~:;=!!!         \n    =*****!!=;:~-.     ..-~;===         \n    !!*!!!!=;:~-        .-::;==;        \n    !!!!!!==;:~,       .-~:;===;        \n    =!!!!!==;::~-     =!*!*!!!=:        \n    ;========;=;;== *$$$$##**!=         \n     ;;=======!!!**#$@@@$$#**=:         \n     -:;;=====!!!**##$$##*!!=:          \n       ~:;;;====!!!!**!!!!!;-           \n        ,~:::;;===!!!!!==:-             \n           ,-~~~:::::~~,                \n                                        ",
            "              @@@@@@$$                  \n          $$$$$####****###              \n        $$$###**!!!!!=!!!!**            \n      #####**!!!!==;;;;==!!!!!          \n     *##****!!=;:~--,,-~:;==!!!         \n    =*****!!=;:~-.     .,~:;=!!         \n    !!***!!!=;~-       .,~:;==!;        \n    !!*!!!!=;;~,       .-:;==!!;        \n    =!!!!!!==;:~-     ;!****!!=;        \n    ;=!!!!!=======; *#$$$$##*!=~        \n     ;===!!!!!!!!**#$$@@$$#*!!;         \n     ~;;====!!!!**###$$$##*!!;          \n      ,:;;;===!!!!!****!!!!=:           \n        -~::;;==!!!!!!!!=;~             \n           -~~~::;;;;::~,               \n                                        ",
            "               @@@@@@                   \n          $$$$$######*####              \n        $$$$##**!!!!!!!!***#            \n      ######*!!!!==;;;==!!!!*           \n     *####**!!=;;:~----~:;=!!!          \n     ******!!=;~-.    ..-~:=!!!         \n    !*****!!=;:-       .-:;==!!;        \n    =!!***!!=;:,       .~:=!!!!;        \n    =!!!!!!!==;:-     :!**#***!;        \n    ;=!!!!!!!!!===  =#$$$$##*!!~        \n     ;=!!!!!!!!!**##$$@@$$$#*!;         \n     ~;===!!!!!***##$$$$##*!!=          \n      -:;;===!!!!!*******!!!:           \n        -::;;==!!!!!!*!!!=;-            \n          .-~::;;;;;;;;:~               \n                ....                    ",
            "                 @@                     \n          $$$$$$$#######$               \n        $$$$##***!!!!=!!!*#*            \n      ######**!!!===;===!!!**           \n     *####**!===;:~---~:;=!!!*          \n     *##***!!=;:-.    .,-:;=!!!         \n    !******!=;:-.      .-:==!!!;        \n    =!****!!=;:-       ,~;=!**!;        \n    =!!!**!!!==:~     :!*####*!;        \n    ;!!!!!!!!!!!==   *$$$$$##*!:        \n    ~==!!!!!!!****##$$@@@$$#*==         \n     ~;=!!!!!!****##$$$$$#**!=~         \n      ~:;===!!!!!****#***!!!;-          \n        ~:;;===!!!!!!!!!!!;~            \n          ,~:::;;;====;:~-              \n              .,,-,,,.                  ",
            "                                        \n           @@$$$$$####$$                \n        $$$$$##**!!!=!!!*##             \n       #$###**!=======!!!!!**           \n     *#####*!!==;:~--~~:;=!!**          \n     *####**!=;:-,    .,~:=!!*!         \n    !******!!=:-.      ,~;=!!*!         \n    !******!!=:-       ,:;!****=        \n    =!******!!=;~     -!*####*!;        \n    ;!!!*****!!!!=;  *#$$$$$#*!;        \n    ~=!!!*!*******##$$@@@@$#*!!         \n     :;=!!!!!****###$$$$$##*!=:         \n      ~:===!!!!*****###***!!=~          \n       .~:;===!!!!!!!!!!=!=:,           \n          -~:;;;=======;:~.             \n             .,,-----,.                 ",
            "                                        \n           $@@$$$$$$$$$$                \n        #$$$$##***!!!!!*###             \n       $$$$##*!!!!!=!!!!!!***           \n     !#####**!==;:~~~~:;=!!!**          \n     *####**!=;:-,   .,~:;=!**!         \n    !*####**!=;~.      ,:;!****         \n    !*******!=;~       -:!*###*=        \n    =!*******!!;:      !*#$###*=        \n    ;!!********!!==  !#$$$$$$#!=        \n    :=!!!********###$$$@@@$$#!=~        \n     :==!!!*!***####$$$$$$#*!!;         \n      ~;==!!!!!****#####**!!=;          \n       ,:;===!!!!!!!!!!!!!!;~           \n         .~:;;;===!=!!==;:-             \n             ,--~~~~~--.                ",
            "                                        \n            @@@@$$$$$$$                 \n         $$$$$##****!***##              \n       $$$$##**!!=!!!!!!!**#            \n      #$$###*!===::~:::;=!!*#*          \n     *#####*!!;:~,. ..,:;=!!**!         \n    !*#####*!=;~.     .-:=**##*         \n    !**####**!;:       -=*####*=        \n    =!***##***!=:      !*#$$$#*=        \n    =!!*********!!=  !#$$@$$$#*=        \n    :=!*******######$$$@@@$$#*!;        \n     ;=!!******####$$$$$$$##*==         \n      :;=!!!!!!***#######*!!==,         \n       -:;==!!!!!!!!!*!!!!==:           \n         ,~:;;;==!=!!!!==;~.            \n            .--~~::::~~-.               ",
            "                                        \n             @@@@@@$$$                  \n         $@$$$$##*****##$#              \n       $$$$$##*!=!!!!!*!**##            \n      #$$$##*!==;;::::;=!!*##           \n     ##$$###*!;:~-...,-;;=**##!         \n    !######**!;~.     ,~;!*###*         \n    !*######*!=:       ~=*#####!        \n    =**#####**!!;      =*$$$$$#!        \n    =!****#####**!=  =#$$@@$$$*=        \n    :=!!****########$$$@@@@$$#!=        \n     ;=!!*!**######$$$$$$$$#*!=:        \n      :==!!**!***#########*!!=:         \n       -:;=!!!!*!!!***!!!!!!=~          \n         -::;===!!!!!!!!==:~            \n            ,-~::::::::~-               ",
            "                                        \n               @@@@                     \n          @@@$$########$$               \n       #$$$$$#*!!!!!!!!**###            \n      #$$$$##*!;=;;;;==!*!*##           \n     ##$$$##*!=:~-,,,-~;!!*###!         \n    !##$$$##*!;~,     ,:=!*####         \n    !*######**=:       ~=*#$$$#*        \n    =**#######*!;      =*$$$$$#*        \n    =!**########**!  ;*$$@@@$$#!        \n    :!!***#########$$$$@@@@$$#*=        \n     ;=!!!***####$$$$$$$$$$##*==        \n      :=!!!!!***##########**=!;         \n       ~:==!!*!*!!!****!!!=!=;          \n         -:;;===!!!!!!!!!=;:,           \n            -~:::;;;;;::~,              ",
            "                                        \n                                        \n           @@@$$$####$$$                \n        $@$$$##*!!!!!!**#$$             \n      #$$$$$#*!=======!!!*#$#           \n     #$$$$$#*!=::--,-~;=**##$#!         \n    !#$$$$$#*!=~,    .-:=*#$$$#=        \n    !##$$$$##*!;      .~=*#$$$$*        \n    !*###$$$##**=      ;*$$@$$$#;       \n    =!*####$$$###**=  *$$@@@@$$*;       \n    :=!**####$$$$$$$$$$@@@@$$$#!:       \n     ;!*****####$$$$$$$$$$$$#*!=        \n      ;=!*!!***############**!=:        \n       ~;==!!**!!*******!!!!==~         \n         ~:;===!!!!!!!!!!!=;~           \n            -~::;;;;;;;;:~,             ",
            "                                        \n                                        \n            @@@@$$$$$$$                 \n        #@@@$$##*!!!!**#$$$             \n       $$$$$##!=;===!!!**##$$           \n     *$$$$$$#*=;;~-~~:=!!*#$$$*         \n     #$$$$$##*=~,    ,~;=*#$$$$*        \n    !##$$$$$#*!;      .~=*$$$$$#        \n    !*##$$$$$##*=      :*#$@@@$#!       \n    =!*##$$$$$$$##** !*#$@@@@$$#!       \n    :=!**###$$$$$$$$$$$@@@@@$$#*;       \n     ;!!***###$$$$$$$$$$$$$$##*=;       \n      ;=!!!****#######$####**!!=        \n       ~;=!!***!!********!!!==;         \n         ~:;==!!!!!*!!!!!!==:-          \n           .-~:;;;;;=;;;:~~             ",
            "                                        \n                                        \n              @@@@@@@$                  \n         $@@@$$##****##$$$              \n       $@@@$$#*!==!!!*!*##$$$           \n      $$$$$$#*!:;;:::;!!!#$$$$#         \n     #$$$$$$#*=~-.  .-:==*#$$$$#        \n    =#$$$$$$##!;      .~=*#$@@$$*       \n    =*#$$$$$$$##!      :*#$@@@$$*       \n    =!*##$$$$$$$$##***#$$$@@@@$$*       \n    ;!!*##$$$$$$$$$$$$@@@@@@$$##!       \n     =!!**####$$$$$$$$$$$$$$$#*!=       \n      ;=!!****#####$$$$#####*!=!:       \n       ~;=!!*!!************!=!=~        \n         ~;;=!!!!!!!*!!!!!==;:          \n           ,-~:;;;==;;;;;:~-            ",
            "                                        \n                                        \n                                        \n          $@@@$$$#####$$$$              \n        $@@@$#**!=!!!**##$$@$           \n      #$@@$$#*!;;;;;;=*!*#$$@@$         \n     *$$@@$$#*=:~,..,-:==*#$@@@$        \n     #$$$@$$$#*;      .~;*#$@@@$#       \n    =*#$$$$@$$$#!      ~*#$@@@@$#!      \n    ;!##$$$$@@$$$$#####$$@@@@@$$#!      \n    ~=!###$$$$$@@@@@@@@@@@@@$$$#*=      \n     ==**####$$$$$$$@@@$$$$$$#**=;      \n      ;=!!****#####$$$######*!!=;       \n       :;=!!!!!!***********!!!=:        \n         ~;;=!!!!!**!!!!!!!=;;-         \n           ,~~:;;=====;;;::-.           ",
            "                                        \n                                        \n                                        \n            @@@@$$$$$$$@@@              \n         $@@$$##*!!!!!*#$$@@@#          \n       $@@@$$#*=;!===!!!!#$$@@@#        \n      $$@@@$#*=::~-,-~:=;!#$$@@$#       \n     *$$@@@$$#*;.     .~;!#$@@@@$*      \n     *#$$@@@@$$#!      ;*#$@@@@$$#      \n     !##$$$@@@@$$$$$#$$$$@@@@@$$#*;     \n     =!##$$$$@@@@@@@@@@@@@@@$$$#*!:     \n     ;!!**###$$$$$$$$$$$$$$$$##*!;      \n      ;=!!!**#####$$#######**!!==:      \n       :;=!!*!*!************!==;~       \n         ~:==!!!!!!!*!*!*!!==;~         \n           ,~~:;;;=====;;::~,           ",
            "                                        \n                                        \n                                        \n              @@@@$$$$@@@@              \n          @@@@$##******##$@@@$          \n        $@@@$#*!=!!!!!!=!*#$@@@$        \n      *$@@@$$#!;;:~--~:;;!#$$@@@$*      \n     !#$@@@$$#*:-      -:*#$@@@@$#=     \n     *#$@@@@@$$#*      *#$$@@@@@$#*     \n     !##$$@@@@@@$$$$$$$$@@@@@@$$##!     \n     =**#$$$@@@@@@@@@@@@@@@@$$$#**=     \n     ;!!**##$$$$$$$$$$$$$$$$##**!=;     \n      ;!!****##############***!!=;      \n       :;=!!!**!********!!*!!!=;:       \n         ~;===!!!!!!!!!!!!!==;~         \n           ,-::;;;;;;;;;;::~,           ",
            "                                        \n                                        \n                                        \n                @@@@@@@@@@@             \n           $@@@$$#******#$$@@@$         \n         $@@@$#*!!!*!!=;=*#$$@@@$       \n       #@@@@$#*=;;:~~~:::=*$$@@@@$      \n      #$@@@@$#*;~,     .;*#$@@@@@$#     \n      #$$@@@$$$#!     *#$$$@@@@$$$*=    \n     =*#$$@@@@@@$$$$$$@@@@@@@@$$$#*;    \n     ;!##$$$$@@@@@@@@@@@@@$$$$$##*=:    \n     :=!*###$$$$$$$$$$$$$$$###**!!;     \n      ;==!!**##############***!!!;      \n       ~;=!!*!*!***********!!!=;:       \n         ~;;=!!!!!!!!!!!!!==;;~         \n           ,~~::;;;;;;;;:::-,           ",
            "                                        \n                                        \n                                        \n                 $@@$$$$@@@@            \n             @@$$#***!!**#$$@@@$        \n          $@@@$#*!*!!!;:;!*#$@@@@$      \n        $@@@$$#!=!;:~-~~~!##$@@@@$#     \n       #$@@$$#*=-~.     *#$$@@@@$$#!    \n      *$$@@@@$#*;    *#$$$@@@@@$$##!    \n      *#$$@@@@@$$$$$$$@@@@@@$$$$##*=    \n      !*#$$$$$@@@@@@@@@$$$$$$$##*!=;    \n      ;!*###$$$$$$$$$$$$$#####*!!!;     \n      :=!!***###########*****!!!=;-     \n       :;!=!!!!!!********!!!!!=;~       \n         ~;==!!!!!!!!!!!!==;;:-         \n           ,~~::;;;;;;;:::~-            ",
            "                                        \n                                        \n                                        \n                  $$$$$$$$$@@@          \n              $$$#**!==!!*#$$@@@$       \n           $@@$$#*!!===~:!*#$@@@@$#     \n         #@@@$#*!!=:--,~:*#$$@@@@$$*    \n        $@@@$$*!::-.   !#$$$@@@@$$#*    \n       #$$@@$$#*~.  *##$$$@@@$$$$#*!    \n      =#$$$$$$$$$$$$$$$$$$$$$$$###*=    \n      =*##$$$$$$$$$$$$$$$$$$####*!=;    \n      :!!*###$$$$$$$$$$#####***!*!;     \n       ;=!!***#########*****!!!==;      \n       -;=!!!!!*!!!!***!**!!!=;:~       \n         ~:;==!!!!!!!!!!==;;:~-         \n           ,~~::;;;;;;:::~-,            ",
            "                                        \n                                        \n                                        \n                  $$######$$@@@$        \n               $$#*!=;;;=!##$@@@@$      \n            $@$$#*!==;:-:!#$$$@@@$$!    \n          #@@@$#*!;~,..,!#$$$@@@$$#*    \n         $@@@$#*=;~,  !*#$$$$$$$$$#*;   \n        #$$$$$#*:~ *##$$$$$$$$$$##*!;   \n       !#$$$$$$#$$$$$$$$$$$$$$###*!=    \n       !*#$$$$$$$$$$$$$$$$####***!=;    \n       ;!*################****!!!=;     \n       ;==!****#**********!*!!!=;:      \n        :=====!!!*!***!!!!!!=;;~,       \n         ~:;==!=!!!!!====;;::~,         \n           ,~~:::;:;::::~--.            ",
            "                                        \n                                        \n                       $$$$@@           \n                  ##**!!**#$$@@@$       \n               ###!!=:~:=*#$$@@@@$#     \n             $$#*!!=:~~-=*#$$@@@$$$*    \n           #@@$$*=;-.. !*#$$$$$$$$#*    \n          $@@@$#!!:, =*#$$$$$$$$$##*;   \n         #$$$$#*=-,*###$$$$$$$$##**!;   \n        *#$$$#######$$$$$$$#####*!!=    \n        *####################**!!!=:    \n        =!*##############****!!!!=:     \n        ;=!!************!!*!!!=;:-      \n        ~===!=!!!!!!!*!!!!!==;:~        \n         .:;=;==========;;;:~-          \n           .-~:::::::::~~-,             ",
            "                                        \n                                        \n                     #####$$@@@$        \n                  #*!=;=!*#$$@@@@$      \n               *#*=;;:-:!*#$$@@$$$#     \n             !$#*!=:-,,;*#$$$$$$$$#*    \n            #$$$#=:,. =*##$$$$$$$##*    \n           $@@@$*=;- !*##$$$$$$###*!    \n          #$@$$#*;~**###$$$$#####*!=    \n         *#$$#****###########****!!=    \n         *################****!!!!;-    \n         !******************!!!!=;-     \n         ==!!!*********!!!!!!==;~.      \n         :;==!!!!!!!!!!!!===;:~-        \n          ~;;==========;;;::~,          \n            -~:::::::::~~-,             ",
            "                                        \n                         $@@@           \n                    **!**#$$@@@@$       \n                 *!=:::=!##$$@@@$$      \n               !*==;:--=*#$$$$$$$$#     \n              #*!=:-..:!*##$$$$$$##!    \n             #$##;~..:!*##$$$$$###*!    \n           =$@@$#!;-=!*##########*!=    \n           $@@@$#!;!**########****!=    \n          *$$##!!!***######*****!!=:    \n          *##*********#*******!!!=:     \n          !!*************!*!!!!=;:      \n          ;=!!!!!!!!!!!!!!!!==;:~       \n          ;:;=====!=!=!====;;:~,        \n           :;;;=======;;;;::-.          \n            ,-~:::::::~~~-,             ",
            "                                        \n                      ##$$$@@@$         \n                   !===!##$$@@@$$       \n                 !;:-~;!*#$$$$$$$#      \n               !=;:~-,;!*##$$$$$$#*     \n              *!=:-. ~=*###$$$$###*=    \n             *#*=:,. =!*#########**=    \n            *$$$#*:-=!**########**!;    \n           !$@@@$#=!!***####****!!=:    \n           *$$#*!=!!**********!*!=;     \n           ***!!!!!********!**!!=;~     \n          ~!!!!!!!!!!!!!!!!!!!==;~      \n           ;==!!!!!!!!!!!!!===;:-       \n           :;=;====!!======;;:~.        \n            :;;;;;;;;;;;;;:~-,          \n             ,~~::::::~~--,             ",
            "                                        \n                    ***#$$$@@@$         \n                  =;;=!*#$$$$$$$#       \n                =::~-:=*##$$$$$$$#      \n               =;:-,,:!*###$$$$$##*     \n              !=:-.  ;!**########**     \n             !*=;-..:=!**#######**!     \n             #$$#=:,=!****####***!=     \n            *$@@@$*=!!**********!!=     \n            #$$$#;==!!*******!*!!=;     \n           :***====!!!!!!!!!!!!==;-     \n           ~=!=====!!!!!!!!!!===:~      \n           ~;;======!!!!!====;;:-       \n            ~;;;=========;;;;:~,        \n             ::;;;;;;;;;:::~~,          \n              ,~~~:~:~~~~--.            ",
            "                     $$$@@@@$           \n                   !!*##$$$@@$$         \n                 ;::;!**#$$$$$$$#       \n                ::~-:=!*###$$$$$#*      \n               ;:,.,~=!**########*=     \n              =:-.. :=!**#######**!     \n             ;!;~,..:=!****####**!=     \n             !##;;~~;=!!*********!=     \n             #$@@$#;==!!******!!!=;     \n            ;#$$$$:;=!!!!*!!*!!!!=:     \n            ;**!;;;===!!!!!!!!!==;      \n            ~===;;=====!!!!====;:~      \n            ~:;;;;;==========;;:-       \n             ~:;;;;;;;;;;;;;;:~,        \n              ~::::;;::::::~~-          \n               ,-~~~~~~~~--,            ",
            "                   ###$$@@@@$           \n                 !=!!*##$$$$$$$         \n                :::;=!*###$$$$$#*       \n               ::~~~;=**####$$$##!      \n              :~,..-;=!**########*      \n              :-.. ,:=!!**#####***=     \n             ::~,..,:=!!*********!=     \n             =*=;:~-;==!!*******!!;     \n             !#$$$$:;==!!!***!!!!=;     \n             !#$$$~:;==!!!!!!!!!==:     \n             =**!::;;====!!!!!===;      \n             :==;::;;;=========;;~      \n             ~:::::;;;;;====;;;:~       \n              ~::::::;;;;;;;::~-        \n               -~~:::::::::~~-.         \n                .,---~~~---,            ",
            "                  ###$$$$@@@$           \n                ==!!*##$$$$$$$#         \n               :~~;=!**###$$$$$#        \n              :~-~:;=!**########*       \n              ~..--:;=!**#######*!      \n             ~-.. .~:=!!*****#***!      \n             ~~,...-:==!!********!=     \n             :;::~--:;==!!!!**!!!!;     \n             ;*$$$$-:;===!!!!!!!!=;     \n             :*$@$$~:;;==!!!!!!!==:     \n             ~!**!-~:;;==========;      \n              :=;:~~::;;=======;;:      \n              ~~:~~:::;;;;;;;;;:~       \n               ~~~~~::::::::::~~        \n                ,-~~~~~~~~~~~-,         \n                  .,,------,.           ",
            "                **###$$$$$@$#           \n               ===!!*###$$$$$$*         \n              ~:::;=!**###$$$$##        \n             ~~-~:;;=!!**#######*       \n             ~..-,~;;=!!***#####*!      \n             -..  ,:;;!!!********!      \n             -,....~:;==!!******!!=     \n             ~~~~-,,~;;=!!!!!***!!=     \n             :=#$$$.~:;===!!!!!!!==     \n             ~=#$@$.-:;;====!!!===;     \n              :!**=,-~:;;;=======;:     \n              ~:=;~-~~::;;;;;;;;;:      \n               ~~~~-~~::::;;;;;::-      \n                -~~-~~~~::::::~~,       \n                 .,----~~~~~~--         \n                    .,,,,,,,.           ",
            "               ***##$$$$$$$$            \n              ===!!**##$$$$$$$          \n             ::;:;=!!**#####$##*        \n            ~~-~~;;;!!!**#######*       \n            ~..-,~:;==!!*****##**!      \n            -... .-:;==!!!!******!      \n            -......-~;==!!!!!****!=     \n             ---,,,,~:;;==!!!!!!!!=     \n             ~;=##$$-~:;;===!!!!!!=     \n             -=*$$$$,-~:;;========;     \n              :;**!:,-~::;;;=====;:     \n               ;:;:-,--~:::;;;;;;:~     \n                :~~-,--~~::::::::~      \n                 -------~~~~~~~~-       \n                   .,,,,------,         \n                       .....            ",
            "              **####$$$$$$$$            \n             ===!!**####$$$$$#          \n            ;;;;===!!**########*        \n           ~~~~::;==!!****######*       \n           ~,..,-~:;==!!!*********      \n           -...  ,-~:;=!!!********      \n            .......-~:;;=!!!*!!*!!!     \n            ,,....,.-~:;;==!!!!!!!=     \n             ~::;#$$.-~:;;=====!!!=     \n             -;!#$$$#,-~::;;======;     \n              ~==**!,.,-~::;;;;;;;;     \n               ~;;;:,.,-~~:::::::::     \n                .:~~-,,,--~~~~:~~~      \n                  ,-,,,,,--------       \n                     ....,,,,,,         \n                                        ",
            "             ***####$$$$$$$             \n            ===!!****####$$$$#          \n           ;;;;=;==!!**########         \n           :~~~:;;=!=!******####*       \n          ~,...,~~:;===!!*********      \n           ..,.. ,-~:;;==!!*!*****!     \n           ...   ..-~~:;===!!!!!!!!     \n           .......,=,-~::;===!!!!!==    \n            ,-~~:;#$$.-~::;;;======;    \n             -:=*$$$#=,-~~::;;;;==;;    \n              -==!*!;..,--~::::;;;;:    \n               .;;;:~...,--~~~:::::     \n                 -:~~,..,,---~~~~~-     \n                   .,,...,,,,---,       \n                          ....          \n                                        ",
            "            #######$$$$$$$$             \n           !!!=!!!*#*###$$$$$#          \n          :;======!!!****#######        \n          :~:::;;;==!!!!*****####       \n          -,,,,-~~:;;=!!!***!*****      \n          ..,....,-~::;===!!!!!!**!     \n          ..     ..,-~::;===!!!!!!!=    \n           .......-!.,-~::;;=====!==    \n            ,,--~;#$$#.,-~::;;;=====    \n             -:=!#$$#!..,-~~:::;;;;;    \n              -;!=!!=~. .,--~~::::::    \n                ~=;;:-....,---~~~~~     \n                  -~~-,....,,-----      \n                     ............       \n                                        \n                                        ",
            "            #######$$$$$$$$             \n          !!!!!!!****#####$$$$          \n         ;=====!!!=!!****#######        \n         ;:::::;;;==!!!!!*****###*      \n         ~--,--~~~:;;;==!!********!     \n         ,.,,,...,--~:;;;==!!!!!!!!!    \n         ..     ..-.,-~~::;===!!!!!=    \n          ........=! .,-~~::;;======    \n           ...,,~;#$$$!.,-~~::;;;;;;    \n            .-::=#$$#*-..,,-~~:::::;    \n              -;!!!!=;,.  .,--~~~~:~    \n                ~;=;:~-.. ..,,-----     \n                  .-~~-.......,,,,      \n                                        \n                                        \n                                        ",
            "           ########$$$$$$$$$            \n         **!!!!!******#####$$$          \n        =;=!=====!!!!!!****#####        \n        :;;;:::;;===!!!!!*!!******      \n        ~~------~~::;;===!!!!!!!***     \n        -,..,,...,,-~~::;;===!!!!!!!    \n        ,..    ...  ,,--~::;;;===!!=    \n         .    ....==  .,,-~~:;;;;===;   \n           .....-!#$@$*..,,-~~~:::;;;   \n            ,--:;*#$#*:.:-.,,--~~:::    \n             .~;!!!!!;~..  .,,---~~~    \n                ~;==;;~,..  ..,,,,,     \n                   ,---,..    ...       \n                                        \n                                        \n                                        ",
            "           #######$$$$$$$$$$            \n         ***!**!******######$$#         \n        ===!!!=!!!!!!*!!****#####       \n       ;;;;;;;;;;====!!!!!!*!*****      \n       ::~~~~~~~~~:::;;;==!!!!!!!!!     \n       ~-,.......,,,-~~::;;;====!!!!    \n       ,.... ....    .,--~~::;;;====    \n        ..     ..:!     .,--~~::;;;;;   \n           .....-!#$@#*....,--~~:::::   \n           ..,-~;!#$#*;,.,...,,--~~~    \n             ,~:;!!!!=:,..  ...,,--,    \n               ,~;===;:-...  .....      \n                   .,-,,...             \n                                        \n                                        \n                                        ",
            "           $#######$$$$$$$$$            \n         ******!!*******#######         \n        !!=!!!!!!!!!***!!******##       \n       ====;;;;;;;;====!!!!!!*!***      \n      ;;:::~~~~~~~~::::;;===!!!!!!!     \n      :~--,,,.....,,,--~~::;;;====!=    \n      --,........     .,,--~:::;;;==    \n       ,.     ...;      ...,-~~~:::;    \n        .  .....-!#$@#!-.,-..,,-~~~:    \n           ...,~;!#$$*=~..   ..,----    \n            .,-:;!!!!=;~...   ..,,,     \n               -:;=!!=;~-...            \n                   .,,,,..              \n                                        \n                                        \n                                        ",
            "           $$$########$$$$$$$           \n         *****************#####         \n       !!!!=!!!!!!!!**!!***!****#       \n      ==!====;;;;;;;;====!!!!!!!!!!     \n      ;;;:::~~~~~~~~~~:::;;;====!!!     \n      :~~--,,,......,,---~~::;;;====    \n      ~-,........       .,,--~~::;;;    \n      -,..    ...;      ....,,--~~::    \n       ...  ....-!#$$#!~.~,. .,,--~~    \n          ....,-;!#$$*=:...   .,,,-     \n           .,,-:=!!!!!;:-.... ....      \n              ,~:;=!!=;:-,...           \n                   .,,,..               \n                                        \n                                        \n                                        ",
            "           $$$#########$$$$$$           \n         ##*****!***********####        \n       *!!!!!!!!!!!!!!!!!!!!!****       \n      ===!====;;;;;;;;;====!!!!!!!      \n     ;==;;::::~~~~~~~~~::::;;;==!==     \n     ;;::~--,,,.......,,--~~~::;;;=;    \n     :~~-,,.....          .,,-~~::;;    \n     --,,..  ...,       .....,,--~~:    \n      ,,...  ...:!#$$#!~...  ..,,--     \n       ........-;!#$$#!;........,,      \n          ..,,-:=!*!*!=;~,.......       \n            .,,~:;=!!=;:~-,..           \n                 .,,,,,..               \n                                        \n                                        \n                                        "
        ];
        let currentDonutFrame = 0;
        let donutInterval = null;

        function startDonut() {
            if (reducedMotion.matches || document.hidden || donutInterval) return;
            donutInterval = setInterval(() => {
                currentDonutFrame = (currentDonutFrame + 1) % donutFrames.length;
                donutElement.textContent = donutFrames[currentDonutFrame];
            }, 75);
        }

        function stopDonut() {
            if (donutInterval) {
                clearInterval(donutInterval);
                donutInterval = null;
            }
        }

        startDonut();
        reducedMotion.addEventListener('change', () => {
            if (reducedMotion.matches) stopDonut();
            else startDonut();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopDonut();
            else startDonut();
        });
    }

    function updateClock() {
        const now = new Date();
        const clock = document.getElementById('system-clock');
        clock.textContent = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
        clock.dateTime = now.toISOString();
        clock.title = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(now);
        clock.setAttribute('aria-label', clock.textContent + ', your local time');
    }
    updateClock();
    setInterval(updateClock, 30000);
    syncWindows();
    document.documentElement.classList.add('os-ready');
    focusWindow('terminal');
    routeHash();
    let entranceDelay = 0;
    windows.forEach(state => {
        if (state.open && !state.minimized && !motions.has(state.element)) {
            animateWindowIn(state, null, entranceDelay);
            entranceDelay += 70;
        }
    });
})();
