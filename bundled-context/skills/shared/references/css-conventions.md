# CSS and resource conventions

- One authored `styles/styles.css` per pal, linked once; reuse existing classes before adding one.
- Load each behavior script exactly once as `<script type="module" src="...">`.
- Do not add Bootstrap merely for spacing/layout utilities; write the few layout rules in `styles.css`.

Physical workspace directories are lowercase `styles/`; platform page resource paths use `../Styles/`. The server maps them.
