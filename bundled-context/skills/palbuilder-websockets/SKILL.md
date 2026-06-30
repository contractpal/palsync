---
name: palbuilder-websockets
description: Use this skill whenever a Palbuilder (CloudPiston) pal needs a live, server-push connection to the browser — real-time updates, chat/notifications, streaming progress, or any case where the server must send data to the page without the page asking. Covers the full round-trip: the browser native WebSocket client (a Script, not a workflow), the page wiring, pal.getClientSocketManager().createClientSocket to mint an endpoint, the receiver workflow that runs per inbound message, and pushing to a live socket from any later background job by its socketId. Trigger when calling getClientSocketManager, createClientSocket, getClientSocket, getSockets, socket.sendMessage/getEndpoint, payload.addJavascript to connect a socket, or writing a workflowType-11 message receiver. Companion to palbuilder-jobs-http. Examples are verbatim from the WebSocket reference pal.
---

# WebSockets — Palbuilder Skill

This skill covers **server-push to the browser**: a `ClientSocket` is a live WebSocket the
pal opens to one browser session, then pushes messages into from server-side code — a
console workflow, a message-receiver workflow, or a background job — without the page
polling for them.

> **Companion to `palbuilder-jobs-http`.** Everything there still holds — the receiver
> and the delayed pushers are `workflowType: 11` console-system jobs, and **all workflow
> files obey the ES3 rules from `palbuilder-backend`**: no object literals `{ }`, no
> `let`/`const`, no arrow functions, double-quoted strings, `var` + `UPPER_SNAKE_CASE`.
> This skill adds only the socket APIs.

> **One file here is NOT a workflow.** The browser client (`wstest.js`) is a **Script**
> (`palTypeCommon`), runs in the browser, and uses ordinary modern JS — arrow functions,
> `const`, `setInterval`, the native `WebSocket` object. The ES3 ban applies to the
> **workflow** files only. Don't cross the streams: workflow `.js` = ES3, browser Script
> = normal JS.

> **Verify before trusting.** Workflow JS only truly compiles in the PalBuilder builder.
> Every snippet below is verbatim from the WebSocket reference pal, but re-confirm any API
> you promote to new code in the builder itself.

---

## The architecture in one picture

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

The durable handle is the **socketId**. Anything server-side that has it — the receiver,
or a job scheduled minutes later — can push to that live socket with `sendMessage`.

---

## The four files (`pal.json`)

```json
{ "string": "console.js",  "Workflow": { "filename": "console.js",  "workflowType": 7  } }   // console hub: mints the socket
{ "string": "service.js",  "Workflow": { "filename": "service.js",  "workflowType": 11 } }   // RECEIVER: runs per inbound message
{ "string": "otherJob.js", "Workflow": { "filename": "otherJob.js", "workflowType": 11 } }   // delayed pusher
{ "string": "wstest.js",   "Script":   { "filename": "wstest.js", "palType": "palTypeCommon" } }  // BROWSER client (normal JS)
```

The receiver is also optionally (if default for its type) named in `pal.json` → `layout.consoleSystemWorkflow`.

> **Creating these via push works.** A new workflow or Script is created by writing the file
> **and** appending its `pal.json` entry — `pal_push` ships it (a workflow entry's
> `workflowType` is **required**, or the push is rejected). Verified: the chat example's
> `chatReceiver.js` (type 11) and `chat.js` Script were both created from scratch by a push.
> (Only **documents** and **fonts** are genuinely PalBuilder-only to create.)

---

## 1. Mint the socket — `createClientSocket` (console workflow, type 7)

```js
function openSocket()
{
    var man=pal.getClientSocketManager();
    var socket=man.createClientSocket("service","Demo",true,30);
    payload.addJavascript("setup('"+socket.getEndpoint()+"')");
}
```

`createClientSocket(receiverWorkflow, channel, secure, renewalIncrement)` → `ClientSocket`:

| Arg | Reference value | Meaning |
|---|---|---|
| `receiverWorkflow` | `"service"` | The **console workflow run on each inbound message** (≤255 chars). Omit this arg (3-arg overload) for an **outbound-only** socket that ignores anything the client sends. |
| `channel` | `"Demo"` | Channel name (≤255 chars). Groups sockets so you can enumerate/broadcast — see `getSockets()`. |
| `secure` | `true` | If true, restricts the socket to the **current browser session's IP**. |
| `renewalIncrement` | `30` | **Minutes** each request adds to the socket's life (**max 30**). Idle sockets close after **one minute** — hence the 30s browser ping below. |

**`socket.getEndpoint()`** is the `ws://…`-style URL the browser connects to. Hand it to
the page with `payload.addJavascript("setup('"+socket.getEndpoint()+"')")` — the injected
call runs your client `setup()` on render. (`addJavascript` is the standard payload→browser
JS hook; see `palbuilder-backend`.)

