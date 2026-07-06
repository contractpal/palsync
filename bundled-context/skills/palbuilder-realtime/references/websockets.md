# WebSockets — Live Server-Push

A **ClientSocket** is a live WebSocket the pal opens to a single browser session. Once open,
server-side code can push messages to the browser through it — from a console workflow, a
message-receiver workflow, a delayed job, or any code that holds the `socketId`.

Companion:
- `../SKILL.md` — when to use WebSockets vs alternatives
- `jobs.md` — the receiver and any delayed pushers are `workflowType: 11` job workflows
- `progress-ui.md` — the combined job + WebSocket progress pattern

---

## Architecture in one picture

```
browser (Script: native WebSocket)
   │  1. page action "openSocket"
   ▼
console workflow (type 7)  ── createClientSocket(receiver, channel, secure, renewal)
   │                            └─ payload.addJavascript("setup('"+socket.getEndpoint()+"')")
   ▼
browser connects to the endpoint, then ws.send(...) ─┐
                                                      ▼
receiver workflow (type 11)  ── runs ONCE PER INBOUND MESSAGE, as a job
   │  reads job payload: socketId + message
   │  man.getClientSocket(socketId).sendMessage(...)  ── push back to the browser
   │  (optionally) createJob(... +15s ...) forwarding socketId
   ▼
delayed job (type 11)  ── getClientSocket(socketId).sendMessage(...)  ── push later, detached
```

The durable handle is the **`socketId`**. Anything server-side that has it — the receiver,
or a job scheduled minutes later — can push to the same live socket.

---

## The four files

A minimal WebSocket setup involves four files (three workflows + one browser Script):

```json
{ "string": "console.js", "Workflow": { "filename": "console.js", "workflowType": 7  } }   // hub: mints the socket
{ "string": "service.js", "Workflow": { "filename": "service.js", "workflowType": 11 } }   // RECEIVER: runs per inbound message
{ "string": "otherJob.js","Workflow": { "filename": "otherJob.js","workflowType": 11 } }   // delayed pusher (optional)
{ "string": "wstest.js",  "Script":   { "filename": "wstest.js", "palType": "palTypeCommon" } }  // BROWSER client
```

The browser Script is what makes this different from every other WebSocket-less workflow.
See the ES3 note below.

---

## Two JavaScript worlds — the ES3 boundary

- **Workflow files** (`.js` under `workflows/`) run through CloudPiston's restricted
  ES3-style engine — no object literals, no `let`/`const`, no arrow functions. CLAUDE.md
  rule 6.
- **Browser Scripts** (`.js` under `scripts/`) run in the browser — arrow functions,
  `const`, `setInterval`, native `WebSocket`, all fine.

The two files that talk to each other over the socket obey different rules. Don't cross the
streams: workflow `.js` = ES3, browser Script = normal JS.

---

## 1. Mint the socket — `createClientSocket` (console workflow)

```js
function openSocket() {
    var man    = pal.getClientSocketManager();
    var socket = man.createClientSocket("service", "Demo", true, 30);
    payload.addJavascript("setup('" + socket.getEndpoint() + "')");
}
```

`createClientSocket(receiverWorkflow, channel, secure, renewalIncrement)` returns a
`ClientSocket`:

| Arg | Example | Meaning |
|---|---|---|
| `receiverWorkflow` | `"service"` | Workflow file name that runs on each inbound message (≤255 chars). Omit for the **3-arg overload** — outbound-only socket that ignores anything the client sends. |
| `channel` | `"Demo"` | Channel name (≤255 chars). Groups sockets so you can enumerate/broadcast — see `getSockets()` below. |
| `secure` | `true` | If true, restricts the socket to the current browser session's IP. |
| `renewalIncrement` | `30` | **Minutes** each request adds to the socket's life (**max 30**). Idle sockets close after **one minute** — hence the 30s browser ping below. |

**`socket.getEndpoint()`** is the `ws://…`-style URL the browser connects to. Hand it to
the page via `payload.addJavascript("setup('" + socket.getEndpoint() + "')")` — the injected
call runs your client's `setup()` function on render.

**You cannot push before the browser connects.** `sendMessage` "requires the socket to be
registered with the client first through the endpoint." Minting only creates the endpoint —
the browser must open it before any server push lands.

---

## 2. The browser client — a Script, normal JS

This runs in the browser. **Not** a workflow — modern JS is allowed.

```js
var ws;
var pingInterval;

function setup(wsUrl) {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        display("Connected");
        ws.send("Hello World");

        // Keepalive: idle sockets die after ~1 minute, so ping every 30s.
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) { ws.send("ping"); }
        }, 30000);
    };

    ws.onmessage = (event) => { display(event.data); };   // server push lands here
    ws.onclose   = () => { display("Closed"); };
    ws.onerror   = (err) => { display("Error"); };
}

function send(el) { ws.send("type:" + el.value); }
function ping()   { ws.send("ping"); return false; }     // return false so c:button doesn't submit
```

**The 30-second ping is mandatory, not optional.** Without it the socket idles out in a
minute and the receiver/jobs can no longer reach the browser.

**The message string is an app-level protocol you invent.** Pick a scheme (`"ping"`,
`"type:<text>"`, `"say:<text>"`) and branch on it in the receiver.

### Page wiring

```html
<script language="JavaScript" src="../Scripts/wstest.js"></script>
...
<c:button action="openSocket" value="Open Socket"/>
<c:button action="pingSocket" value="Ping Socket" validate="ping()"/>
Type here: <input type="text" name="stuff" onkeyup="send(this)"/>
<div id="body"></div>
```

