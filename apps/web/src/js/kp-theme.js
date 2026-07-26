/* ============================================================================
   KobiiCraft Pass - sun/moon theme control.

   Shipped INSIDE the fork (apps/web/src/js/kp-theme.js) and referenced from
   index.html next to the css/kobiicraft-pass.css operator hook. Copied verbatim
   into the build, never compiled.

   SCOPE: cosmetic only. Reads and writes exactly ONE localStorage key, the one
   Vaultwarden already owns. Never touches vault data, crypto, session or auth.

   ---------------------------------------------------------------------------
   WHY THIS WRITES VAULTWARDEN'S OWN KEY
   ---------------------------------------------------------------------------
   theme_head.js (Vaultwarden, runs before first paint) reads
   localStorage['global_theming_selection'] and stamps <html class="theme_light">
   or "theme_dark". Settings -> Appearance -> Theme writes that SAME key.

   A private key (e.g. 'kp-theme') would fork the state: the control and the
   native dropdown would each believe a different theme, in both directions, and
   a reload would obey whichever theme_head.js happened to read. So this control
   is a SECOND WRITER of the existing key, never a second source of truth. The
   consequence is that no persistence code lives here at all, and the
   before-paint guarantee comes free from theme_head.js.

   VALUE FORMAT: the key holds a JSON string ('"dark"'), because Angular's state
   layer JSON-serialises it. Writing a bare 'dark' would make the native reader's
   JSON.parse throw. We therefore write JSON.stringify(...) and read tolerantly:
   theme_head.js itself only does indexOf, so both forms would satisfy IT, but
   the Angular Settings screen would not - hence the strict write.

   ---------------------------------------------------------------------------
   PLACEMENT: DOCKED IN THE VAULT HEADER, FIXED ON THE LOGIN SHELL
   ---------------------------------------------------------------------------
   Inside the authenticated vault the control sits immediately LEFT of the
   "+ New" button. All three right-hand controls are projected into ONE flex row
   by libs/components/src/header/header.component.html:

       <ng-content></ng-content>            <- vault-header projects "+ New" here
       <product-switcher></product-switcher> <- the grid icon
       <app-account-menu></app-account-menu> <- the account avatar

   so inserting before the "+ New" wrapper yields  [sun/moon] [+ New] [grid]
   [avatar]. Those three are Angular COMPONENT selectors, verified present in the
   compiled bundle as selectors:[["vault-new-cipher-menu"]] etc, so they render
   as literal tags - stable hooks, unlike hashed Tailwind classes.

   Anchors are tried in order because "+ New" is NOT always present: the vault
   header renders <vault-new-cipher-menu> only when filter.type !== 'trash', so
   on the Trash screen the control docks before <product-switcher> instead and
   stays reachable. The login shell has no header at all, so there the control
   falls back to its fixed top-right position.

   Docking uses insertBefore against a live anchor rather than absolute
   positioning: the row already supplies its own gap, and DOM order survives the
   layout changes that would silently desync a hardcoded offset.
   ============================================================================ */
