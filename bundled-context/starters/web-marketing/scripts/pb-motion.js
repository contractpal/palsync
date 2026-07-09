/* pb-motion.js — Pal Builder motion layer (IntersectionObserver + RAF, no deps).
   Loaded once from the page shell as <script type="module" src="..."></script>.
   scan() walks the DOM for data-animate/data-ticker/data-typewriter/data-tilt/
   data-spotlight/data-scroll-progress and wires each element up exactly once
   (guarded by a dataset flag). A MutationObserver re-runs scan() on subtrees
   added by AJAX fragment swaps, so nothing needs a fragment <script> tag; call
   window.pbMotion.scan(root) to scan manually. Under prefers-reduced-motion:
   reduce, everything renders straight to its final state — no animation,
   just correctness. This file avoids template-literal interpolation entirely. */

var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- one shared IntersectionObserver drives every reveal-once effect ---------- */

var revealCallbacks = new WeakMap();
var revealObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (!entry.isIntersecting) return;
    revealObserver.unobserve(entry.target);
    entry.target.classList.add("is-inview");
    var callback = revealCallbacks.get(entry.target);
    if (callback) callback();
  });
}, { threshold: 0, rootMargin: "0px 0px -10% 0px" }); // threshold 0: elements taller than the viewport must still reveal

function watchOnce(el, callback) {
  if (reduceMotion) {
    el.classList.add("is-inview");
    if (callback) callback();
    return;
  }
  if (callback) revealCallbacks.set(el, callback);
  revealObserver.observe(el);
}

/* ---------- data-animate + data-animate-stagger ---------- */

function setupStagger(container) {
  if (container.dataset.pbStaggerReady) return;
  container.dataset.pbStaggerReady = "1";
  var step = parseInt(container.getAttribute("data-animate-stagger"), 10) || 0;
  container.querySelectorAll("[data-animate]").forEach(function (child, index) {
    if (!child.style.transitionDelay) child.style.transitionDelay = (index * step) + "ms";
  });
}

function setupAnimate(el) {
  if (el.dataset.pbAnimateReady) return;
  el.dataset.pbAnimateReady = "1";
  var delay = el.getAttribute("data-animate-delay");
  var duration = el.getAttribute("data-animate-duration");
  if (delay) el.style.transitionDelay = delay + "ms";
  if (duration) el.style.transitionDuration = duration + "ms";
  watchOnce(el);
}

/* ---------- data-ticker: count-up on reveal, prefix/suffix preserved ---------- */

