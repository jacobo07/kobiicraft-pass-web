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

  /* Glyph is language-independent; the accessible name is not.
     Keyed by theme CURRENTLY ACTIVE - the control shows where it will take you,
     so the sun appears while dark is active. */
  var GLYPH = { dark: "\u2600\uFE0F", light: "\uD83C\uDF19" };

  /* Contract clause C-2: no screen mixes languages. An earlier revision
     hardcoded Spanish here, which meant an English session rendered a Spanish
     accessible name on every screen - a mixed-language surface BY CONSTRUCTION,
     not by configuration. C-4 adds that language and appearance are independent
     controls: this control must therefore FOLLOW the app language, never assert
     one of its own.

     Adding a locale is one row. A language with no row falls back to English,
     which is Vaultwarden's own default - and that fallback is a KNOWN C-2 gap
     for that language, to be recorded as debt rather than hidden, because a
     silent wrong-language label is exactly what this change removes. */
  var STRINGS = {
    en: { dark: "Switch to light mode", light: "Switch to dark mode" },
    es: { dark: "Cambiar a modo claro",  light: "Cambiar a modo oscuro" }
  };

  /* Vaultwarden stamps the active locale on <html lang>. navigator.language is
     the fallback because that is the same signal Vaultwarden itself uses to
     choose a locale when the user has not set one, so the two agree by
     construction rather than by coincidence. */
  function langTag() {
    var raw = "";
    try {
      raw = document.documentElement.getAttribute("lang") ||
            (navigator && navigator.language) || "";
    } catch (err) {
      raw = "";
    }
    return String(raw).toLowerCase().split("-")[0];
  }

  function strings() {
    return STRINGS[langTag()] || STRINGS.en;
  }

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

  /* Re-read on every paint rather than caching: Angular can swap the locale
     without a reload, and a cached label would then disagree with the screen
     around it - the C-2 failure re-introduced by an optimisation. */
  function paintButton(btn) {
    var theme = activeTheme();
    var tag = langTag();
    var glyph = GLYPH[theme];
    var aria = strings()[theme];
    if (btn.textContent !== glyph) btn.textContent = glyph;
    btn.setAttribute("aria-label", aria);
    btn.setAttribute("title", aria);
    /* Declare the label's own language so a screen reader pronounces it with
       the right voice instead of reading Spanish through an English one. */
    btn.setAttribute("lang", STRINGS[tag] ? tag : "en");
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
    markApiKeyFolders();
  }

  /* ==========================================================================
     API-KEY FOLDER MARKING
     --------------------------------------------------------------------------
     Vaultwarden has no api-key item type and this fork cannot add one, so the
     category is carried by a FOLDER - real, encrypted, searchable vault data.
     This function only decides WHICH row is that folder; css/kobiicraft-pass.css
     section 21 decides how it looks. Marking and painting stay separated so the
     rule for "what counts" is readable in one place.

     TWO CONDITIONS, BOTH REQUIRED:

       1. STRUCTURAL - the row carries an i.bwi-folder. vault-filter-section
          renders `<i class="bwi bwi-fw {{ f.node.icon }}">`, so a folder is
          distinguishable from a collection, a type filter or the "add folder"
          link (which carries bwi-plus) without reading any text.
       2. EXACT LABEL - after NBSP normalisation and trimming, case-insensitive.

     Condition 2 is exact ON PURPOSE. Substring matching on "api" would badge
     "therAPIst", "RapidAPI" and "Wasabi"; the vault renders in ES and EN, so a
     lexical rule is wrong in at least one language at all times. A badge that
     asserts a category it cannot actually determine is worse than no badge -
     it teaches the operator to stop trusting badges.

     Un-marking is as important as marking: rename the folder and the attribute
     is removed on the next observation, so the treatment cannot outlive its
     cause. Attributes are only written when actually wrong, which is what keeps
     the MutationObserver from re-triggering itself forever - same convergence
     argument as the docked control above, and asserted in the gate rather than
     assumed. */
  var APIKEY_ATTR = "data-kp-apikeys";

  /* Add a locale here to adopt the convention in that language. A language with
     no row simply never matches, which is a visible no-op rather than a wrong
     badge - the safe direction to fail in. */
  var APIKEY_NAMES = ["api keys", "claves api"];

  function normLabel(el) {
    return (el.textContent || "").replace(/\u00a0/g, " ").trim().toLowerCase();
  }

  function markApiKeyFolders() {
    var rows = document.querySelectorAll("li.filter-option");
    for (var i = 0; i < rows.length; i++) {
      var li = rows[i];
      var btn = li.querySelector(":scope > .filter-buttons > .filter-button");
      var isFolder = !!(btn && btn.querySelector("i.bwi-folder"));
      var hit = isFolder && APIKEY_NAMES.indexOf(normLabel(btn)) > -1;

      if (hit) {
        if (!li.hasAttribute(APIKEY_ATTR)) li.setAttribute(APIKEY_ATTR, "1");
      } else if (li.hasAttribute(APIKEY_ATTR)) {
        li.removeAttribute(APIKEY_ATTR);
      }
    }
  }

  /* ==========================================================================
     SSO CAPABILITY PROBE
     --------------------------------------------------------------------------
     The login page ships a "Use single sign-on" button unconditionally, but this
     deployment has no OIDC authority configured: /api/config reports "sso": ""
     and /identity/connect/oidc-signin returns 404. Clicking it does nothing.

     Rather than hard-hiding it, we read the SAME public config document the app
     itself reads and stamp data-kp-sso="on" when an SSO url is actually present.
     Section 20 hides the button only while that attribute is absent, so the day
     an authority is configured the button comes back on its own - no code change
     and nothing for a future session to remember.

     credentials:"omit" because this endpoint is public and this layer must never
     be in the position of carrying a session. On any failure the attribute is
     simply never set and the button stays hidden: showing a control we cannot
     prove works is the one outcome worth avoiding. */
  var SSO_ATTR = "data-kp-sso";

  function probeSso() {
    if (!window.fetch) return;
    window.fetch("/api/config", { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        var url = cfg && cfg.environment && cfg.environment.sso;
        if (url) document.documentElement.setAttribute(SSO_ATTR, "on");
      })
      .catch(function () { /* stays hidden - see above */ });
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
    /* characterData matters as much as childList here, and it was missing.
       Angular renders a folder name as `&nbsp;{{ f.node.name }}`, so RENAMING a
       folder adds and removes no element - it rewrites an existing text node's
       data, which is a characterData mutation. Without this flag the observer
       never fires on a rename, markApiKeyFolders() never re-runs, and a folder
       renamed away from the convention keeps its "API" badge forever: a label
       asserting a category that is no longer true.

       Caught by V-PASS-APIKEY-UNMARKS, which renames ONLY the text node and
       leaves the icon in place - so a failure there means the LABEL half of the
       rule stopped being re-evaluated, not that the structural half broke.

       Cost is bounded: schedule() is requestAnimationFrame-debounced, so a burst
       of text updates collapses into one mount() per frame, and mount() only
       writes when something is actually wrong. */
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  });

  guard("watchSystem", watchSystem);
  guard("watchStorage", watchStorage);
  guard("ssoProbe", probeSso);
})();