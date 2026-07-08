(function () {
  const ROUTE_TO_LEGACY_TAB = {
    '/': 'analytics',
    '/dashboard': 'analytics',
    '/keyword': 'keywords',
    '/menu': 'menu',
    '/setting': 'settings',
    '/broadcast': 'broadcast',
    '/live-chat': 'livechat',
    '/history': 'history',
    '/training-data': 'training',
    '/whatsapp': 'whatsapp',
    '/testing': 'test'
  };

  const ACTIVE_CLASSES = ['bg-primary', 'text-primary-foreground'];
  const INACTIVE_CLASSES = ['text-muted-foreground'];

  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function initDropdowns() {
    const dropdowns = document.querySelectorAll('[data-dropdown]');

    function closeAll() {
      dropdowns.forEach((root) => {
        const menu = root.querySelector('[data-dropdown-menu]');
        if (menu) menu.classList.add('hidden');
      });
    }

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const clickedDropdown = target.closest('[data-dropdown]');
      if (!clickedDropdown) {
        closeAll();
        return;
      }

      const trigger = target.closest('[data-dropdown-trigger]');
      if (!trigger) return;

      const menu = clickedDropdown.querySelector('[data-dropdown-menu]');
      if (!menu) return;

      dropdowns.forEach((root) => {
        const m = root.querySelector('[data-dropdown-menu]');
        if (!m) return;
        if (root === clickedDropdown) return;
        m.classList.add('hidden');
      });

      menu.classList.toggle('hidden');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAll();
    });
  }

  function getLegacyTabFromPath(pathname) {
    const p = String(pathname || '/');
    return ROUTE_TO_LEGACY_TAB[p] || 'analytics';
  }

  function setActiveNavByPath(pathname) {
    const links = document.querySelectorAll('a[data-nav-link]');
    const p = String(pathname || '/');

    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      const isActive = href === p || (p === '/' && href === '/dashboard');

      link.setAttribute('aria-current', isActive ? 'page' : 'false');

      if (isActive) {
        ACTIVE_CLASSES.forEach((c) => link.classList.add(c));
        INACTIVE_CLASSES.forEach((c) => link.classList.remove(c));
      } else {
        ACTIVE_CLASSES.forEach((c) => link.classList.remove(c));
        INACTIVE_CLASSES.forEach((c) => link.classList.add(c));
      }
    });
  }

  function navigateToPath(pathname, { pushState } = { pushState: true }) {
    const legacyTab = getLegacyTabFromPath(pathname);
    const frame = document.getElementById('adminContentFrame');
    if (frame && frame instanceof HTMLIFrameElement) {
      const nextSrc = `/legacy-admin?tab=${encodeURIComponent(legacyTab)}`;
      if (frame.getAttribute('src') !== nextSrc) {
        frame.setAttribute('src', nextSrc);
      }
    }

    setActiveNavByPath(pathname);

    if (pushState) {
      try {
        window.history.pushState({}, '', pathname);
      } catch (_) {
        // ignore
      }
    }
  }

  function initNavigation() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const link = target.closest('a[data-nav-link]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href || !href.startsWith('/')) return;

      e.preventDefault();
      navigateToPath(href, { pushState: true });
    });

    window.addEventListener('popstate', () => {
      navigateToPath(window.location.pathname, { pushState: false });
    });

    navigateToPath(window.location.pathname, { pushState: false });
  }

  function initLogout() {
    const btn = document.getElementById('v0LogoutBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      try {
        localStorage.removeItem('admin_token');
      } catch (_) {
        // ignore
      }

      const frame = document.getElementById('adminContentFrame');
      if (frame && frame instanceof HTMLIFrameElement) {
        try {
          frame.contentWindow.location.reload();
          return;
        } catch (_) {
          // ignore
        }
      }

      window.location.reload();
    });
  }

  initIcons();
  initDropdowns();
  initNavigation();
  initLogout();
})();
