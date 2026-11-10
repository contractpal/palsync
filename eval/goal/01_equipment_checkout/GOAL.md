# GOAL — equipment_checkout

status: approved by the user
pal: equipment_checkout (console) @ <WORKSPACE — set by evaluator before run>

## Outcome

An office manager tracks shared equipment (laptops, projectors, cameras) in a console tool.
They can add, edit, and delete items, check an item out to a person, and check it back in.
At a glance they can see what is out and who has it.

## Acceptance checks

The build is done when all of these are true on the pushed pal:

1. **Add.** `Add equipment` opens a form with Name, Category, and Notes. `Save` adds the item,
   and the list shows it.
2. **Name is required.** `Save` with an empty name shows `Name is required.` and adds nothing.
3. **Check out.** A row's `Check out` asks who takes the item. After `Check out`, the list shows
   that person's name on the row, and the item is not available.
4. **Assignee is required.** `Check out` with an empty name shows
   `Enter a name to check this item out.` and the item stays available.
5. **Check in.** A checked-out row's `Check in` makes the item available again, and the
   person's name no longer shows on the row.
6. **Edit.** A row's `Edit` opens the form with the item's values. `Save` updates the row and
   keeps its checkout state.
7. **Delete.** A row's `Delete` asks `Delete this item? This cannot be undone.` before it
   deletes. After confirmation, the row is gone.
8. **Empty list.** With no items, the list shows
   `No equipment yet. Add your first item to get started.`
9. **Quality.** The screens look like a clean, professional internal tool on desktop and
   mobile. `pal_validate` has 0 errors and the console workflow compiles with 0 notes.

## Fixed contracts (the user requires these exact names and words)

- One console page. Everything happens on it.
- Dataset `equipment` with fields `equipmentId` (primary key), `name`, `category`, `notes`,
  `status` (`available` or `checkedOut`), `checkedOutTo`, `checkedOutAt`.
- Form inputs are named after their fields: `name`, `category`, `notes`, `checkedOutTo`.
- Button and link words: `Add equipment`, `Save`, `Cancel`, `Edit`, `Check out`, `Check in`,
  `Delete`. The list heading is `Equipment`.
- The list has a column `Checked out to`.

## Constraints

- Never create other pages, datasets, web workflows, jobs, sockets, ClientPal calls, or `fetch`.
- Delete is a hard delete.

## Non-goals

- Checkout history, due dates, reminders, search, or user accounts.
- Edge cases beyond the checks above (duplicate names, concurrent edits).

## How to work

Nobody is available to answer questions during this build. Decide with your best judgment and
record important decisions in `NOTES.md`.
