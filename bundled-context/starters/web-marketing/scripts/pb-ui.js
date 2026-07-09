/* pb-ui.js — Pal Builder behavior layer.
   Loaded once from the page shell as <script type="module" src="..."></script>.
   Every listener below is delegated on `document`, so AJAX-swapped fragments
   work with zero re-init and no fragment <script> tags — never add a
   per-element listener here. Everything is driven by data-pb-* attributes,
   never inline onclick, and this file avoids template-literal interpolation
   entirely: it ships inside CloudPiston pals and must never collide with
   server-side EL templating in an inline page <script>. */

function on(type, selector, handler) {
  document.addEventListener(type, function (event) {
    var el = event.target.closest ? event.target.closest(selector) : null;
    if (el) handler(event, el);
  });
}

/* ---------- theme toggle: boots immediately, before first paint ---------- */

var THEME_KEY = "pb-theme";

(function applyStoredTheme() {
  var stored = null;
  try { stored = window.localStorage.getItem(THEME_KEY); } catch (err) { stored = null; }
  if (stored === "dark" || stored === "light") {
    document.documentElement.setAttribute("data-theme", stored);
  }
})();

on("click", "[data-pb-theme-toggle]", function () {
  var current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  var next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { window.localStorage.setItem(THEME_KEY, next); } catch (err) { /* storage unavailable */ }
});

/* ---------- toggle: dropdown / drawer / sidebar ---------- */

var openToggles = []; // { target, trigger, kind }

function resolveToggleTarget(trigger, kind) {
  var explicit = trigger.getAttribute("data-pb-target");
  if (explicit) return document.querySelector(explicit);
  if (kind === "sidebar") return document.querySelector(".pb-sidebar");
  if (kind === "drawer") return document.querySelector(".pb-drawer");
  var wrap = trigger.closest(".pb-menu-wrap");
  return wrap ? wrap.querySelector(".pb-menu") : trigger.nextElementSibling;
}

function closeToggle(entry) {
  entry.target.classList.remove("is-open");
  if (entry.trigger) entry.trigger.setAttribute("aria-expanded", "false");
  if (entry.kind === "drawer") {
    var scrim = document.querySelector(".pb-drawer-scrim");
    if (scrim) scrim.classList.remove("is-open");
  }
}

on("click", "[data-pb-toggle]", function (event, trigger) {
  event.stopPropagation();
  var kind = trigger.getAttribute("data-pb-toggle");
  var target = resolveToggleTarget(trigger, kind);
  if (!target) return;
  var willOpen = !target.classList.contains("is-open");

  if (kind === "dropdown") {
    // only one dropdown open at a time
    openToggles.filter(function (t) { return t.kind === "dropdown" && t.target !== target; }).forEach(closeToggle);
    openToggles = openToggles.filter(function (t) { return t.kind !== "dropdown" || t.target === target; });
  }

  target.classList.toggle("is-open", willOpen);
  trigger.setAttribute("aria-expanded", String(willOpen));
  if (kind === "drawer") {
    var scrim = document.querySelector(".pb-drawer-scrim");
    if (scrim) scrim.classList.toggle("is-open", willOpen);
  }

  var entry = { target: target, trigger: trigger, kind: kind };
  openToggles = openToggles.filter(function (t) { return t.target !== target; });
  if (willOpen) openToggles.push(entry);
});

// outside click closes open dropdowns/drawers; sidebar stays until explicitly re-toggled
document.addEventListener("click", function (event) {
  if (!openToggles.length) return;
  openToggles.slice().forEach(function (entry) {
    if (entry.kind === "sidebar") return;
    if (entry.target.contains(event.target) || entry.trigger.contains(event.target)) return;
    closeToggle(entry);
    openToggles = openToggles.filter(function (t) { return t !== entry; });
  });
});

document.addEventListener("keydown", function (event) {
  if (event.key !== "Escape" || !openToggles.length) return;
  var last = openToggles[openToggles.length - 1];
  closeToggle(last);
  openToggles.pop();
  if (last.trigger) last.trigger.focus();
});

/* ---------- modal: native <dialog class="pb-modal"> ---------- */

on("click", "[data-pb-modal-open]", function (event, trigger) {
  var dialog = document.getElementById(trigger.getAttribute("data-pb-modal-open"));
  if (dialog && dialog.showModal) dialog.showModal();
});

