// Mobile nav toggle -- shared by every page that includes this script.
(function () {
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;

  const ICON_OPEN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  const ICON_CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="20" height="20" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

  function isOpen() {
    return !menu.hidden;
  }

  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    toggle.innerHTML = open ? ICON_CLOSE : ICON_OPEN;
  }

  toggle.addEventListener("click", () => setOpen(!isOpen()));

  // Navigating via a link inside the menu should close it, not leave it
  // open (and out of sync with the toggle) behind the new scroll position.
  menu.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (e) => {
    // toggle's own click handler above may have just replaced its innerHTML
    // (icon swap), detaching the original clicked node from the DOM before
    // this listener runs -- .contains() would then wrongly say "outside".
    // composedPath() is captured at dispatch time, so it's immune to that.
    const path = e.composedPath();
    if (isOpen() && !path.includes(menu) && !path.includes(toggle)) {
      setOpen(false);
    }
  });
})();
