# CSS and resource conventions

- Link optional `styles/spacing.css` before authored `styles/styles.css`.
- Load each behavior script exactly once as `<script type="module" src="...">`.
- Do not add Bootstrap merely for spacing/layout utilities; `spacing.css` replaces its container, row, column, margin, padding, gap, and flex helpers.

Physical workspace directories are lowercase `styles/`; platform page resource paths use `../Styles/`. The server maps them.
