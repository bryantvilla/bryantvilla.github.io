/* Pointer and keyboard selection, enhanced over the desktop's ordinary links. */
'use strict';
window.BryantDesktopIcons = {
    init({ desktop, shortcuts, announce, openIcon }) {
        const icons = [...shortcuts.querySelectorAll('.desktop-icon')];
        const selected = new Set();
        const offsets = new Map(icons.map(icon => [icon, { x: 0, y: 0 }]));
        const marquee = document.createElement('div');
        marquee.className = 'desktop-marquee';
        marquee.hidden = true;
        marquee.setAttribute('aria-hidden', 'true');
        desktop.append(marquee);
        desktop.tabIndex = -1;
        shortcuts.setAttribute('role', 'listbox');
        shortcuts.setAttribute('aria-multiselectable', 'true');
        shortcuts.setAttribute('aria-describedby', 'desktop-selection-help');
        let anchor = 0;
        let gesture = null;
        let suppressedUntil = 0;
        let touchOpen = null;

        function syncSelection() {
            icons.forEach(icon => {
                icon.classList.toggle('is-selected', selected.has(icon));
                icon.setAttribute('aria-selected', String(selected.has(icon)));
            });
        }

        function select(items) {
            selected.clear();
            items.forEach(icon => selected.add(icon));
            syncSelection();
        }

        function reportSelection() {
            announce(selected.size ? `${selected.size} desktop icon${selected.size === 1 ? '' : 's'} selected.` : 'Desktop selection cleared.');
        }

        function focusIcon(icon) {
            icons.forEach(item => { item.tabIndex = item === icon ? 0 : -1; });
            icon.focus({ preventScroll: true });
        }

        function range(icon) {
            const index = icons.indexOf(icon);
            return icons.slice(Math.min(anchor, index), Math.max(anchor, index) + 1);
        }

        function position(icon, x, y) {
            offsets.set(icon, { x, y });
            icon.style.transform = `translate(${x}px, ${y}px)`;
        }

        function snapshot() {
            return [...selected].map(icon => ({ icon, ...offsets.get(icon), bounds: icon.getBoundingClientRect() }));
        }

        // One bounded delta preserves the spacing of the entire selected group.
        function moveGroup(items, dx, dy) {
            if (!items.length) return;
            const area = desktop.getBoundingClientRect();
            dx = Math.max(area.left - Math.min(...items.map(item => item.bounds.left)), Math.min(dx, area.right - Math.max(...items.map(item => item.bounds.right))));
            dy = Math.max(area.top - Math.min(...items.map(item => item.bounds.top)), Math.min(dy, area.bottom - Math.max(...items.map(item => item.bounds.bottom))));
            items.forEach(item => position(item.icon, item.x + dx, item.y + dy));
        }

        function drawGesture() {
            if (!gesture) return;
            const current = gesture;
            current.frame = 0;
            if (current.icon) {
                moveGroup(current.items, current.x - current.startX, current.y - current.startY);
                return;
            }
            const area = desktop.getBoundingClientRect();
            const x = Math.max(area.left, Math.min(current.x, area.right));
            const y = Math.max(area.top, Math.min(current.y, area.bottom));
            const left = Math.min(current.startX, x);
            const top = Math.min(current.startY, y);
            const right = Math.max(current.startX, x);
            const bottom = Math.max(current.startY, y);
            Object.assign(marquee.style, { left: left - area.left + 'px', top: top - area.top + 'px', width: right - left + 'px', height: bottom - top + 'px' });
            marquee.hidden = false;
            const next = new Set(current.additive ? current.before : []);
            icons.forEach(icon => {
                const bounds = icon.getBoundingClientRect();
                if (bounds.left < right && bounds.right > left && bounds.top < bottom && bounds.bottom > top) {
                    if (current.toggle && next.has(icon)) next.delete(icon);
                    else next.add(icon);
                }
            });
            select(next);
        }

        function finish(event, cancel = false) {
            if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
            const current = gesture;
            cancelAnimationFrame(current.frame);
            if (cancel) {
                current.items.forEach(item => position(item.icon, item.x, item.y));
                select(current.before);
            } else if (current.moved) drawGesture();
            else if (current.icon && !current.additive) select([current.icon]);
            touchOpen = !cancel && !current.moved && current.touch && current.wasSelected && !current.additive ? current.icon : null;
            if (current.moved || cancel) suppressedUntil = performance.now() + 400;
            gesture = null;
            marquee.hidden = true;
            desktop.classList.remove('is-selecting-icons', 'is-moving-icons');
            if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
            reportSelection();
        }

        icons.forEach((icon, index) => {
            icon.draggable = false;
            icon.tabIndex = index ? -1 : 0;
            icon.setAttribute('role', 'option');
            icon.setAttribute('aria-selected', 'false');
            icon.setAttribute('aria-describedby', 'desktop-selection-help');
            icon.title = 'Double-click to open. Drag to move.';
        });

        desktop.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary || gesture) return;
            const icon = event.target.closest('.desktop-icon');
            if (!icon && event.target !== desktop && event.target !== shortcuts) return;
            event.preventDefault();
            const before = new Set(selected);
            const additive = event.ctrlKey || event.metaKey || event.shiftKey;
            const wasSelected = selected.has(icon);
            touchOpen = null;
            if (icon) {
                focusIcon(icon);
                if (event.shiftKey) select(new Set([...selected, ...range(icon)]));
                else if (event.ctrlKey || event.metaKey) {
                    if (wasSelected) selected.delete(icon);
                    else selected.add(icon);
                    syncSelection();
                    anchor = icons.indexOf(icon);
                } else {
                    if (!wasSelected) select([icon]);
                    anchor = icons.indexOf(icon);
                }
            } else {
                desktop.focus({ preventScroll: true });
                if (!additive) select([]);
            }
            const capture = icon || desktop;
            gesture = { icon, capture, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, before, additive, toggle: event.ctrlKey || event.metaKey, wasSelected, touch: event.pointerType === 'touch', items: icon ? snapshot() : [], moved: false, frame: 0 };
            capture.setPointerCapture(event.pointerId);
        });

        desktop.addEventListener('pointermove', event => {
            if (!gesture || event.pointerId !== gesture.pointerId) return;
            gesture.x = event.clientX;
            gesture.y = event.clientY;
            if (!gesture.moved && Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 5) return;
            gesture.moved = true;
            desktop.classList.add(gesture.icon ? 'is-moving-icons' : 'is-selecting-icons');
            if (!gesture.frame) gesture.frame = requestAnimationFrame(drawGesture);
        });
        desktop.addEventListener('pointerup', event => finish(event));
        desktop.addEventListener('pointercancel', event => finish(event, true));
        desktop.addEventListener('lostpointercapture', event => finish(event, true));
        shortcuts.addEventListener('dragstart', event => event.preventDefault());

        shortcuts.addEventListener('click', event => {
            const icon = event.target.closest('.desktop-icon');
            if (!icon) return;
            event.preventDefault();
            event.stopPropagation();
            if (performance.now() < suppressedUntil) return;
            if (event.detail === 0 || touchOpen === icon) {
                touchOpen = null;
                openIcon(icon);
            }
        });
        shortcuts.addEventListener('dblclick', event => {
            const icon = event.target.closest('.desktop-icon');
            if (!icon) return;
            event.preventDefault();
            if (performance.now() >= suppressedUntil && !event.ctrlKey && !event.metaKey && !event.shiftKey) openIcon(icon);
        });
        shortcuts.addEventListener('auxclick', event => {
            const icon = event.target.closest('.desktop-icon');
            if (!icon || event.button !== 1) return;
            event.preventDefault();
            openIcon(icon);
        });

        desktop.addEventListener('keydown', event => {
            const icon = event.target.closest('.desktop-icon');
            if (!icon && event.target !== desktop) return;
            const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault();
                select(icons);
            } else if (event.key === 'Escape') {
                finish(null, true);
                select([]);
            } else if (event.altKey && arrows.includes(event.key)) {
                event.preventDefault();
                if (!selected.size && icon) select([icon]);
                const step = event.shiftKey ? 40 : 10;
                moveGroup(snapshot(), event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
                announce(`${selected.size} desktop icon${selected.size === 1 ? '' : 's'} moved.`);
                return;
            } else if (icon && event.key === ' ') {
                event.preventDefault();
                if (selected.has(icon)) selected.delete(icon);
                else selected.add(icon);
                anchor = icons.indexOf(icon);
                syncSelection();
            } else if (icon && event.key === 'Enter') {
                event.preventDefault();
                openIcon(icon);
                return;
            } else if (icon && (arrows.includes(event.key) || event.key === 'Home' || event.key === 'End')) {
                event.preventDefault();
                let next = event.key === 'Home' ? icons[0] : event.key === 'End' ? icons.at(-1) : null;
                if (!next) {
                    const from = icon.getBoundingClientRect();
                    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
                    const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
                    const candidates = icons.filter(item => item !== icon).map(item => {
                        const bounds = item.getBoundingClientRect();
                        const dx = bounds.left + bounds.width / 2 - from.left - from.width / 2;
                        const dy = bounds.top + bounds.height / 2 - from.top - from.height / 2;
                        return { item, distance: (horizontal ? dx : dy) * sign, cross: Math.abs(horizontal ? dy : dx) };
                    }).filter(item => item.distance > 1).sort((a, b) => a.distance + a.cross * 3 - b.distance - b.cross * 3);
                    next = candidates[0]?.item || icon;
                }
                focusIcon(next);
                if (event.shiftKey) select(new Set([...selected, ...range(next)]));
                else if (!event.ctrlKey && !event.metaKey) {
                    select([next]);
                    anchor = icons.indexOf(next);
                }
            } else return;
            reportSelection();
        });

        return {
            cancel: () => finish(null, true),
            reset() {
                finish(null, true);
                icons.forEach(icon => position(icon, 0, 0));
                select([]);
            },
            refresh() {
                finish(null, true);
                const area = desktop.getBoundingClientRect();
                icons.forEach(icon => {
                    const bounds = icon.getBoundingClientRect();
                    const offset = offsets.get(icon);
                    const dx = Math.max(area.left, Math.min(bounds.left, area.right - bounds.width)) - bounds.left;
                    const dy = Math.max(area.top, Math.min(bounds.top, area.bottom - bounds.height)) - bounds.top;
                    position(icon, offset.x + dx, offset.y + dy);
                });
            }
        };
    }
};
