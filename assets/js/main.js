/* The desktop enhances static HTML. Commands never execute code or shell input. */
(() => {
    'use strict';

    const desktop = document.getElementById('desktop');
    const desktopShortcuts = document.querySelector('.desktop-shortcuts');
    const terminalInput = document.getElementById('terminal-input');
    const terminalScreen = document.getElementById('terminal-screen');
    const terminalOutput = document.getElementById('terminal-output');
    const terminalWelcome = document.getElementById('terminal-welcome');
    const taskbar = document.getElementById('taskbar-tasks');
    const startButton = document.getElementById('start-button');
    const startMenu = document.getElementById('start-menu');
    const announcement = document.getElementById('os-announcement');
    const sessionStartedAt = new Date();
    const mobile = window.matchMedia('(max-width: 760px)');
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
    let desktopIcons;
    let spinDonut = null;

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
            state.task.hidden = !state.open && id !== 'terminal';
            state.task.setAttribute('aria-pressed', String(visible && activeWindow === id));
            state.task.setAttribute('aria-label', (visible && activeWindow === id ? 'Minimize ' : state.open ? 'Restore ' : 'Open ') + state.title);
            if (id === 'terminal') state.task.title = 'Terminal (pinned)';
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

    function updateMobileWindowLayout() {
        if (!mobile.matches) return;
        // Keep absolute positioning for touch dragging and resizing while clearing every icon label.
        desktop.style.setProperty('--mobile-window-top', (desktopShortcuts.offsetTop + desktopShortcuts.offsetHeight + 12) + 'px');
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
                dx: 0, dy: 0, frame: 0
            };
            bar.setPointerCapture(event.pointerId);
        });
        bar.addEventListener('pointermove', event => {
            const drag = activeDrag;
            if (!drag || event.pointerId !== drag.pointerId) return;
            drag.dx = event.clientX - drag.startX;
            drag.dy = event.clientY - drag.startY;
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
        if (event.target.closest('[data-assistant-toggle]')) {
            closeStart();
            return;
        }
        const link = event.target.closest('[data-open]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        closeStart();
        openWindow(link.dataset.open);
    });

    const workItems = [...document.querySelectorAll('#work .work-item')];
    document.querySelectorAll('[data-work-topic]').forEach(link => {
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            const topic = document.getElementById(link.dataset.workTopic);
            topic.open = true;
            topic.querySelector('summary').focus({ preventScroll: true });
            topic.scrollIntoView({ block: 'nearest' });
            updateLocation(topic.id);
        });
    });
    document.getElementById('work-expand-all').addEventListener('click', () => {
        workItems.forEach(item => { item.open = true; });
        announce('All contributions expanded.');
    });
    document.getElementById('work-collapse-all').addEventListener('click', () => {
        workItems.forEach(item => { item.open = false; });
        announce('All contributions collapsed.');
    });

    const toolkitCollections = [...document.querySelectorAll('.toolkit-collection')];
    const collectionLinks = [...document.querySelectorAll('[data-collection]')];
    const toolkitVisualization = document.getElementById('toolkit-visualization');
    const visualizationButton = document.getElementById('player-visuals');
    let toolkitIndex = 0;
    let visualizationPlaying = false;

    function selectToolkitCollection(index, notify = true) {
        toolkitIndex = (index + toolkitCollections.length) % toolkitCollections.length;
        const selected = toolkitCollections[toolkitIndex];
        toolkitCollections.forEach(collection => { collection.hidden = collection !== selected; });
        collectionLinks.forEach(link => {
            if (link.dataset.collection === selected.id) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
        });
        document.getElementById('player-collection-title').textContent = selected.dataset.title;
        document.getElementById('player-track-label').textContent = selected.dataset.title;
        document.getElementById('player-position').textContent = 'Collection ' + String(toolkitIndex + 1).padStart(2, '0') + ' / 04';
        document.getElementById('toolkit-playlists').scrollTop = 0;
        document.querySelector('.media-player').scrollTop = 0;
        if (notify) announce(selected.dataset.title + ', collection ' + (toolkitIndex + 1) + ' of ' + toolkitCollections.length + '.');
    }
    collectionLinks.forEach(link => {
        link.addEventListener('click', event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            selectToolkitCollection(toolkitCollections.findIndex(collection => collection.id === link.dataset.collection));
            updateLocation(link.dataset.collection);
        });
    });
    document.getElementById('player-previous').addEventListener('click', () => selectToolkitCollection(toolkitIndex - 1));
    document.getElementById('player-next').addEventListener('click', () => selectToolkitCollection(toolkitIndex + 1));

    function syncVisualization() {
        const playing = visualizationPlaying && !reducedMotion.matches;
        toolkitVisualization.dataset.motion = playing ? 'playing' : 'paused';
        visualizationButton.disabled = reducedMotion.matches;
        visualizationButton.setAttribute('aria-pressed', String(playing));
        visualizationButton.setAttribute('aria-label', playing ? 'Pause visualization' : 'Play visualization');
        visualizationButton.title = reducedMotion.matches ? 'Reduced motion enabled' : visualizationButton.getAttribute('aria-label');
        visualizationButton.querySelector('use').setAttribute('href', playing ? '#icon-pause' : '#icon-play');
        document.getElementById('player-visuals-status').textContent = reducedMotion.matches ? 'Reduced motion' : playing ? 'Visuals playing' : 'Visuals paused';
    }
    visualizationButton.addEventListener('click', () => { visualizationPlaying = !visualizationPlaying; syncVisualization(); });
    reducedMotion.addEventListener('change', syncVisualization);
    selectToolkitCollection(0, false);
    syncVisualization();

    function showDesktop() {
        finishDrag();
        finishResize();
        desktopIcons?.cancel();
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
        const arrow = makeIcon('arrow-up-right');
        arrow.classList.add('ui-glyph');
        link.append(' ', arrow);
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
        ['spin', 'High-speed momentum spin on the ASCII donut'],
        ['donut', 'Toggle rainbow mode on the 3D ASCII donut'],
        ['theme', 'Switch chrome / midnight wallpaper'],
        ['clear', 'A fresh terminal'],
        ['home', 'Bring back the welcome screen']
    ];
    const commandNames = ['help', 'about', 'work', 'projects', 'skills', 'archive', 'resume', 'contact', 'whoami', 'spin', 'donut', 'theme', 'clear', 'cls', 'home', 'ls', 'dir', 'pwd', 'open', 'cat', 'type', 'more', 'cd', 'readme', 'resume.doc', 'readme.txt', 'github', 'linkedin', 'date', 'history', 'echo'];
    const aliases = {
        projects: 'work',
        cls: 'clear',
        dir: 'ls',
        type: 'cat',
        more: 'cat',
        torus: 'spin',
        rainbow: 'donut',
        'resume.doc': 'resume',
        'resume.docx': 'resume',
        'resume.pdf': 'resume',
        'readme.txt': 'readme',
        'readme.md': 'readme',
        './resume.doc': 'resume',
        './readme.txt': 'readme'
    };
    const openNames = ['terminal', 'about', 'work', 'skills', 'archive', 'resume', 'contact', 'readme', 'resume.doc', 'readme.txt'];

    function resolveFileOrWindow(raw) {
        if (!raw) return null;
        const clean = raw.trim().replace(/^(\.\/|\\)/, '').replace(/\/+$/, '').toLowerCase();
        if (windows.has(clean)) return clean;
        const map = {
            'resume.doc': 'resume',
            'resume.docx': 'resume',
            'resume.pdf': 'resume',
            'readme.txt': 'readme',
            'readme.md': 'readme',
            projects: 'work',
            toolkit: 'skills'
        };
        return map[clean] || null;
    }

    function scrollTerminal() {
        terminalScreen.scrollTop = terminalScreen.scrollHeight;
        const scrollToLatest = () => {
            terminalScreen.scrollTop = terminalScreen.scrollHeight;
            const last = terminalOutput.lastElementChild;
            if (last) {
                last.scrollIntoView({ block: 'end', behavior: 'auto' });
            }
        };
        requestAnimationFrame(scrollToLatest);
        setTimeout(scrollToLatest, 40);
    }

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
        const cleanName = name.toLowerCase().replace(/^(\.\/|\\)/, '').replace(/\/+$/, '');
        const command = aliases[name.toLowerCase()] || aliases[cleanName] || (windows.has(cleanName) ? cleanName : name.toLowerCase());
        const argument = args.join(' ');

        if (command === 'clear' || command === 'home') {
            terminalOutput.replaceChildren();
            terminalWelcome.hidden = false;
            openWindow('terminal', { updateHash: false });
            terminalScreen.scrollTop = 0;
            announce(command === 'clear' ? 'Terminal cleared and reset to home.' : 'Welcome screen restored.');
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
                extra.textContent = '\nAlso: ls, cat <file>, cd <dir>, open <window>, whoami, date, theme, history.\nTab completes a command. ↑ / ↓ revisit your history.';
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
            case 'readme': {
                const winId = command === 'readme' ? 'readme' : command;
                result.textContent = 'Opening ' + windows.get(winId).title + '...';
                openWindow(winId);
                break;
            }
            case 'open': {
                const target = resolveFileOrWindow(argument);
                if (target && windows.has(target)) {
                    result.textContent = 'Opening ' + windows.get(target).title + '...';
                    openWindow(target);
                } else {
                    result.textContent = 'Usage: open <file or window>\nAvailable: resume.doc, readme.txt, work/, about/, skills/, archive/, contact/';
                }
                break;
            }
            case 'cat': {
                const file = (argument || '').trim().replace(/^(\.\/|\\)/, '').toLowerCase();
                if (!file) {
                    result.textContent = 'Usage: cat <file>\nAvailable files: resume.doc, readme.txt\nDirectories: about/, work/, skills/, archive/, contact/';
                    break;
                }
                if (file === 'readme.txt' || file === 'readme.md' || file === 'readme') {
                    result.textContent = 'C:\\Bryant\\readme.txt\n' +
                        '--------------------\n' +
                        'Bryant Villarreal\n' +
                        'Software Engineer II @ UKG\n\n' +
                        'I build the systems behind secure access.\n' +
                        'Backend engineering, identity & a healthy curiosity for how things work.\n\n' +
                        'Curious about systems. Serious about the details.\n' +
                        'Type "open resume" or "open work" to explore.';
                    break;
                }
                if (file === 'resume.doc' || file === 'resume.docx' || file === 'resume.pdf' || file === 'resume') {
                    result.textContent = 'C:\\Bryant\\resume.doc\n' +
                        '--------------------\n' +
                        'Bryant Villarreal\n' +
                        'Software Engineer II @ UKG | Identity & Access Management\n' +
                        'M.S. Computer Science, Florida International University\n\n' +
                        '• Core: Backend Architecture, Auth Services, Distributed Systems\n' +
                        '• Stack: Go, Java, TypeScript, Node.js, Kafka, Docker, Kubernetes\n' +
                        '• Experience: UKG (2022–Present), FIU Research & Teaching\n\n' +
                        'Opening full Word document...';
                    openWindow('resume');
                    break;
                }
                const dir = resolveFileOrWindow(file);
                if (dir && dir !== 'resume' && dir !== 'readme') {
                    result.textContent = 'cat: ' + argument + ': Is a directory.\nUse: open ' + argument + '  or  cd ' + argument;
                    break;
                }
                result.textContent = 'cat: ' + argument + ': No such file or directory';
                break;
            }
            case 'cd': {
                const dir = (argument || '').trim().replace(/^(\.\/|\\)/, '').replace(/\/+$/, '').toLowerCase();
                if (!dir || dir === '~' || dir === '/' || dir === '..' || dir === '.') {
                    result.textContent = 'C:\\Bryant\\\nYou are in the root portfolio directory.';
                } else if (['about', 'work', 'projects', 'skills', 'archive', 'contact'].includes(dir)) {
                    const target = dir === 'projects' ? 'work' : dir;
                    result.textContent = 'Opening ' + windows.get(target).title + '...';
                    openWindow(target);
                } else if (['resume.doc', 'resume.pdf', 'resume', 'readme.txt', 'readme'].includes(dir)) {
                    result.textContent = 'cd: ' + argument + ': Not a directory. Try: cat ' + argument + ' or open ' + argument;
                } else {
                    result.textContent = 'cd: ' + argument + ': No such file or directory';
                }
                break;
            }
            case 'github':
                appendLink(result, 'github.com/bryantvilla', 'https://github.com/bryantvilla');
                break;
            case 'linkedin':
                appendLink(result, 'Bryant Villarreal on LinkedIn', 'https://www.linkedin.com/in/bryant-villarreal/');
                break;
            case 'ls': {
                result.textContent = 'C:\\Bryant\\\n';
                const fileItems = [
                    { name: 'about/', command: 'about' },
                    { name: 'work/', command: 'work' },
                    { name: 'skills/', command: 'skills' },
                    { name: 'archive/', command: 'archive' },
                    { name: 'contact/', command: 'contact' },
                    { name: 'resume.doc', command: 'resume' },
                    { name: 'readme.txt', command: 'readme' }
                ];
                for (const item of fileItems) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.dataset.command = item.command;
                    button.textContent = item.name;
                    result.append(button, document.createTextNode('  '));
                }
                break;
            }
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
            case 'donut': {
                terminalWelcome.hidden = false;
                const donut = document.getElementById('terminal-donut');
                if (donut) {
                    const isRainbow = donut.classList.toggle('is-rainbow');
                    try {
                        localStorage.setItem('bryantos-donut-rainbow', isRainbow ? 'true' : 'false');
                    } catch {}
                    if (isRainbow) {
                        result.textContent = '🌈 Prismatic rainbow mode enabled!\nYour 3D ASCII donut is now glowing in full spectrum.\nType donut again to toggle off.';
                    } else {
                        result.textContent = '🍩 Rainbow mode disabled. Restored classic terminal phosphor.\nType donut to turn rainbow mode back on.';
                    }
                } else {
                    result.textContent = 'Donut element not found.';
                }
                break;
            }
            case 'spin': {
                terminalWelcome.hidden = false;
                const arg = (argument || '').trim().toLowerCase();
                let dirX, dirY, speed = 6.5;
                if (arg.includes('left') || arg.includes('west')) { dirX = -1; dirY = 0; }
                else if (arg.includes('right') || arg.includes('east')) { dirX = 1; dirY = 0; }
                else if (arg.includes('up') || arg.includes('north')) { dirX = 0; dirY = -1; }
                else if (arg.includes('down') || arg.includes('south')) { dirX = 0; dirY = 1; }
                if (arg.includes('hyper') || arg.includes('fast') || arg.includes('turbo') || arg.includes('max')) {
                    speed = 9.5;
                }

                if (typeof spinDonut === 'function') {
                    spinDonut({ dirX, dirY, speed });
                }

                const phrases = [
                    '🍩 Whoosh! Spinning the 3D ASCII donut with high-speed momentum.',
                    '🍩 Turbo spin activated! The torus is orbiting at high speed.',
                    '🍩 Flinging the donut into a high-speed momentum spin! Click & drag to steer.'
                ];
                const phrase = phrases[Math.floor(Math.random() * phrases.length)];
                result.textContent = phrase + '\nTip: Click and drag the donut in the terminal to steer its spin!';
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
                : current.startsWith('cat ') ? ['cat resume.doc', 'cat readme.txt']
                : current.startsWith('type ') ? ['type resume.doc', 'type readme.txt']
                : current.startsWith('more ') ? ['more resume.doc', 'more readme.txt']
                : current.startsWith('cd ') ? ['cd about/', 'cd work/', 'cd skills/', 'cd archive/', 'cd contact/']
                : current.startsWith('donut ') ? ['donut fast', 'donut left', 'donut right', 'donut up', 'donut down']
                : current.startsWith('spin ') ? ['spin fast', 'spin left', 'spin right', 'spin up', 'spin down']
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
        desktopIcons.reset();
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
        else if (toolkitCollections.some(collection => collection.id === id)) {
            selectToolkitCollection(toolkitCollections.findIndex(collection => collection.id === id), false);
            openWindow('skills', { focus: false, updateHash: false });
        }
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
            desktopIcons.refresh();
            updateMobileWindowLayout();
            windows.forEach(constrainWindow);
        });
    });
    window.addEventListener('blur', () => { finishDrag(); finishResize(); desktopIcons?.cancel(); });

    const donutElement = document.getElementById('terminal-donut');
    if (donutElement) {
        const chars = ".,-~:;=!*#$@";
        const width = 40, height = 16;
        const b = new Array(width * height);
        const z = new Float32Array(width * height);
        const R1 = 1, R2 = 2, K2 = 5;
        const scaleX = 26, scaleY = 13;
        const lx = 0, ly = 0.70710678, lz = -0.70710678;

        const M = new Float32Array([
            0.92, 0, 0.39,
            0.23, 0.81, -0.54,
            -0.32, 0.59, 0.74
        ]);

        function multM(R) {
            const C0 = R[0]*M[0] + R[1]*M[3] + R[2]*M[6];
            const C1 = R[0]*M[1] + R[1]*M[4] + R[2]*M[7];
            const C2 = R[0]*M[2] + R[1]*M[5] + R[2]*M[8];
            const C3 = R[3]*M[0] + R[4]*M[3] + R[5]*M[6];
            const C4 = R[3]*M[1] + R[4]*M[4] + R[5]*M[7];
            const C5 = R[3]*M[2] + R[4]*M[5] + R[5]*M[8];
            const C6 = R[6]*M[0] + R[7]*M[3] + R[8]*M[6];
            const C7 = R[6]*M[1] + R[7]*M[4] + R[8]*M[7];
            const C8 = R[6]*M[2] + R[7]*M[5] + R[8]*M[8];
            M[0]=C0; M[1]=C1; M[2]=C2;
            M[3]=C3; M[4]=C4; M[5]=C5;
            M[6]=C6; M[7]=C7; M[8]=C8;
        }

        function orthonormalize() {
            let x0 = M[0], x1 = M[3], x2 = M[6];
            const lenX = Math.hypot(x0, x1, x2) || 1;
            x0 /= lenX; x1 /= lenX; x2 /= lenX;

            let y0 = M[1], y1 = M[4], y2 = M[7];
            const dot = x0 * y0 + x1 * y1 + x2 * y2;
            y0 -= dot * x0; y1 -= dot * x1; y2 -= dot * x2;
            const lenY = Math.hypot(y0, y1, y2) || 1;
            y0 /= lenY; y1 /= lenY; y2 /= lenY;

            const z0 = x1 * y2 - x2 * y1;
            const z1 = x2 * y0 - x0 * y2;
            const z2 = x0 * y1 - x1 * y0;

            M[0]=x0; M[1]=y0; M[2]=z0;
            M[3]=x1; M[4]=y1; M[5]=z1;
            M[6]=x2; M[7]=y2; M[8]=z2;
        }

        function rotateByDelta(dx, dy, sens = 0.012) {
            const dist = Math.hypot(dx, dy);
            if (dist < 1e-4) return;
            const angle = dist * sens;
            const c = Math.cos(angle), s = Math.sin(angle), v = 1 - c;
            const ux = -dy / dist;
            const uy = dx / dist;
            const R = [
                c + ux * ux * v, ux * uy * v, uy * s,
                uy * ux * v, c + uy * uy * v, -ux * s,
                -uy * s, ux * s, c
            ];
            multM(R);
            orthonormalize();
        }

        function renderDonut() {
            b.fill(' ');
            z.fill(0);

            const m00 = M[0], m01 = M[1], m02 = M[2];
            const m10 = M[3], m11 = M[4], m12 = M[5];
            const m20 = M[6], m21 = M[7], m22 = M[8];

            for (let theta = 0; theta < 6.28; theta += 0.08) {
                const costheta = Math.cos(theta), sintheta = Math.sin(theta);
                for (let phi = 0; phi < 6.28; phi += 0.03) {
                    const cosphi = Math.cos(phi), sinphi = Math.sin(phi);

                    const c = R2 + R1 * costheta;
                    const px = c * cosphi, py = c * sinphi, pz = R1 * sintheta;

                    const x = m00 * px + m01 * py + m02 * pz;
                    const y = m10 * px + m11 * py + m12 * pz;
                    const zVal = K2 + m20 * px + m21 * py + m22 * pz;
                    const ooz = 1 / zVal;

                    const xp = (width / 2 + scaleX * ooz * x) | 0;
                    const yp = (height / 2 - scaleY * ooz * y) | 0;

                    const nx = costheta * cosphi, ny = costheta * sinphi, nz = sintheta;
                    const rnx = m00 * nx + m01 * ny + m02 * nz;
                    const rny = m10 * nx + m11 * ny + m12 * nz;
                    const rnz = m20 * nx + m21 * ny + m22 * nz;

                    const L = rnx * lx + rny * ly + rnz * lz;
                    if (L > 0) {
                        if (yp >= 0 && yp < height && xp >= 0 && xp < width) {
                            const idx = xp + yp * width;
                            if (ooz > z[idx]) {
                                z[idx] = ooz;
                                const luminanceIndex = (L * 11.9) | 0;
                                b[idx] = chars[luminanceIndex < 12 ? luminanceIndex : 11];
                            }
                        }
                    }
                }
            }
            let res = '';
            for (let i = 0; i < height; i++) {
                res += b.slice(i * width, (i + 1) * width).join('') + '\n';
            }
            donutElement.textContent = res;
        }

        let donutInterval = null;
        let momentumRaf = null;
        let idleDx = 1.6;
        let idleDy = 0.6;

        function stopDonut() {
            if (donutInterval) {
                clearInterval(donutInterval);
                donutInterval = null;
            }
            if (momentumRaf) {
                cancelAnimationFrame(momentumRaf);
                momentumRaf = null;
            }
        }

        function startDonut() {
            if (reducedMotion.matches || document.hidden || donutInterval || momentumRaf) return;
            donutInterval = setInterval(() => {
                rotateByDelta(idleDx, idleDy);
                renderDonut();
            }, 75);
        }

        function triggerTurboSpin({ dirX, dirY, speed = 6.5 } = {}) {
            stopDonut();
            if (dirX === undefined || dirY === undefined) {
                const angle = Math.random() * Math.PI * 2;
                dirX = Math.cos(angle);
                dirY = Math.sin(angle);
            }
            const len = Math.hypot(dirX, dirY) || 1;
            dirX /= len;
            dirY /= len;

            if (reducedMotion.matches) {
                rotateByDelta(dirX * 6, dirY * 6);
                renderDonut();
                return;
            }

            let currSpeed = Math.max(2.0, speed);
            const targetSpeed = 0.35;
            let lastRafTime = performance.now();

            function stepTurbo(time) {
                const elapsed = Math.min(time - lastRafTime, 64);
                lastRafTime = time;

                const factor = elapsed / 16.67;
                rotateByDelta(dirX * currSpeed * factor * 14, dirY * currSpeed * factor * 14);
                renderDonut();

                currSpeed = currSpeed * 0.965 + targetSpeed * 0.035;

                if (Math.abs(currSpeed - targetSpeed) < 0.02) {
                    momentumRaf = null;
                    idleDx = dirX * 1.8;
                    idleDy = dirY * 1.8;
                    startDonut();
                } else {
                    momentumRaf = requestAnimationFrame(stepTurbo);
                }
            }

            momentumRaf = requestAnimationFrame(stepTurbo);
        }

        spinDonut = triggerTurboSpin;

        let isDragging = false;
        let activePointerId = null;
        let lastX = 0;
        let lastY = 0;
        let lastTime = 0;
        let vx = 0;
        let vy = 0;

        function onPointerDown(event) {
            if (event.button !== 0 || (event.isPrimary !== undefined && !event.isPrimary)) return;
            stopDonut();
            isDragging = true;
            activePointerId = event.pointerId;
            lastX = event.clientX;
            lastY = event.clientY;
            lastTime = performance.now();
            vx = 0;
            vy = 0;
            donutElement.classList.add('is-dragging');
            if (donutElement.setPointerCapture) {
                try { donutElement.setPointerCapture(event.pointerId); } catch {}
            }
            event.preventDefault();
        }

        function onPointerMove(event) {
            if (!isDragging || (activePointerId !== null && event.pointerId !== activePointerId)) return;
            const now = performance.now();
            const dx = event.clientX - lastX;
            const dy = event.clientY - lastY;
            const dt = now - lastTime;
            if (dt > 0) {
                const instVx = dx / dt;
                const instVy = dy / dt;
                vx = vx === 0 ? instVx : (vx * 0.3 + instVx * 0.7);
                vy = vy === 0 ? instVy : (vy * 0.3 + instVy * 0.7);
            }
            lastX = event.clientX;
            lastY = event.clientY;
            lastTime = now;

            if (dx !== 0 || dy !== 0) {
                rotateByDelta(dx, dy);
                renderDonut();
            }
        }

        function onPointerUp(event) {
            if (!isDragging || (activePointerId !== null && event.pointerId !== undefined && event.pointerId !== activePointerId)) return;
            if (activePointerId !== null && donutElement.releasePointerCapture) {
                try { donutElement.releasePointerCapture(activePointerId); } catch {}
            }
            isDragging = false;
            activePointerId = null;
            donutElement.classList.remove('is-dragging');

            const now = performance.now();
            if (now - lastTime > 80) {
                vx = 0;
                vy = 0;
            }

            if (reducedMotion.matches) return;

            const speed = Math.hypot(vx, vy);
            const FLICK_THRESHOLD = 0.15;

            if (speed > FLICK_THRESHOLD) {
                const dirX = vx / speed;
                const dirY = vy / speed;
                let currSpeed = Math.min(speed, 2.5);
                const targetSpeed = 0.35;
                let lastRafTime = performance.now();

                function stepMomentum(time) {
                    const elapsed = Math.min(time - lastRafTime, 64);
                    lastRafTime = time;

                    const factor = elapsed / 16.67;
                    rotateByDelta(dirX * currSpeed * factor * 14, dirY * currSpeed * factor * 14);
                    renderDonut();

                    currSpeed = currSpeed * 0.96 + targetSpeed * 0.04;

                    if (Math.abs(currSpeed - targetSpeed) < 0.02) {
                        momentumRaf = null;
                        idleDx = dirX * 1.8;
                        idleDy = dirY * 1.8;
                        startDonut();
                    } else {
                        momentumRaf = requestAnimationFrame(stepMomentum);
                    }
                }

                momentumRaf = requestAnimationFrame(stepMomentum);
            } else {
                if (speed > 0.03) {
                    idleDx = (vx / speed) * 1.8;
                    idleDy = (vy / speed) * 1.8;
                }
                startDonut();
            }
        }

        donutElement.addEventListener('pointerdown', onPointerDown);
        donutElement.addEventListener('pointermove', onPointerMove);
        donutElement.addEventListener('pointerup', onPointerUp);
        donutElement.addEventListener('pointercancel', onPointerUp);
        donutElement.addEventListener('lostpointercapture', onPointerUp);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('blur', () => {
            if (isDragging) onPointerUp({ pointerId: activePointerId });
        });

        try {
            if (localStorage.getItem('bryantos-donut-rainbow') === 'true') {
                donutElement.classList.add('is-rainbow');
            }
        } catch {}

        renderDonut();
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
    const lastLogin = document.getElementById('last-login');
    lastLogin.dateTime = sessionStartedAt.toISOString();
    lastLogin.textContent = sessionStartedAt.toDateString() + ' ' + sessionStartedAt.toTimeString().slice(0, 8);
    lastLogin.closest('.boot-line').hidden = false;
    updateClock();
    setInterval(updateClock, 30000);
    syncWindows();
    document.documentElement.classList.add('os-ready');
    desktopIcons = window.BryantDesktopIcons.init({
        desktop, shortcuts: desktopShortcuts, announce,
        openIcon(icon) {
            if (icon.dataset.open) openWindow(icon.dataset.open);
            else window.BryantNavigation.confirm(icon);
        }
    });
    updateMobileWindowLayout();
    new ResizeObserver(updateMobileWindowLayout).observe(desktopShortcuts);
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