> **You cannot push before the browser connects.** `sendMessage` "requires the socket to be
> registered with the client first through the endpoint." Minting the socket only creates
> the endpoint — the browser must open it before any server push lands.

---

## 2. The browser client — a **Script**, normal JS (`wstest.js`)

Verbatim from the reference. Note arrow functions and `const` — fine here, this is **not** a
workflow.

```js
var ws;
var opened;
var pingInterval;

function setup(wsUrl)
{
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        display("Connected");
        ws.send("Hello World");
        opened = new Date();

        // Keepalive: idle sockets die after ~1 min, so ping every 30s.
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) { ws.send("ping"); }
        }, 30000);
    };

    ws.onmessage = (event) => { display(event.data); };   // server push lands here
    ws.onclose   = () => { display("Closed"); };
    ws.onerror   = (err) => { display("Error"); };
}

function send(el) { ws.send("type:" + el.value); }        // outbound message format is YOUR convention
function ping()   { ws.send("ping"); return false; }      // return false so the c:button doesn't submit
```

- **The 30s ping is mandatory**, not optional. Without it the socket idles out in a minute
  and the receiver/jobs can no longer reach the browser.
- **The message string is an app-level protocol you invent.** Here the client sends
  `"ping"` (keepalive), `"Hello World"` (greeting), and `"type:<text>"` (payload) — and the
  receiver branches on those. Pick a scheme and parse it consistently on the server.

### Page wiring (`console.html`)

```html
<script language="JavaScript" src="../Scripts/wstest.js"></script>
...
<c:button action="openSocket" value="Open Socket"/>
<c:button action="pingSocket" value="Ping Socket" validate="ping()"/>
Type here: <input type="text" name="stuff" onkeyup="send(this)"/>
<div id="body"></div>
```

`validate="ping()"` runs the client handler and, because `ping()` returns `false`, suppresses
the normal action submit — the message goes over the socket instead of round-tripping the page.

---

## 3. The receiver — runs once per inbound message (type 11)

The receiver workflow is invoked **as a job, once for every message the client sends**. It
reads the message from the **job payload**, not from a request:

```js
var c;
function run(controller)
{
    c = controller;
    var data     = c.getJob().getPayload().getData();
    var socketId = data.get("socketId");          // platform supplies the originating socket
    var message  = data.get("message");           // the exact string the browser sent
    var pal      = c.getPal();
    var man      = pal.getClientSocketManager();
    var socket   = man.getClientSocket(socketId); // re-acquire the live socket by id

    if (message.indexOf("type:") >= 0)
    {
        socket.sendMessage(message.split("type:")[1]);   // echo the typed text back
    }
    else
    {
        socket.sendMessage("Howdy from workflow referencing " + data.toJSON());

        // Hand off to a delayed job — forward the SAME payload so it keeps socketId.
        var payload = c.getJob().getPayload();
        payload.set("message", "Hi from the Universe");
        pal.getJobManager().createJob(
            "Other", "otherJob",
            c.getDateUtil().addSeconds(new Date(), 15),   // run 15s from now
            payload);
    }
}
```

- The payload the platform hands the receiver always carries **`socketId`** and **`message`**.
- `man.getClientSocket(socketId)` returns the live `ClientSocket`; `sendMessage(str)` pushes a
  string the browser receives in `ws.onmessage`.
