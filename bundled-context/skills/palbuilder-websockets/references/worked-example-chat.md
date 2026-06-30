# Worked example — a multi-user chat room (WebSockets)

A full, verified end-to-end example built entirely from the primitives in the skill's SKILL.md. Open
this when you want a complete reference implementation of a broadcast/room use case. Nothing here is new
API — it composes `createClientSocket` (§1), the per-message receiver (§3), `getChannel()`, and the
`socketGuid` broadcast (§5).

Chat is just the round-trip with one twist: the receiver, instead of echoing to the **one** socket that
sent the message, **broadcasts it to every socket on the same channel**. The channel *is* the room.

> Files: a console workflow action (type 7) + `chatReceiver.js` (type 11) + a browser Script
> `chat.js`. **Verified end-to-end against the live server** — two browsers on the same room
> see each other's messages in real time.

## Browser Script — `chat.js` (normal JS)

```js
var ws;

function joinChat(wsUrl)
{
    ws = new WebSocket(wsUrl);
    ws.onopen    = () => {
        setInterval(() => { if (ws.readyState === WebSocket.OPEN) { ws.send("ping"); } }, 30000);
    };
    ws.onmessage = (event) => { appendLine(event.data); };   // every room message lands here
    ws.onclose   = () => { appendLine("[disconnected]"); };
}

function sendChat()
{
    var box = document.getElementById("chatInput");
    ws.send("say:" + box.value);                             // app protocol: "say:<text>"
    box.value = "";
    return false;                                            // REQUIRED: keeps the c:button's validate from submitting
}

function appendLine(text)
{
    var div = document.createElement("div");
    div.textContent = text;
    document.getElementById("chatLog").appendChild(div);
}
```

## Page wiring

```html
<script language="JavaScript" src="../Scripts/chat.js"></script>
...
<c:button action="joinRoom" value="Join"/>
<input type="text" id="chatInput"/>
<c:button action="noop" value="Send" validate="sendChat()"/>   <!-- sendChat() returns false -> stays client-side; message rides the socket -->
<div id="chatLog"></div>
```

## Console workflow (type 7) — open a socket bound to the room's channel

```js
function joinRoom()
{
    var room   = "general";                                  // derive however you pass the room name
    var man    = pal.getClientSocketManager();
    var socket = man.createClientSocket("chatReceiver", "chat-" + room, true, 30);
    payload.addJavascript("joinChat('" + socket.getEndpoint() + "')");
}
```

## Receiver — `chatReceiver.js` (type 11): fan the message out to the room

```js
var c;
function run(controller)
{
    c = controller;
    var pal      = c.getPal();
    var man      = pal.getClientSocketManager();
    var data     = c.getJob().getPayload().getData();
    var socketId = data.get("socketId");
    var message  = data.get("message");

    if (message.indexOf("say:") != 0) { return; }            // ignore "ping" and anything off-protocol

    var text    = message.split("say:")[1];
    var channel = man.getClientSocket(socketId).getChannel(); // the sender's room == the broadcast target
    broadcast(man, channel, text);
}

function broadcast(man, channel, text)
{
    var ds     = man.getSockets();
    var filter = ds.createFilter();
    filter.addEqual("channel", channel);
    var list   = ds.getRecords(filter).copy("sockets");
    var count  = list.getRecordCount();
    for (var i = 0; i < count; i++)
    {
        var id = list.getRecord(i).get("socketGuid");        // verified id column (§5)
        try { man.getClientSocket(id).sendMessage(text); }
        catch (e) { /* stale/closed row still in the view — skip, don't abort the room */ }
    }
}
```

**Why this is chat and not echo:** the receiver runs for the *sender's* message but writes to
*every* socket on `chat-<room>` — including the sender, so their own line shows up the same way
everyone else's does (no local echo needed). Add another browser on the same room and they see
each other's lines in real time.

- **`getChannel()` on the sender's socket** is how the receiver learns which room to fan out to —
  it never has to be told the channel separately.
- **Attribution:** the protocol here is anonymous. To show who said what, send
  `"say:<name>|<text>"` and format on broadcast, or keep a name keyed by `socketGuid`.
- **Rooms = channels.** One channel per room keeps `getSockets()` filtering as your membership
  list; a user in two rooms opens two sockets.
