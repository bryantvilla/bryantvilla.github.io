/* Shared by the desktop and the standalone/embedded resume. */
(() => {
    'use strict';
    let dialog;
    let pending;

    function createDialog() {
        dialog = document.createElement('dialog');
        dialog.className = 'redirect-dialog';
        dialog.setAttribute('aria-labelledby', 'redirect-title');
        dialog.setAttribute('aria-describedby', 'redirect-message redirect-destination');
        dialog.innerHTML = '<div class="redirect-titlebar"><span>bryantOS · Open link</span><button type="button" class="redirect-close" aria-label="Cancel redirect">×</button></div><div class="redirect-content"><span class="redirect-warning" aria-hidden="true">!</span><div><h2 id="redirect-title">You’re about to leave the desktop</h2><p id="redirect-message"></p><p id="redirect-destination" class="redirect-destination"></p></div></div><div class="redirect-actions"><button type="button" class="redirect-cancel" autofocus>Cancel</button><button type="button" class="redirect-continue">Continue</button></div>';
        document.body.append(dialog);
        dialog.querySelector('.redirect-close').addEventListener('click', () => dialog.close());
        dialog.querySelector('.redirect-cancel').addEventListener('click', () => dialog.close());
        dialog.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const buttons = [...dialog.querySelectorAll('button:not([disabled])')];
            const first = buttons[0];
            const last = buttons.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        dialog.addEventListener('close', () => {
            const source = pending?.source;
            pending = null;
            if (source?.isConnected) source.focus({ preventScroll: true });
        });
        dialog.querySelector('.redirect-continue').addEventListener('click', () => {
            const destination = pending;
            if (!destination) return;
            dialog.close();
            if (destination.download !== null) {
                const download = document.createElement('a');
                download.href = destination.url.href;
                download.download = destination.download;
                download.dataset.redirectConfirmed = 'true';
                download.hidden = true;
                document.body.append(download);
                download.click();
                download.remove();
            } else if (destination.newTab && /^https?:$/.test(destination.url.protocol)) {
                window.open(destination.url.href, '_blank', 'noopener,noreferrer');
            } else window.location.assign(destination.url.href);
        });
    }

    function confirm(link, { newTab = false } = {}) {
        // A resume link uses the desktop's modal so it cannot be clipped by the iframe.
        try {
            if (window.parent !== window && window.parent.BryantNavigation) {
                window.parent.BryantNavigation.confirm(link, { newTab });
                return;
            }
        } catch { /* The standalone resume also works in an unrelated embedding site. */ }
        const url = new URL(link.href, document.baseURI);
        if (!/^(https?:|mailto:|tel:)$/.test(url.protocol)) return;
        if (!dialog) createDialog();
        if (dialog.open) return;
        const opensApp = url.protocol === 'mailto:' || url.protocol === 'tel:';
        pending = { url, source: link, newTab: newTab || link.target === '_blank', download: link.getAttribute('download') };
        dialog.querySelector('#redirect-title').textContent = opensApp ? 'Open another app?' : 'You’re about to leave the desktop';
        dialog.querySelector('#redirect-message').textContent = opensApp
            ? `This link will open your ${url.protocol === 'mailto:' ? 'email' : 'phone'} app. Continue?`
            : pending.download !== null ? 'This link will download a file. Continue?'
            : pending.newTab ? 'This link will open in a new tab. Continue?' : 'This link will take you to another page. Continue?';
        dialog.querySelector('#redirect-destination').textContent = url.href;
        dialog.showModal();
        dialog.querySelector('.redirect-cancel').focus();
    }

    function intercept(event) {
        if (event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return;
        const link = event.target.closest('a[href]');
        const newTab = event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey;
        if (!link || link.dataset.redirectConfirmed || (link.hasAttribute('data-open') && !newTab)) return;
        // Desktop shortcuts confirm only after activation, not on the selection click.
        if (link.classList.contains('desktop-icon') && document.documentElement.classList.contains('os-ready')) return;
        const url = new URL(link.href, document.baseURI);
        if (!/^(https?:|mailto:|tel:)$/.test(url.protocol)) return;
        const sameDocument = url.origin === location.origin && url.pathname === location.pathname && url.search === location.search;
        if (sameDocument && !newTab && !link.target && !link.hasAttribute('download')) return;
        // Word's section links stay inside the existing resume document.
        if (link.target === 'resume-document' && !newTab && !link.hasAttribute('download')) {
            const frame = document.getElementById('resume-document');
            const source = frame && new URL(frame.src);
            if (source && url.origin === source.origin && url.pathname === source.pathname && url.search === source.search) return;
        }
        event.preventDefault();
        confirm(link, { newTab });
    }

    window.BryantNavigation = { confirm };
    document.addEventListener('click', intercept, true);
    document.addEventListener('auxclick', intercept, true);
})();