on("click", "[data-pb-modal-close]", function (event, trigger) {
  var dialog = trigger.closest("dialog");
  if (dialog) dialog.close();
});

// a click that lands on the ::backdrop arrives with event.target === the <dialog> itself
document.addEventListener("click", function (event) {
  if (event.target.tagName === "DIALOG" && event.target.classList.contains("pb-modal")) {
    event.target.close();
  }
});

/* ---------- toast ---------- */

var TOAST_TIMEOUT_MS = 4000;
var TOAST_LEAVE_MS = 220;
var TOAST_TYPE_CLASS = {
  ok: "pb-toast-success", success: "pb-toast-success",
  warn: "pb-toast-warning", warning: "pb-toast-warning",
  error: "pb-toast-danger", danger: "pb-toast-danger",
  info: "pb-toast-info"
};

function ensureToastRegion() {
  var region = document.getElementById("pb-toasts");
  if (!region) {
    region = document.createElement("div");
    region.id = "pb-toasts";
    region.className = "pb-toast-region";
    document.body.appendChild(region);
  }
  return region;
}

window.pbToast = function (message, type) {
  var region = ensureToastRegion();
  var toast = document.createElement("div");
  toast.className = "pb-toast " + (TOAST_TYPE_CLASS[type] || "");
  toast.setAttribute("role", "status");
  var msg = document.createElement("p");
  msg.className = "pb-toast-msg";
  msg.textContent = message;
  toast.appendChild(msg);
  region.appendChild(toast);
  window.setTimeout(function () {
    toast.classList.add("is-leaving");
    window.setTimeout(function () { toast.remove(); }, TOAST_LEAVE_MS);
  }, TOAST_TIMEOUT_MS);
};

on("click", "[data-pb-toast]", function (event, trigger) {
  window.pbToast(trigger.getAttribute("data-pb-toast"), trigger.getAttribute("data-pb-toast-type"));
});

on("click", "[data-pb-dismiss]", function (event, trigger) {
  var target = trigger.closest(".pb-alert, .pb-toast");
  if (!target) return;
  target.classList.add("is-leaving");
  window.setTimeout(function () { target.remove(); }, TOAST_LEAVE_MS);
});

/* ---------- tabs (client-side only) ---------- */

on("click", "[data-pb-tab]", function (event, button) {
  var container = button.closest("[data-pb-tabs]");
  if (!container) return;
  container.querySelectorAll("[data-pb-tab]").forEach(function (btn) {
    var selected = btn === button;
    btn.setAttribute("aria-selected", String(selected));
    var panel = document.getElementById(btn.getAttribute("data-pb-tab"));
    if (panel) panel.hidden = !selected;
  });
});

/* ---------- combobox + command palette (shared filtering engine) ---------- */

function filterOptions(wrapper, query) {
  var needle = query.trim().toLowerCase();
  var firstVisible = null;
  wrapper.querySelectorAll("[data-pb-option]").forEach(function (opt) {
    var match = !needle || opt.textContent.toLowerCase().indexOf(needle) !== -1;
    opt.hidden = !match;
    opt.classList.remove("is-active");
    if (match && !firstVisible) firstVisible = opt;
  });
  if (firstVisible) firstVisible.classList.add("is-active");
}

function visibleOptions(wrapper) {
  return Array.prototype.filter.call(wrapper.querySelectorAll("[data-pb-option]"), function (opt) { return !opt.hidden; });
}

function moveActiveOption(wrapper, delta) {
  var options = visibleOptions(wrapper);
  if (!options.length) return;
  var current = wrapper.querySelector("[data-pb-option].is-active");
  var index = current ? options.indexOf(current) : -1;
  index = (index + delta + options.length) % options.length;
  options.forEach(function (opt) { opt.classList.remove("is-active"); });
  options[index].classList.add("is-active");
  options[index].scrollIntoView({ block: "nearest" });
}

function selectOption(wrapper, option) {
  var input = wrapper.querySelector("input");
  if (input) input.value = option.textContent.trim();
  if (option.hasAttribute("href")) {
    var link = document.createElement("a");
    link.href = option.getAttribute("href");
    link.click();
  }
  if (wrapper.tagName === "DIALOG") { wrapper.close(); } else if (input) { input.blur(); }
}

on("input", "[data-pb-combobox] input, [data-pb-command] input", function (event, input) {
  var wrapper = input.closest("[data-pb-combobox], [data-pb-command]");
  if (wrapper) filterOptions(wrapper, input.value);
});

