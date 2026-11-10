# GOAL — service_requests

status: approved by the user
pal: service_requests (console + transaction) @ <WORKSPACE — set by evaluator before run>

## Outcome

A support desk tool. Staff log a service request for a customer in a console. Each request
creates a PalBuilder transaction that the customer opens from its transaction link to confirm
that the problem is resolved. Staff can see every request and its state, filter by status,
cancel an open request, and see when the customer completed it.

## Acceptance checks

The build is done when all of these are true on the pushed pal:

1. **Create.** `New request` opens a form with `Customer email` and `Description`.
   `Create request` with valid values adds an `Open` request to the list, and a live
   transaction exists for it.
2. **Email is checked.** An empty or invalid email shows `Enter a valid customer email.` and
   creates no request and no transaction.
3. **Description is required.** An empty description shows `Description is required.` and
   creates no request and no transaction.
4. **Filter.** A `Status` filter with `Open`, `Completed`, `Cancelled`, and `All` and a
   `Filter` button limits the list to that status.
5. **Detail.** A row's `View` shows the request: status, description, created time, completed
   time, resolution note, and the state of its transaction.
6. **Cancel.** `Cancel request` on an open request makes it `Cancelled` and cancels its
   transaction. Requests that are not open do not offer `Cancel request`.
7. **Customer completion.** The transaction page has the heading
   `Confirm your service request`, shows the request description, has an optional
   `Resolution note (optional)` field, and a `Confirm complete` button. After the customer
   confirms, the page shows `Thank you — your request is marked complete.`, and in the console
   the request is `Completed` with the note and the completed time.
8. **Empty list.** With no matching requests, the list shows `No service requests found.`
9. **Quality.** The console and the transaction page look like a clean, professional tool on
   desktop and mobile. `pal_validate` has 0 errors, and the console and transaction workflows
   both compile with 0 notes.

## Fixed contracts (the user requires these exact names and words)

- One console page for staff and one transaction page for the customer.
- Dataset `serviceRequests` with fields `requestId` (primary key), `customerEmail`,
  `description`, `status` (`open`, `completed`, or `cancelled`), `txId` (the transaction id),
  `resolutionNote`, `createdAt`, `completedAt`.
- Form inputs are named after their fields: `customerEmail`, `description`, `resolutionNote`.
  The status filter input is named `status`.
- The list heading is `Service requests`. Status shows as `Open`, `Completed`, or `Cancelled`.
- Button and link words: `New request`, `Create request`, `Cancel`, `Filter`, `View`,
  `Cancel request`, `Confirm complete`.

## Constraints

- Use the PalBuilder transaction API for transactions. Check the bundled skills and docs for
  the real method names; do not invent them.
- Never use ClientPal or `fetch`, and never add pages beyond the two above.
- Never mark a request completed without updating its `serviceRequests` row.

## Non-goals

- Email delivery, transaction expiry, duplicate-request detection, or user accounts.

## How to work

Nobody is available to answer questions during this build. Decide with your best judgment and
record important decisions in `NOTES.md`.
