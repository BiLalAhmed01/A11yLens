// Mobile nav toggle -- shared by every page that includes this script.
(function () {
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("mobile-menu");
  if (!toggle || !menu) return;

  toggle.addEventListener("click", () => {
    const open = !menu.hidden;
    menu.hidden = open;
    toggle.setAttribute("aria-expanded", String(!open));
  });
})();