- **`"ping"` needs no handling** — the keepalive's only job is to renew the socket, which the
  request itself does. The receiver can ignore it (the `else` branch here just answers anything
  that isn't `type:`).

---

## 4. Push from a later, detached job (type 11)

Any job holding the socketId can push to the still-open socket — that's how you deliver a
result that finishes seconds/minutes after the user's message:

```js
var c;
function run(controller)
{
    c = controller;
    var data     = c.getJob().getPayload().getData();
    var socketId = data.get("socketId");
    var man      = c.getPal().getClientSocketManager();
    var socket   = man.getClientSocket(socketId);
    socket.sendMessage("WOW!! a message from the other workflow: " + data.toJSON());
}
```

This is the WebSocket payoff over the poll loop in `palbuilder-jobs-http`: instead of the
browser clicking a hidden `c:a` every 4s, the job **pushes** the moment it's done — provided
the socket is still alive (keepalive ping) and was opened by the browser (registered endpoint).

> The delayed job here is the **same `workflowType: 11`** as the receiver, and obeys the
> Monitor/time-budget rules from `palbuilder-jobs-http` if it does real work before pushing.

---

## 5. Broadcast to every socket on a channel — `getSockets()`

`getSockets()` returns a `SystemDataView` of this pal's sockets. Filter it by channel, then
walk the rows and `sendMessage` to each — that's a broadcast. **Verified against the live
server**, including the one non-obvious detail: the id column in this view is **`socketGuid`**
(not `id`), and that value is exactly what `getClientSocket(...)` expects.

```js
function broadcast(channel, text)
{
    var man    = pal.getClientSocketManager();
    var ds     = man.getSockets();
    var filter = ds.createFilter();
    filter.addEqual("channel", channel);
    var list   = ds.getRecords(filter).copy("sockets");   // getRecords(filter).copy(name) -> DataList
    var count  = list.getRecordCount();
    for (var i = 0; i < count; i++)
    {
        var id = list.getRecord(i).get("socketGuid");     // ← id column is "socketGuid"
        man.getClientSocket(id).sendMessage(text);        // delivers to that browser's ws.onmessage
    }
}
```

- **`socketGuid` is the row's id**, and it equals `socket.getId()` / the value `getClientSocket`
  takes. Reading `"id"` returns null — confirmed by testing.
- `getRecords(filter)` must be `.copy("name")`'d into a DataList before you iterate with
  `getRecordCount()` / `getRecord(i)` (standard `palbuilder-backend` DataView calls).
- Only **connected** sockets receive the push — a row exists once minted, but `sendMessage`
  lands only after that browser opened the endpoint, and the row ages out on idle (~60s).
  Wrap the per-socket send in `try/catch` if a stale row in the view shouldn't abort the loop.

---

## 6. Worked example — a multi-user chat room

A full, verified end-to-end chat-room implementation (browser Script + console workflow + type-11
broadcast receiver) lives in **`references/worked-example-chat.md`** — read it when you want a complete
reference for a broadcast/room use case. It composes the primitives above (§1 mint, §3 receiver,
`getChannel()`, §5 `socketGuid` broadcast); nothing new.

---

## Lifecycle & gotchas

- **Idle death in ~60s.** A socket with no traffic closes after about a minute. The 30s
  client ping is what keeps it open; `renewalIncrement` (≤30 min) sets how much each request
  extends it.
- **Push only after connect.** `sendMessage` works only once the browser has opened the
  endpoint. Minting the socket server-side is not enough — sequence is: create → inject
  endpoint → browser connects → then any server push lands.
- **socketId is the cross-process handle.** Pass it forward through every job payload so a
  task that finishes later can still reach the original browser. Don't try to stash the
  `ClientSocket` object itself between invocations — re-acquire it with `getClientSocket(id)`.
- **`secure: true`** ties the socket to the session IP — correct for authenticated console
  pals; reconsider if clients roam between IPs.
- **Invent and parse one message protocol.** The platform doesn't impose a format; the
  string you `ws.send` is the string `data.get("message")` returns. Keep client and receiver
  in agreement (`"ping"`, `"type:..."`, etc.).
- **Delete when you mean it.** `man.deleteClientSocket(socketId)` removes a socket explicitly;
  otherwise it expires on idle.

---

## Quick API index

| Need | Call |
|---|---|
| Get the manager | `pal.getClientSocketManager()` |
| Mint a socket (with receiver) | `man.createClientSocket(receiverWf, channel, secure, renewalMins)` |
| Mint outbound-only socket | `man.createClientSocket(channel, secure, renewalMins)` |
| Endpoint for the browser | `socket.getEndpoint()` → `payload.addJavascript("setup('"+ep+"')")` |
| Re-acquire a live socket | `man.getClientSocket(socketId)` |
| Push to the browser | `socket.sendMessage(str)` → arrives in client `ws.onmessage` |
| List sockets / by channel | `man.getSockets()` → `createFilter().addEqual("channel", name)` → `getRecords(f).copy("sockets")` |
| Broadcast to a channel | iterate the DataList, `getRecord(i).get("socketGuid")` → `getClientSocket(id).sendMessage(text)` |
| Socket metadata | `socket.getId()`, `getChannel()`, `getLastAccess()`, `getMessageCount()`, `getWorker()` |
| Remove a socket | `man.deleteClientSocket(socketId)` |
| Receiver inputs (per message) | `c.getJob().getPayload().getData()` → `get("socketId")`, `get("message")` |
| Push later from a job | `createJob(name, "file.js", addSeconds(now,n), payload)` carrying `socketId` |
| Browser client | Script (normal JS): `new WebSocket(ep)`, `onopen/onmessage/onclose/onerror`, 30s ping |

---

*ClientSocketManager: https://secure.cloudpiston.com/cpal/cp-api/console/ClientSocketManager.html*
*ClientSocket: https://secure.cloudpiston.com/cpal/cp-api/console/ClientSocket.html*
*Console API index: https://secure.cloudpiston.com/cpal/cp-api/console/index.html*
