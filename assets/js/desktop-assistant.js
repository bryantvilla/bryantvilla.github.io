/* A small, optional desktop guide. It never interrupts a window or traps focus. */
(() => {
    'use strict';
    const assistant = document.getElementById('desktop-assistant');
    const panel = document.getElementById('assistant-panel');
    const launchers = [...document.querySelectorAll('[data-assistant-toggle]')];
    const clearButton = document.getElementById('assistant-show-desktop');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let opener = launchers[0];
    let motion;

    function visibleLauncher() {
        return launchers.find(button => button.getClientRects().length) || opener;
    }

    function close(restoreFocus = false) {
        motion?.cancel();
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
        if (!reducedMotion.matches && typeof panel.animate === 'function') {
            motion?.cancel();
            motion = panel.animate([{ opacity: 0, transform: 'translateY(7px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)' });
        }
        document.getElementById('assistant-title').focus({ preventScroll: true });
    }));

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
