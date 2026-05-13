(() => {
  const header = document.querySelector("[data-seo-header]");
  if (!header) {
    return;
  }

  const toggle = header.querySelector("[data-menu-toggle]");
  const menu = header.querySelector("#project-links-menu");

  document.documentElement.classList.add("seo-header-ready");

  const setOpen = (open) => {
    header.classList.toggle("topbar--menu-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
  };

  toggle?.addEventListener("click", () => {
    setOpen(!header.classList.contains("topbar--menu-open"));
  });

  menu?.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) {
      setOpen(false);
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !header.contains(event.target)) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setOpen(false);
    }
  });

  const syncCompactState = () => {
    header.classList.toggle("topbar--compact", window.scrollY > 44);
  };

  syncCompactState();
  window.addEventListener("scroll", syncCompactState, { passive: true });
})();
