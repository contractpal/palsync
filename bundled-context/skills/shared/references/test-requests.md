# "Test <console|web|transaction>" requests

How to turn a short test request into tool calls. This is a routing default only; it does not
define what "testing" means beyond that (that definition is still being worked out).

## Which workflow
1. User names one ("test console workflow x") → that workflow: `workflow` + `workflowName`.
2. Otherwise, if this session is working in a specific workflow file of that type (edited or
   discussed it), that is the target. State it and ask once: "Test `xyz`?" — don't guess silently
   when more than one workflow of that type was touched.
3. Otherwise the kind alone ("test console") → `workflow:"console"`, first workflow of that kind.
   Never omit `workflow` for a named kind; auto-detect prefers web and can hit the wrong engine.

Same rules for `web` and `transaction` (`workflow:"transaction"` is the Navigator/packet engine).

## Which action (console / transaction)
- "test console" with no action → `action:"cp-continue"`.
- "test console with action y" → `action:"y"` (`y?key=value` form, or `params`).
- Pass `expect` strings for the screen you target, or the capture stays state-unverified.

## State that needs earlier requests
If the target screen or response only exists after earlier AJAX calls, form fills or clicks (e.g. an
AJAX request that needs two prior ones), do not capture a bare action — it would open a screen
whose state was never built. Replay the prerequisites with `steps` on `pal_screenshot` (or run
`pal_exercise`), then verify the end state with `expect`. See `exercise-authoring.md`.

## Which tools
Default run = render: `pal_screenshot` with `workflow`, `workflowName`, `action`, `expect`
(it compiles via `TestConsole.do` / `TestPal.do` / `TestWeb.do` itself). Add `pal_test` when the
user wants the compile notes. Push first — both test the last-pushed version.
Render rules: `../../pal-review/references/console-render-verification.md`.

## "Test login" / "test login with Bob"
The pal is a WEB pal with a login link that leads to the platform login, then to a console or
transaction workflow. Run it with `pal_exercise` (or `pal_screenshot` with `steps`), `workflow:"web"`:
1. `{click:"<the login link/button text>"}` — find it from the page's visible clickables. If several
   could be the login and you did not build this screen in this session, ask which; otherwise just run.
2. `{login:true}` — signs in as the developer. `{login:true, as:"Bob"}` — signs in as the test
   account aliased "Bob" on this pal's cloud. Add `expect` for the screen you should land on.
- The run always starts from a fresh browser, so the login page always appears.
- You only ever name the alias. Never ask for, read, or type a password or username yourself, and
  never put credentials in `fill`. The tool types them; they are not in any result.
- `No test account exists for '<alias>'.` → say exactly that and stop. Do not guess another alias.
- The step fails with where it landed if the previous step did not reach the platform login (a
  pre-registration page, a pal-built form). Report what you saw and ask; do not improvise a sign-in.
- No web response for the pal (compile fails / no web URL) → report the error; there is nothing to test.
- Tell the user once per session which account the sign-in used (their own, or the test account).
Test accounts are added by the user in the GUI (Manage clouds → Test accounts), never by you.
