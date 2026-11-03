// ©HomeHub LLC 2026
(() => {
  const fnav = document.getElementById('fnav');
  const links = document.getElementById('fnavLinks');
  const pill = links.querySelector('.fnav-pill');
  const current = () => links.querySelector('[aria-current="page"]');

  // Mark the link matching the current URL as active
  // a.pathname is the link's full resolved path, so this works from any folder and on GitHub Pages (/repo-name/...).
  // "/index.html" and "/" are treated as the same page.
  // A link with a hash (index.html#projects) is current only while the address has that hash;
  // then the plain link to the same page (Home) is not.
  const norm = p => p.replace(/index\.html$/, '');
  function markCurrent() {
    const path = norm(location.pathname), hash = location.hash;
    const all = Array.from(document.querySelectorAll('.fnav-links a'));
    const samePage = all.filter(a => norm(a.pathname) === path);
    const hashHit = samePage.some(a => a.hash && hash.startsWith(a.hash));
    all.forEach(a => {
      const on = samePage.includes(a) && (a.hash ? hash.startsWith(a.hash) : !hashHit);
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
  }
  markCurrent();
  window.addEventListener('hashchange', () => { markCurrent(); movePill(current()); });

  // Sliding pill under the active / hovered top link
  function movePill(el) {
    if (!el || !links.offsetParent) return;
    pill.style.width = el.offsetWidth + 'px';
    pill.style.transform = `translateX(${el.offsetLeft}px)`;
  }
  links.querySelectorAll('a').forEach(a => a.addEventListener('mouseenter', () => movePill(a)));
  links.addEventListener('mouseleave', () => movePill(current()));

  // Compact top bar on scroll
  let ticking = false;
  function onScroll() {
    fnav.classList.toggle('is-compact', window.scrollY > 40);
    ticking = false;
  }
  window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });
  fnav.addEventListener('transitionend', e => { if (e.propertyName === 'width') movePill(current()); });

  window.addEventListener('resize', () => movePill(current()));
  document.fonts?.ready.then(() => movePill(current()));
  movePill(current());
})();