document.addEventListener("focusin", function (event) {
  var input = event.target.closest ? event.target.closest("[data-pb-combobox] input, [data-pb-command] input") : null;
  if (input) filterOptions(input.closest("[data-pb-combobox], [data-pb-command]"), input.value);
});

on("mousedown", "[data-pb-option]", function (event) { event.preventDefault(); }); // keep focus-within true through the click

on("click", "[data-pb-option]", function (event, option) {
  var wrapper = option.closest("[data-pb-combobox], [data-pb-command]");
  if (wrapper) selectOption(wrapper, option);
});

document.addEventListener("keydown", function (event) {
  var input = event.target.closest ? event.target.closest("[data-pb-combobox] input, [data-pb-command] input") : null;
  if (!input) return;
  var wrapper = input.closest("[data-pb-combobox], [data-pb-command]");
  if (!wrapper) return;
  if (event.key === "ArrowDown") { event.preventDefault(); moveActiveOption(wrapper, 1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); moveActiveOption(wrapper, -1); }
  else if (event.key === "Enter") {
    var active = wrapper.querySelector("[data-pb-option].is-active");
    if (active) { event.preventDefault(); selectOption(wrapper, active); }
  } else if (event.key === "Escape") {
    if (wrapper.tagName === "DIALOG") { wrapper.close(); } else { input.blur(); }
  }
});

// Cmd/Ctrl+K opens the command palette
document.addEventListener("keydown", function (event) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
  var palette = document.querySelector("[data-pb-command]");
  if (!palette || !palette.showModal) return;
  event.preventDefault();
  palette.showModal();
  var input = palette.querySelector("input");
  if (input) input.focus();
});

/* ---------- filter: data-pb-filter="<item selector>" live text filter ---------- */

// <input data-pb-filter=".pb-sidebar-list .pb-nav-link" /> hides every matched
// element whose text doesn't contain the query (design-system.css guarantees
// [hidden] wins over component display rules).
on("input", "[data-pb-filter]", function (event, input) {
  var query = input.value.trim().toLowerCase();
  var items = document.querySelectorAll(input.getAttribute("data-pb-filter"));
  Array.prototype.forEach.call(items, function (item) {
    item.hidden = query !== "" && item.textContent.toLowerCase().indexOf(query) === -1;
  });
});

/* ---------- OTP / PIN input ---------- */

on("input", "[data-pb-otp] input", function (event, input) {
  if (!input.value) return;
  input.value = input.value.slice(-1);
  var next = input.nextElementSibling;
  if (next && next.tagName === "INPUT") next.focus();
});

document.addEventListener("keydown", function (event) {
  var input = event.target.closest ? event.target.closest("[data-pb-otp] input") : null;
  if (!input || event.key !== "Backspace" || input.value) return;
  var prev = input.previousElementSibling;
  if (prev && prev.tagName === "INPUT") { prev.focus(); prev.value = ""; }
});

document.addEventListener("paste", function (event) {
  var input = event.target.closest ? event.target.closest("[data-pb-otp] input") : null;
  if (!input) return;
  var clipboard = event.clipboardData || window.clipboardData;
  var text = clipboard ? clipboard.getData("text").trim() : "";
  if (!text) return;
  event.preventDefault();
  var boxes = input.closest("[data-pb-otp]").querySelectorAll("input");
  var startIndex = Array.prototype.indexOf.call(boxes, input);
  for (var i = 0; i < text.length && startIndex + i < boxes.length; i++) {
    boxes[startIndex + i].value = text.charAt(i);
  }
  boxes[Math.min(startIndex + text.length, boxes.length - 1)].focus();
});

/* ---------- copy button ---------- */

var COPY_RESET_MS = 1500;

function nearestPre(button) {
  var scope = button.parentElement;
  while (scope) {
    var pre = scope.querySelector("pre");
    if (pre) return pre;
    scope = scope.parentElement;
  }
  return null;
}

on("click", "[data-pb-copy]", function (event, button) {
  var selector = button.getAttribute("data-pb-copy");
  var target = selector ? document.querySelector(selector) : nearestPre(button);
  if (!target || !navigator.clipboard) return;
  navigator.clipboard.writeText(target.textContent).then(function () {
    var original = button.textContent;
    button.textContent = "Copied!";
    window.setTimeout(function () { button.textContent = original; }, COPY_RESET_MS);
  });
});