`validate="ping()"` runs the client handler and, because `ping()` returns `false`, suppresses
the normal action submit — the message goes over the socket instead of round-tripping the
page. See `palbuilder-frontend` for `c:button` and `validate` details.

---

## 3. The receiver — runs once per inbound message

The receiver is a `workflowType: 11` workflow invoked as a job **once for every message the
client sends**. It reads the message from the **job payload**, not from a request:

```js
var c;

function run(controller) {
    c = controller;
    var jobData  = c.getJob().getPayload().getData();
    var socketId = jobData.get("socketId");            // platform supplies the originating socket
    var message  = jobData.get("message");             // the exact string the browser sent
    var pal      = c.getPal();
    var man      = pal.getClientSocketManager();
    var socket   = man.getClientSocket(socketId);      // re-acquire the live socket by id

    if (message.indexOf("type:") >= 0) {
        socket.sendMessage(message.split("type:")[1]);   // echo the typed text back
    } else {
        socket.sendMessage("Howdy from workflow referencing " + jobData.toJSON());

        // Hand off to a delayed job — forward the SAME payload so it keeps socketId.
        var payload = c.getJob().getPayload();
        payload.set("message", "Hi from the Universe");
        pal.getJobManager().createJob(
            "Other",
            "otherJob",
            dateUtil.addSeconds(dateUtil.createDate(), 15),
            payload
        );
    }
}
```

Key mechanics:

- The **payload always carries `socketId` and `message`** — the platform supplies both.
- **`man.getClientSocket(socketId)`** returns the live `ClientSocket`; `sendMessage(str)`
  pushes a string the browser receives in `ws.onmessage`.
- **`"ping"` needs no handling** — the keepalive's only job is to renew the socket, which
  the receiver invocation itself does. The receiver can ignore or answer as suits.

---

## 4. Push from a later, detached job

Any job holding the `socketId` can push to the still-open socket — that's how you deliver a
result that finishes seconds/minutes after the user's message:

```js
var c;

function run(controller) {
    c = controller;
    var jobData  = c.getJob().getPayload().getData();
    var socketId = jobData.get("socketId");
    var man      = c.getPal().getClientSocketManager();
    var socket   = man.getClientSocket(socketId);
    socket.sendMessage("Result delivered: " + jobData.toJSON());
}
```

This is the WebSocket payoff over the self-polling fragment pattern in `progress-ui.md`:
instead of the browser clicking a hidden `c:a` every 4s, the job **pushes** the moment it's
done — provided the socket is still alive (keepalive ping) and was opened by the browser
(registered endpoint).

The delayed job is the **same `workflowType: 11`** as the receiver and obeys the Monitor
time-budget rules from `jobs.md` if it does substantial work before pushing.

---

## 5. Broadcast to every socket on a channel — `getSockets()`

`getSockets()` returns a `SystemDataView` of the pal's sockets. Filter it by channel, then
walk the rows and `sendMessage` to each — that's a broadcast.

```js
function broadcast(channel, text) {
    var man    = pal.getClientSocketManager();
    var ds     = man.getSockets();
    var filter = ds.createFilter();
    filter.addEqual("channel", channel);
    var list   = ds.getRecords(filter, "sockets");    // DataList
    var count  = list.getRecordCount();
    for (var i = 0; i < count; i++) {
        var id = list.getRecord(i).get("socketGuid");  // ← id column is "socketGuid"
        try {
            man.getClientSocket(id).sendMessage(text);
        } catch (e) {
            // Stale row in the view — ignore and keep broadcasting
        }
    }
}
```

Two verified details:

- **The id column is `socketGuid`, not `id`.** Reading `"id"` returns null. `socketGuid`
  equals `socket.getId()` and is what `getClientSocket(...)` accepts.
- **Only connected sockets receive the push.** A row exists once the socket is minted, but
  `sendMessage` only lands after the browser has opened the endpoint, and the row ages out
  after ~60 seconds of inactivity. Wrap the per-socket send in try/catch so a stale row
  doesn't abort the loop.

---

## The chat-room pattern — broadcast, applied

Multi-user chat is just the round-trip with a twist: the receiver, instead of echoing to
the **one** socket that sent the message, **broadcasts it to every socket on the same
channel**. The channel *is* the room.

Files: a console workflow action (type 7) + a chat receiver (type 11) + a browser Script.
The chat room is composed entirely from the primitives above — `createClientSocket` (§1),
per-message receiver (§3), and the `socketGuid` broadcast (§5). No new API needed.

The pattern:

- Console workflow opens the socket with `channel = "chat-" + roomName`
- Browser sends messages tagged `"say:<text>"`
- Receiver strips the prefix and broadcasts to every socket in the channel
- Every connected client's `ws.onmessage` fires with the message

---

## Common gotchas

- **The 30-second ping is not optional.** Without it, idle sockets die after ~1 minute and
  the server can no longer reach the browser. Bake the ping into `ws.onopen`.
- **`sendMessage` before the browser connects silently no-ops.** Minting the socket creates
  the endpoint; the browser must actually open it before any push lands.
- **Two ES3 worlds** — workflow files obey ES3; browser Scripts don't. Don't apply the ES3
  rules to `scripts/*.js`, and don't put arrow functions in workflow files.
- **`socketGuid`, not `id`.** For enumerating sockets from `getSockets()`.
- **Stale sockets in the enumeration view.** Rows age out but not instantly. Wrap
  broadcast sends in try/catch.
- **`payload.addJavascript` is the standard payload → browser JS hook** — used here to
  invoke the client's `setup()` with the endpoint. See `palbuilder-frontend` for other
  payload-to-JS patterns.
- **The receiver is a job**, so its payload is `c.getJob().getPayload()` — not
  `c.getRequest()`. See `jobs.md` for the type-11 entry contract.
