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
    const mobile = window.matchMedia('(max-width: 760px)');
    const windows = new Map();
    const commandHistory = [];
    let historyIndex = 0;
    let historyDraft = '';
    let zIndex = 10;
    let activeWindow = 'terminal';
    let desktopSnapshot = null;
    let activeDrag = null;

    function makeIcon(name) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        svg.setAttribute('aria-hidden', 'true');
        use.setAttribute('href', '#icon-' + name);
        svg.append(use);
        return svg;
    }

    function announce(message) { announcement.textContent = message; }

    function syncWindows() {
        windows.forEach((state, id) => {
            const visible = state.open && !state.minimized;
            state.element.hidden = !visible;
            state.element.classList.toggle('is-active', visible && activeWindow === id);
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
        if (mobile.matches) {
            for (const property of ['left', 'top', 'right']) state.element.style.removeProperty(property);
        } else if (state.element.style.left && !state.element.hidden && !state.element.classList.contains('is-maximized')) {
            const bounds = state.element.getBoundingClientRect();
            state.element.style.left = Math.max(0, Math.min(bounds.left, desktop.clientWidth - bounds.width)) + 'px';
            state.element.style.top = Math.max(0, Math.min(bounds.top, desktop.clientHeight - bounds.height)) + 'px';
        }
    }

    function openWindow(id, { focus = true, updateHash = true } = {}) {
        const state = windows.get(id);
        if (!state) return false;
        if (!state.open || state.minimized) state.returnFocus = document.activeElement;
        state.open = true;
        state.minimized = false;
        desktopSnapshot = null;
        state.element.hidden = false;
        constrainWindow(state);
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
        if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length && !previous.closest('[hidden]')) {
            previous.focus({ preventScroll: true });
        } else if (activeWindow) {
            windows.get(activeWindow).task.focus({ preventScroll: true });
        } else {
            startButton.focus({ preventScroll: true });
        }
    }

    function hideWindow(id, close = false) {
        const state = windows.get(id);
        if (!state) return;
        state.minimized = !close;
        if (close) state.open = false;
        desktopSnapshot = null;
        if (activeWindow === id) chooseNextWindow();
        else syncWindows();
        restoreFocus(state);
        announce(state.title + (close ? ' closed.' : ' minimized. Restore it from the taskbar.'));
    }

    function maximizeWindow(id) {
        const state = windows.get(id);
        const maximized = state.element.classList.toggle('is-maximized');
        const button = state.element.querySelector('.control-maximize');
        button.setAttribute('aria-label', (maximized ? 'Restore size of ' : 'Maximize ') + state.title);
        button.title = maximized ? 'Restore down' : 'Maximize';
        if (!maximized) constrainWindow(state);
        focusWindow(id);
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
            if (event.button !== 0 || event.target.closest('button') || mobile.matches || state.element.classList.contains('is-maximized')) return;
            finishDrag();
            const bounds = state.element.getBoundingClientRect();
            const area = desktop.getBoundingClientRect();
            event.preventDefault();
            state.element.style.animation = 'none';
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

    document.querySelectorAll('[data-window]').forEach((element, index) => {
        const id = element.dataset.window;
        const state = {
            element, title: element.dataset.title, open: id === 'terminal' || (id === 'readme' && window.innerWidth > 1050),
            minimized: false, layer: index + 1, returnFocus: null, task: document.createElement('button')
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
    });

    function closeStart(restore = false) {
        const wasOpen = !startMenu.hidden;
        startMenu.hidden = true;
        startButton.setAttribute('aria-expanded', 'false');
        if (restore && wasOpen) startButton.focus({ preventScroll: true });
    }

    startButton.addEventListener('click', () => {
        const willOpen = startMenu.hidden;
        startMenu.hidden = !willOpen;
        startButton.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) startMenu.querySelector('a').focus({ preventScroll: true });
    });
    document.addEventListener('pointerdown', event => {
        if (!startMenu.contains(event.target) && !startButton.contains(event.target)) closeStart();
    });
    document.addEventListener('focusin', event => {
        if (!startMenu.hidden && !startMenu.contains(event.target) && !startButton.contains(event.target)) closeStart();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !startMenu.hidden) {
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
        closeStart();
        const visible = [...windows.entries()].filter(([, state]) => state.open && !state.minimized).map(([id]) => id);
        if (visible.length) {
            desktopSnapshot = { ids: visible, active: activeWindow };
            visible.forEach(id => { windows.get(id).minimized = true; });
            activeWindow = null;
            syncWindows();
            announce('Desktop shown. Use the taskbar or Start to restore a window.');
        } else {
            const snapshot = desktopSnapshot;
            desktopSnapshot = null;
            const restore = snapshot ? snapshot.ids : [...windows.entries()].filter(([, state]) => state.open).map(([id]) => id);
            restore.forEach(id => { windows.get(id).minimized = false; });
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
        ['resume', 'A link to my resume PDF'],
        ['contact', "Let's start a conversation"],
        ['whoami', 'A quick introduction'],
        ['theme', 'Switch chrome / midnight wallpaper'],
        ['clear', 'A fresh terminal'],
        ['home', 'Bring back the welcome screen']
    ];
    const commandNames = ['help', 'about', 'work', 'projects', 'skills', 'archive', 'resume', 'contact', 'whoami', 'theme', 'clear', 'cls', 'home', 'ls', 'dir', 'pwd', 'open', 'github', 'linkedin', 'date', 'history', 'echo'];
    const aliases = { projects: 'work', cls: 'clear', dir: 'ls' };
    const openNames = ['terminal', 'about', 'work', 'skills', 'archive', 'contact', 'readme'];

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
            case 'resume':
                result.textContent = 'The full story, in a portable format.\n';
                appendLink(result, 'Open Bryant_Villarreal_Resume.pdf ↗', 'assets/pdf/bryant-res.pdf');
                break;
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
                    button.textContent = name === 'resume' ? 'resume.pdf' : name + '/';
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

    document.getElementById('reset-desktop').addEventListener('click', () => {
        finishDrag();
        windows.forEach((state, id) => {
            state.open = id === 'terminal' || (id === 'readme' && window.innerWidth > 1050);
            state.minimized = false;
            state.element.classList.remove('is-maximized');
            for (const property of ['left', 'top', 'right', 'transform', 'animation', 'will-change']) state.element.style.removeProperty(property);
            state.element.querySelector('.control-maximize').setAttribute('aria-label', 'Maximize ' + state.title);
            state.element.querySelector('.control-maximize').title = 'Maximize';
        });
        terminalWelcome.hidden = false;
        terminalOutput.replaceChildren();
        terminalInput.value = '';
        desktopSnapshot = null;
        closeStart();
        focusWindow('terminal');
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
            windows.forEach(constrainWindow);
        });
    });

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
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let donutInterval = null;

        function startDonut() {
            if (prefersReducedMotion.matches || donutInterval) return;
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
})();
