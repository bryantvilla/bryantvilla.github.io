/* A small, optional desktop guide. It never interrupts a window or traps focus. */
(() => {
    'use strict';
    const assistant = document.getElementById('desktop-assistant');
    const panel = document.getElementById('assistant-panel');
    const launchers = [...document.querySelectorAll('[data-assistant-toggle]')];
    const clearButton = document.getElementById('assistant-show-desktop');
    const character = document.querySelector('.assistant-character');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const trickAnimations = { 'is-jumping': 'clip-jump', 'is-flipping': 'clip-flip', 'is-wiggling': 'clip-wiggle' };
    const tricks = Object.keys(trickAnimations);
    const clipButtons = '.assistant-launcher, .assistant-taskbar-button';
    let trickIndex = 0;
    let opener = launchers[0];
    let motion;

    const trickListeners = new WeakMap();

    function clearTricks(element) {
        if (!element) return;
        const done = trickListeners.get(element);
        if (done) {
            element.removeEventListener('animationend', done);
            element.removeEventListener('animationcancel', done);
            trickListeners.delete(element);
        }
        element.classList.remove(...tricks);
    }

    function playTrick(element) {
        if (reducedMotion.matches || !element) return;
        const trick = tricks[trickIndex % tricks.length];
        trickIndex++;
        clearTricks(element);
        void element.offsetWidth;
        element.classList.add(trick);
        // Tricks layer over Clip's idle motion; only this trick's own end (or cancel) clears it.
        const done = event => { if (event.animationName === trickAnimations[trick]) clearTricks(element); };
        trickListeners.set(element, done);
        element.addEventListener('animationend', done);
        element.addEventListener('animationcancel', done);
    }

    function visibleLauncher() {
        return launchers.find(button => button.getClientRects().length) || opener;
    }

    function close(restoreFocus = false) {
        motion?.cancel();
        clearTricks(character);
        panel.hidden = true;
        launchers.forEach(button => button.setAttribute('aria-expanded', 'false'));
        if (restoreFocus) visibleLauncher().focus({ preventScroll: true });
    }

    launchers.forEach(button => button.addEventListener('click', event => {
        event.preventDefault();
        if (!panel.hidden) { close(true); return; }
        opener = button;
        panel.hidden = false;
        clearButton.disabled = !document.querySelector('[data-window]:not([hidden]):not([inert])');
        clearButton.textContent = clearButton.disabled ? 'Desktop is clear' : 'Show desktop';
        launchers.forEach(item => item.setAttribute('aria-expanded', 'true'));
        // The Start menu link has no Clip of its own; animate whichever Clip is on screen.
        playTrick(button.matches(clipButtons) ? button : launchers.find(item => item.matches(clipButtons) && item.getClientRects().length));
        if (!reducedMotion.matches && typeof panel.animate === 'function') {
            motion?.cancel();
            motion = panel.animate([
                { opacity: 0, transform: 'translate3d(-4px, 8px, 0) scale(.94)' },
                { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
            ], { duration: 200, easing: 'cubic-bezier(.16, 1, .3, 1)' });
        }
        document.getElementById('assistant-title').focus({ preventScroll: true });
    }));

    if (character) {
        character.style.cursor = 'pointer';
        character.setAttribute('title', 'Click Clip for a trick!');
        character.addEventListener('click', () => playTrick(character));
    }

    document.getElementById('assistant-close').addEventListener('click', () => close(true));
    clearButton.addEventListener('click', () => {
        if (document.querySelector('[data-window]:not([hidden]):not([inert])')) document.getElementById('show-desktop').click();
        close();
        document.getElementById('desktop').focus({ preventScroll: true });
    });
    document.getElementById('assistant-terminal').addEventListener('click', () => {
        close();
        document.querySelector('[data-open="terminal"]').click();
    });
    document.addEventListener('pointerdown', event => {
        if (!panel.hidden && !assistant.contains(event.target) && !launchers.some(button => button.contains(event.target))) close();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            close(panel.contains(document.activeElement) || launchers.includes(document.activeElement));
        }
    });
    reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) motion?.cancel(); });
})();
