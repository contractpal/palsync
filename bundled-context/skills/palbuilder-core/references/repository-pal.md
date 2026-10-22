# Repository Pals

A **repository pal** keeps each file's content in its own server row instead of inside the pal, so
it can be very large (images, Word attachments, hundreds of files). Other pals attach to a
repository and reach its files through their chain. palsync therefore never downloads one
wholesale: you pull its **structure**, fetch the individual files you need, and push only the files
you changed.

## Recognise it

- `pal_pull` ends with a **REPOSITORY PAL** note.
- Its files (pages, fragments, images, attachments, and possibly workflows) are **0-byte
  placeholders** until you fetch them, and `pal.json` lists them all.
- A repository can also show up as a chain member of the pal you're editing — see the last section.

## An empty file is not empty content

A placeholder means "not downloaded", never "empty on the server". Do not conclude a file is blank,
do not write its content from memory or from scratch, and do not push a replacement for a file you
have not read. Names are always known (`pal.json`, `.resources/`); contents are fetched on demand.

## Read or edit a file: `pal_repo_fetch`

- **One file per call needs no approval.** Pass its `type` and exact `file` name from `pal.json`.
- **More than one file is the developer's decision.** Ask how many and which, then call again with
  exactly those files and `askedUser:true`. Never fetch "all"; never batch to save calls. The tool
  refuses unattested batches and stops at the workspace's per-call file and byte limits.
- **Sizes are unknown until downloaded**, and attachments/images can be megabytes. When many files
  are involved, ask the developer when and how fast to retrieve them.
- A file you already have, or have edited, is never overwritten by a fetch.
- Images, Word files and other binaries are bytes, not text: don't open them as text, and only edit
  one if you can do so faithfully — otherwise ask.

## Edit, add, delete

- **Edit:** change the local file after fetching it.
- **Add:** create the file **and** its `pal.json` entry (copy an existing entry's shape).
- **Delete:** remove the file **and** its `pal.json` entry. Removing only the file is read as "not
  downloaded" and deletes nothing on the server.
- **Rename:** it is a delete plus an add, so the renamed file's full content is sent.

## Push sends only your edits

`pal_push` sends a per-file change list: files you edited or added carry their bytes, deleted files
are removed, and **everything else — including placeholders and unedited fetched files — is left
untouched on the server.** It needs a pull baseline; with none it refuses, so `pal_pull` first.
`pal_pull` ("get latest") never overwrites a file you edited, but it does turn unedited fetched
files back into placeholders — fetch them again if you need them.

## Things that can surprise you

- The server normalizes page and fragment HTML on save (for example it drops text placed after
  `</html>`), so a file can differ slightly from what you pushed. Make test edits inside `<body>`.
- Validation sees only this pal. A repository's own pages may reference actions that are handled by
  the pal that attaches the repository, so `actionRouted` can fire for them. If it blocks a push,
  tell the developer; don't invent a handler to silence it.
- Do not edit under `.resources/`; that is read-only chain context, not part of this pal.

## A repository in `.resources/` (a chain member)

Only workflows carry content there; every other file is a 0-byte placeholder, but its **name**
is enough for validation to confirm it exists. When you need a file's content, read just that one
with `pal_resources` (`pal`, `type`, `file`) — a repository is never fetched whole through
`pal_resources`. The same rule applies: one file is fine, a batch needs the developer's say-so.
(An *ordinary* chain pal is different: it is small, and `pal_resources` fetches it whole in one call.)
CloudPiston Resource (Cloud and Root) are not chain members but resources visible to every pal, and
they arrive complete: there is nothing to request (see `pal-chain.md`).