(function () {
  "use strict";

  var KEY = "global_theming_selection";
  var ID = "kp-theme-toggle";
  var DOCKED = "data-kp-docked";

  // Tried in order. Each is an Angular component selector confirmed in the
  // compiled bundle; the first one actually on screen wins.
  var ANCHORS = ["vault-new-cipher-menu", "product-switcher", "app-account-menu"];

  var LABEL = {
    // Shown while DARK is active; activating it switches to light.
    dark: { glyph: "\u2600\uFE0F", aria: "Cambiar a modo claro" },
    // Shown while LIGHT is active; activating it switches to dark.
    light: { glyph: "\uD83C\uDF19", aria: "Cambiar a modo oscuro" }
  };

  var reported = {};
  function guard(label, fn) {
    try {
      return fn();
    } catch (err) {
      if (!reported[label]) {
        reported[label] = true;
        (console.warn || console.log).call(
          console, "[KobiiCraft Pass theme] " + label + " failed:", err
        );
      }
    }
  }

  function prefersDark() {
    return !!(window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  /* The theme actually on screen. The <html> class is authoritative because
     theme_head.js has already resolved "system" against the media query by the
     time this runs; re-deriving it from the key would duplicate that logic and
     could disagree with what the user is looking at. */
  function activeTheme() {
    return document.documentElement.classList.contains("theme_dark")
      ? "dark"
      : "light";
  }

  /* Tolerant read: accepts '"dark"', 'dark', or absent. Mirrors how
     theme_head.js interprets the key so we never disagree with it. */
  function storedSelection() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (err) {
      return null; // storage blocked (private mode / policy) -> treat as unset
    }
    if (!raw) return null;
    if (raw.indexOf("system") > -1) return "system";
    if (raw.indexOf("dark") > -1) return "dark";
    if (raw.indexOf("light") > -1) return "light";
    return null;
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    root.classList.remove("theme_light", "theme_dark");
    root.classList.add("theme_" + theme);
  }

  function persist(theme) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(theme));
    } catch (err) {
      /* Storage unavailable: the theme still applies for this page view, it
         just will not survive a reload. Degrading to a working-but-transient
         toggle beats refusing to switch at all. */
      guard("persist", function () { throw err; });
    }
  }

  function paintButton(btn) {
    var face = LABEL[activeTheme()];
    if (btn.textContent !== face.glyph) btn.textContent = face.glyph;
    btn.setAttribute("aria-label", face.aria);
    btn.setAttribute("title", face.aria);
  }

  function onScreen(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* Climb from the anchor component to the node that is a DIRECT child of the
     flex row, so insertBefore lands us IN that row and we inherit its gap.
     The row is identified by computed display, not by a utility class - a
     layout fact outlives a class name. */
  function rowChild(el) {
    var node = el;
    while (node.parentElement && node.parentElement !== document.body) {
      var d = window.getComputedStyle(node.parentElement).display;
      if (d === "flex" || d === "inline-flex") return node;
      node = node.parentElement;
    }
    return null;
  }

  function findAnchor() {
    for (var i = 0; i < ANCHORS.length; i++) {
      var el = document.querySelector(ANCHORS[i]);
      if (!onScreen(el)) continue;
      var child = rowChild(el);
      if (child && child !== document.getElementById(ID)) return child;
    }
    return null;
  }

  function build() {
    var btn = document.createElement("button");
    btn.id = ID;
    btn.type = "button"; // never submit the login form it may sit inside
    btn.setAttribute("data-kp-theme", "1");
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      guard("toggle", function () {
        var next = activeTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        persist(next);
        paintButton(btn);
      });
    });
    return btn;
  }

  /* Idempotent: creates the control once, then keeps it in the right container.
     Placement is re-checked on every call rather than skipped-if-present,
     because the control has to migrate when the user moves between the login
     shell (no header -> fixed) and the vault (header -> docked). Only moving
     when the position is actually wrong keeps the MutationObserver from
     ping-ponging: after a move, btn.nextElementSibling IS the anchor, so the
     next observation is a no-op and the loop settles. */
  function mount() {
    if (!document.body) return;
    var btn = document.getElementById(ID) || build();
    var anchor = findAnchor();

    if (anchor) {
      if (btn.parentElement !== anchor.parentElement ||
          btn.nextElementSibling !== anchor) {
        anchor.parentElement.insertBefore(btn, anchor);
      }
      if (!btn.hasAttribute(DOCKED)) btn.setAttribute(DOCKED, "1");
    } else {
      if (btn.parentElement !== document.body) document.body.appendChild(btn);
      if (btn.hasAttribute(DOCKED)) btn.removeAttribute(DOCKED);
    }
    paintButton(btn);
  }

  /* Follow the OS while the user has not made an explicit choice. Once they
     pick a side, their choice outranks the OS - same precedence theme_head.js
     applies on load. */
  function watchSystem() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () {
      var sel = storedSelection();
      if (sel === null || sel === "system") {
        applyTheme(prefersDark() ? "dark" : "light");
        var btn = document.getElementById(ID);
        if (btn) paintButton(btn);
      }
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* Another tab (or the native Settings screen in this one) changed the theme:
     converge instead of drifting. */
  function watchStorage() {
    window.addEventListener("storage", function (ev) {
      if (!ev || ev.key !== KEY) return;
      guard("storageSync", function () {
        var sel = storedSelection();
        var theme = sel === "dark" ? "dark"
          : sel === "light" ? "light"
          : (prefersDark() ? "dark" : "light");
        applyTheme(theme);
        var btn = document.getElementById(ID);
        if (btn) paintButton(btn);
      });
    });
  }

  function boot() {
    guard("mount", mount);
  }

  if (document.readyState !== "loading") boot();
  document.addEventListener("DOMContentLoaded", boot);

  /* Angular swaps the whole view on navigation and can detach our node, or
     render the header AFTER we first ran. Debounced so a busy authenticated
     vault never thrashes. */
  guard("observer", function () {
    var pending = false;
    var schedule = function () {
      if (pending) return;
      pending = true;
      var run = function () { pending = false; guard("mount", mount); };
      if (window.requestAnimationFrame) window.requestAnimationFrame(run);
      else window.setTimeout(run, 200);
    };
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });

  guard("watchSystem", watchSystem);
  guard("watchStorage", watchStorage);
})();