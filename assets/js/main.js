/* The HTML, native disclosures, and contact form also work without JavaScript. */
const themeButton = document.getElementById('theme-button');
const themeColor = document.querySelector('meta[name="theme-color"]');

function updateTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeButton.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    themeColor.setAttribute('content', theme === 'dark' ? '#151711' : '#f5f7f0');
}

updateTheme(document.documentElement.dataset.theme);
themeButton.hidden = false;
themeButton.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    updateTheme(nextTheme);
    try {
        localStorage.setItem('portfolio-theme', nextTheme);
    } catch {
        // The theme still works for this visit when storage is unavailable.
    }
});

const header = document.getElementById('header');
const navigation = [...document.querySelectorAll('.nav-link')].map(link => ({
    link,
    section: document.querySelector(link.getAttribute('href'))
}));
let scheduled = false;

function updateNavigation() {
    scheduled = false;
    header.classList.toggle('is-scrolled', window.scrollY > 12);
    const offset = header.getBoundingClientRect().height + 32;
    const current = [...navigation].reverse().find(item => item.section.getBoundingClientRect().top <= offset);
    navigation.forEach(({ link }) => {
        if (link === current?.link) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    });
}

function scheduleNavigation() {
    if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(updateNavigation);
    }
}

window.addEventListener('scroll', scheduleNavigation, { passive: true });
window.addEventListener('resize', scheduleNavigation);
window.addEventListener('load', updateNavigation);
updateNavigation();
