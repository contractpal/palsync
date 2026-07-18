# Shared UI acceptance

- [ ] `styles/styles.css` is present, registered, linked once, human-readable, and contains only
      dependency-complete tokens, base rules, and component recipes used by current markup.
- [ ] `spacing.css`, `pb-ui.js`, and `pb-motion.js` exist only with real consumers and each is
      registered/loaded once; unused utilities, presets, themes, components, and scripts are absent.
- [ ] No undefined classes: each page/fragment `class=` resolves to runtime CSS or a recorded local style.
- [ ] Typography uses the recorded system/Fontshare policy; icons are inline SVG from one approved family;
      scripted motion uses only `pb-motion.js` data attributes.
- [ ] Direction was checked against [anti-slop fingerprints](anti-slop.md).
