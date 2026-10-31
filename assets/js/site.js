(() => {
    const root = document.documentElement;

    window.siteToken = (name) => getComputedStyle(root).getPropertyValue(name).trim();
    window.siteCanvasFont = (size, weight = 400, family = 'body') =>
        `${weight} ${size}px ${window.siteToken(`--font-${family}`)}`;

    function initialize() {
        if (window.lucide) lucide.createIcons();
        const year = document.getElementById('year');
        if (year) year.textContent = new Date().getFullYear();

        const themeToggle = document.getElementById('theme-toggle');
        function applyTheme(isDark) {
            root.classList.toggle('dark', isDark);
            if (themeToggle) themeToggle.setAttribute('aria-pressed', String(isDark));
            window.dispatchEvent(new Event('site:theme'));
        }
        if (themeToggle) {
            themeToggle.setAttribute('aria-pressed', String(root.classList.contains('dark')));
            themeToggle.addEventListener('click', () => {
                const isDark = !root.classList.contains('dark');
                applyTheme(isDark);
                try { localStorage.theme = isDark ? 'dark' : 'light'; } catch {}
            });
        }
        window.addEventListener('storage', (event) => {
            if (event.key === 'theme') applyTheme(event.newValue === 'dark');
        });

        const menu = document.getElementById('mobile-menu');
        const menuToggle = document.getElementById('mobile-menu-toggle');
        if (menu && menuToggle) {
            function setMenuOpen(open) {
                menu.classList.toggle('hidden', !open);
                menuToggle.setAttribute('aria-expanded', String(open));
                menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
                menuToggle.textContent = open ? 'Close' : 'Menu';
            }
            menuToggle.addEventListener('click', () => setMenuOpen(menu.classList.contains('hidden')));
            menu.querySelectorAll('[data-mobile-nav]').forEach((link) =>
                link.addEventListener('click', () => setMenuOpen(false)));
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && !menu.classList.contains('hidden')) {
                    setMenuOpen(false);
                    menuToggle.focus();
                }
            });
        }

        document.querySelectorAll('pre').forEach((block) => {
            if (block.scrollWidth > block.clientWidth) {
                block.tabIndex = 0;
                block.setAttribute('aria-label', 'Scrollable code sample');
            }
        });
        document.querySelectorAll('[data-slot] img').forEach((image) => {
            if (image.complete && !image.naturalWidth) image.remove();
            else image.addEventListener('error', () => image.remove(), { once: true });
        });
        if (document.fonts) document.fonts.ready.then(() => window.dispatchEvent(new Event('site:theme')));
    }

    window.hallmarkSlots = (images) => {
        for (const [key, value] of Object.entries(images)) {
            const slot = document.querySelector(`[data-slot="${key}"]`);
            if (!slot) continue;
            const image = new Image();
            image.src = typeof value === 'string' ? value : value.src;
            image.alt = (typeof value === 'object' && value.alt) || slot.dataset.alt || '';
            slot.querySelectorAll(':scope > img').forEach((previous) => previous.remove());
            slot.prepend(image);
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
})();
