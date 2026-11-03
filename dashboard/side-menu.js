// ©HomeHub LLC 2026

// Phone and iPad menu (ADDED). At 1024px wide and below, the left sidebar is hidden and slides in from the left
// when the hamburger button in the top bar is tapped. Used by index.html and allLists.html.
// It closes when you tap outside it, tap the X, press Escape, pick a section, or widen the window past 1024px.
(() => {
  'use strict';
  const db = document.getElementById('db');
  const side = document.getElementById('dbSide');
  const burger = document.getElementById('dbBurger');
  const scrim = document.getElementById('dbScrim');
  const close = document.getElementById('dbClose');
  if (!db || !side || !burger || !scrim) return;
  const small = window.matchMedia('(max-width: 1024px)');

  function setOpen(open, returnFocus) {
    db.classList.toggle('is-menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    scrim.hidden = !open;
    document.documentElement.classList.toggle('db-menu-lock', open); // stop the page scrolling behind the menu
    if (open) (close || side).focus({ preventScroll: true });
    else if (returnFocus) burger.focus({ preventScroll: true });
  }
  const isOpen = () => db.classList.contains('is-menu-open');

  burger.addEventListener('click', () => setOpen(!isOpen(), true));
  scrim.addEventListener('click', () => setOpen(false, true));
  if (close) close.addEventListener('click', () => setOpen(false, true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) setOpen(false, true); });
  // Picking a section (including ones on this page, like #projects) closes the menu
  side.addEventListener('click', e => { if (e.target.closest('a') && small.matches) setOpen(false, false); });
  // Choosing a project in the picker also switches the page, so close the menu then too
  side.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && small.matches) setOpen(false, false); });
  // Wider than a tablet: the sidebar is always shown, so drop the open state
  const reset = () => { if (!small.matches && isOpen()) setOpen(false, false); };
  small.addEventListener ? small.addEventListener('change', reset) : small.addListener(reset);
})();