function setupTicker(el) {
  if (el.dataset.pbTickerReady) return;
  el.dataset.pbTickerReady = "1";
  var raw = el.getAttribute("data-ticker") || el.textContent;
  var match = raw.match(/^(\D*)([\d,]+(?:\.\d+)?)(\D*)$/);
  if (!match) return;
  var prefix = match[1], suffix = match[3];
  var target = parseFloat(match[2].replace(/,/g, ""));
  var decimals = (match[2].split(".")[1] || "").length;

  function format(value) {
    var parts = value.toFixed(decimals).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return prefix + parts.join(".") + suffix;
  }

  if (reduceMotion) { el.classList.add("is-inview"); el.textContent = format(target); return; }

  watchOnce(el, function () {
    var duration = 1200;
    var start = null;
    function frame(timestamp) {
      if (start === null) start = timestamp;
      var progress = Math.min((timestamp - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(target * eased);
      if (progress < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  });
}

/* ---------- data-typewriter: pipe-separated phrase list ---------- */

function setupTypewriter(el) {
  if (el.dataset.pbTypewriterReady) return;
  el.dataset.pbTypewriterReady = "1";
  var phrases = (el.getAttribute("data-typewriter") || "").split("|").map(function (s) { return s.trim(); }).filter(Boolean);
  if (!phrases.length) return;
  var loop = el.hasAttribute("data-typewriter-loop");

  var textNode = document.createTextNode("");
  var caret = document.createElement("span");
  caret.className = "pb-typewriter-caret";
  el.textContent = "";
  el.appendChild(textNode);
  el.appendChild(caret);

  if (reduceMotion) { textNode.textContent = phrases[0]; return; }

  var phraseIndex = 0, charIndex = 0, deleting = false;
  function tick() {
    if (!el.isConnected) return; // fragment swapped the element out — stop the timer chain
    var phrase = phrases[phraseIndex];
    var isLastPhrase = phraseIndex === phrases.length - 1;
    charIndex += deleting ? -1 : 1;
    textNode.textContent = phrase.slice(0, charIndex);
    if (!deleting && charIndex === phrase.length) {
      if (isLastPhrase && !loop) return; // done: stay on the final phrase
      window.setTimeout(function () { deleting = true; tick(); }, 1400);
      return;
    }
    if (deleting && charIndex === 0) {
      deleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      window.setTimeout(tick, 300);
      return;
    }
    window.setTimeout(tick, deleting ? 35 : 65);
  }
  tick();
}

/* ---------- data-tilt: 3D tilt on pointer move, fine pointers only ---------- */

var finePointer = window.matchMedia("(pointer: fine)");

function setupTilt(el) {
  if (el.dataset.pbTiltReady || reduceMotion || !finePointer.matches) return;
  el.dataset.pbTiltReady = "1";
  el.addEventListener("mousemove", function (event) {
    var rect = el.getBoundingClientRect();
    var px = (event.clientX - rect.left) / rect.width - 0.5;
    var py = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = "perspective(800px) rotateX(" + (py * -8) + "deg) rotateY(" + (px * 8) + "deg)";
  });
  el.addEventListener("mouseleave", function () { el.style.transform = ""; });
}

/* ---------- data-spotlight: tracks the pointer into --x/--y for the CSS to read ---------- */

function setupSpotlight(el) {
  if (el.dataset.pbSpotlightReady || reduceMotion) return;
  el.dataset.pbSpotlightReady = "1";
  el.addEventListener("mousemove", function (event) {
    var rect = el.getBoundingClientRect();
    el.style.setProperty("--x", (event.clientX - rect.left) + "px");
    el.style.setProperty("--y", (event.clientY - rect.top) + "px");
  });
}

/* ---------- data-scroll-progress ---------- */

var progressBars = [];
var progressListening = false;

function updateScrollProgress() {
  var doc = document.documentElement;
  var scrollable = doc.scrollHeight - doc.clientHeight;
  var width = (scrollable > 0 ? (doc.scrollTop / scrollable) * 100 : 0) + "%";
  progressBars = progressBars.filter(function (el) { return el.isConnected; });
  progressBars.forEach(function (el) { el.style.width = width; });
}

function setupScrollProgress(el) {
  if (el.dataset.pbScrollProgressReady) return;
  el.dataset.pbScrollProgressReady = "1";
  progressBars.push(el);
  updateScrollProgress();
  if (reduceMotion || progressListening) return;
  progressListening = true; // one document-level pair serves every bar, incl. swapped-in ones
  document.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);
}

/* ---------- scan + wire-up, including newly-added AJAX fragments ---------- */

function collect(root, selector) {
  var result = root.matches && root.matches(selector) ? [root] : [];
  return result.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
}

function scan(root) {
  root = root || document;
  collect(root, "[data-animate-stagger]").forEach(setupStagger);
  collect(root, "[data-animate]").forEach(setupAnimate);
  collect(root, "[data-ticker]").forEach(setupTicker);
  collect(root, "[data-typewriter]").forEach(setupTypewriter);
  collect(root, "[data-tilt]").forEach(setupTilt);
  collect(root, "[data-spotlight]").forEach(setupSpotlight);
  collect(root, "[data-scroll-progress]").forEach(setupScrollProgress);
}

scan(document);

new MutationObserver(function (mutations) {
  mutations.forEach(function (mutation) {
    mutation.addedNodes.forEach(function (node) {
      if (node.nodeType === 1) scan(node);
    });
  });
}).observe(document.body, { childList: true, subtree: true });

window.pbMotion = { scan: scan };
