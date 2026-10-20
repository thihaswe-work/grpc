# gRPC — From Zero to Working Code

A complete, runnable gRPC project in Node.js with all four RPC patterns.

```bash
npm install
npm run server   # terminal 1
npm run client    # terminal 2
```

---

## 1. What gRPC Actually Is

gRPC is an **RPC framework**: instead of you building URLs, serializing JSON, and
parsing responses, you call a function on a client and the *framework* makes it
execute on the server.

```
You write:            client.SayHello({name: "Ada"}, cb)
What happens:         "Ada" → protobuf bytes → HTTP/2 → server → bytes → object → your callback
```

**The three ingredients:**

| Piece | File | Job |
|---|---|---|
| Contract | `proto/greeter.proto` | Defines services + message shapes. Both sides agree on this. |
| Server | `src/server.js` | Implements the contract, listens on a port. |
| Client | `src/client.js` | Stubs that look like local functions. |

---

## 2. The `.proto` File — the Contract

Everything starts here. This file is **language-neutral**: the same file generates
Go, Python, Java, Swift, and JS code that all can talk to each other.

```proto
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloResponse);
}

message HelloRequest {
  string name = 1;
}
```

### The two things you define

- **`service`** — a collection of RPC methods (like an interface).
- **`message`** — a data structure (like a class/struct). Replaces JSON objects.

### The numbers are the important part

```proto
string name = 1;      // field NUMBER = 1
string text = 2;      // field NUMBER = 2
```

That `1` is **not** a default value or an index. It is the field's permanent wire
identifier. Protobuf encodes `name=1` as a tiny tag byte, not as the string
`"name"`.

**Why this matters:**
- Encoding is compact and fast (no keys repeated in every message).
- You can add new fields (`string email = 3;`) without breaking old clients —
  old clients simply ignore unknown fields.
- You can **never renumber or reuse** a field number. That's the #1 protobuf sin.

### field numbers → wire format

JSON:  `{"name": "Ada", "age": 30}` ≈ 27 bytes, keys sent every time
Proto: `field 1, len 3, "Ada"` + `field 2, varint 30` ≈ 9 bytes, keys sent never

---

## 3. The Four RPC Patterns

This is the core of gRPC. Everything else is detail.

### Pattern 1 — Unary (regular request/response)

```
Client  ──request──►  Server
Client  ◄─response──  Server
```

```js
// server
function sayHello(call, callback) {
  callback(null, { message: `Hello, ${call.request.name}!` });
}

// client
client.SayHello({ name: 'Ada' }, (err, res) => console.log(res.message));
```

Exactly one in, exactly one out. Like a normal function call over the network.
Use for: lookups, commands, most everyday calls.

### Pattern 2 — Server Streaming

```
Client  ──request──►  Server
Client  ◄── event ──  Server
Client  ◄── event ──  Server
Client  ◄── event ──  Server   (then stream closes)
```

```js
// server — write many, then end()
function countDown(call) {
  let n = call.request.from;
  const t = setInterval(() => {
    if (n < 0) { clearInterval(t); return call.end(); }
    call.write({ remaining: n-- });
  }, 300);
}

// client — read until 'end'
const stream = client.CountDown({ from: 5 });
stream.on('data', (e) => console.log(e.remaining));
stream.on('end', () => console.log('done'));
```

Use for: live feeds, progress updates, large result sets you don't want to load
at once, event subscriptions.

### Pattern 3 — Client Streaming

```
Client  ── chunk ──►  Server
Client  ── chunk ──►  Server
Client  ── chunk ──►  Server
Client  ─── end ───►  Server
Client  ◄─response─  Server        (one response at the very end)
```

```js
// server — read until 'end', then callback
function sumNumbers(call, callback) {
  let total = 0;
  call.on('data', (c) => total += c.value);
  call.on('end', () => callback(null, { total }));
}

// client — write everything, then end()
const stream = client.SumNumbers((err, res) => console.log(res.total));
[3,1,4,1,5].forEach(v => stream.write({ value: v }));
stream.end();   // ← tells the server you're done
```

Use for: batch uploads, bulk inserts, aggregating telemetry before replying.

### Pattern 4 — Bidirectional Streaming

```
Client  ── msg ──►  Server
Client  ◄── msg ──  Server      both happen at once,
Client  ── msg ──►  Server      no fixed ordering between them
Client  ◄── msg ──  Server
```

```js
// server — no callback; you own the stream
function chat(call) {
  call.on('data', (msg) => call.write({ user: 'server', text: 'ack' }));
  call.on('end', () => call.end());
}

// client
const stream = client.Chat();
stream.on('data', (m) => console.log(m));
stream.write({ user: 'alice', text: 'hi' });
stream.end();
```

Use for: chat, collaborative editing, proxies, real-time games, live dashboards.

### Which one? Decision rule

| Question | Pattern |
|---|---|
| One result, now? | Unary |
| One in, many out over time? | Server streaming |
| Many in, one aggregate result? | Client streaming |
| Ongoing conversation, both directions? | Bidi |

---

## 4. Why gRPC Instead of REST?

| | REST + JSON | gRPC |
|---|---|---|
| Contract | Docs (OpenAPI) — can drift | `.proto` — enforced by generated code |
| Payload | JSON, text, verbose | Protobuf, binary, compact |
| Transport | HTTP/1.1 | HTTP/2 (multiplexed — many calls on one connection) |
| Streaming | Awkward (SSE/websockets) | Built in, first-class |
| Types | Yours to guess | Generated, checked at compile time |
| Browser support | Native | Needs a proxy (grpc-web / Envoy) — **this is the main tradeoff** |

**Honest guidance:** gRPC shines for **service-to-service** traffic inside your
backend. For public browser-facing APIs, REST/JSON or tRPC/GraphQL is usually
simpler. Many systems use both: gRPC internally, REST at the edge.

---

## 5. How a Call Actually Travels

```
1. You call        client.SayHello({name:"Ada"}, cb)
2. Serialize       object → protobuf binary bytes
3. Envelope        bytes wrapped in a gRPC frame:
                   1 byte compressed-flag + 4 bytes length + payload
4. Multiplex       over a single long-lived HTTP/2 connection,
                   tagged with a stream ID (that's the "2" in HTTP/2)
5. Path            POST /greeter.Greeter/SayHello   ← the method address
6. Server          dispatches on path → your handler runs
7. Deserialize     bytes → object → call.request.name === "Ada"
8. Reply           callback(null, {...}) → same trip back
9. Callback        your client callback fires
```

Three things make this fast:
1. **Binary encoding** — no parsing, no repeated keys.
2. **HTTP/2 multiplexing** — no new TCP/TLS handshake per call, no head-of-line blocking.
3. **Generated stubs** — zero serialization glue code you write by hand.

---

## 6. Errors in gRPC

gRPC does **not** use HTTP status codes. It has its own:

| Code | Meaning | Example |
|---|---|---|
| `OK (0)` | Success | — |
| `INVALID_ARGUMENT (3)` | Bad input, client's fault | negative `from` |
| `NOT_FOUND (5)` | Resource missing | user id 999 |
| `PERMISSION_DENIED (7)` | Auth failed | no token |
| `UNAVAILABLE (14)` | Server down/unreachable | connection refused |
| `INTERNAL (13)` | Server bug | unhandled exception |
| `DEADLINE_EXCEEDED (4)` | Took too long | client set a timeout |

```js
// server — return an error instead of a result
function sayHello(call, callback) {
  if (!call.request.name) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: 'name is required',
    });
  }
  callback(null, { message: 'Hi' });
}

// client — inspect it
client.SayHello({}, (err, res) => {
  if (err) {
    console.log(err.code === grpc.status.INVALID_ARGUMENT); // true
  }
});
```

---

## 7. Deadlines, Retries, Metadata

```js
// DEADLINE — always set one, or a hung server hangs your client forever.
const deadline = new Date(Date.now() + 5000);
client.SayHello({ name: 'Ada' }, { deadline }, cb);
// → err.code === grpc.status.DEADLINE_EXCEEDED after 5s

// METADATA — gRPC's version of HTTP headers (auth tokens, tracing ids).
const md = new grpc.Metadata();
md.set('authorization', 'Bearer xyz');
client.SayHello({ name: 'Ada' }, md, cb);

// server reads it
function sayHello(call, callback) {
  const token = call.metadata.get('authorization');
  ...
}
```

---

## 8. Project Map

```
grpc-demo/
├── proto/
│   └── greeter.proto      ← the contract (start here always)
├── src/
│   ├── loader.js          ← loads .proto into JS (no protoc binary needed)
│   ├── server.js          ← 4 handlers, one per pattern
│   └── client.js          ← 4 callers, one per pattern
├── package.json
└── README.md
```

`src/loader.js` uses `@grpc/proto-loader`, which reads the `.proto` at runtime.
The alternative is `protoc` — a compiler that generates static `.js`/`.ts` files.
Runtime loading is easier to learn; codegen is better for large teams because you
get real TypeScript types and compile-time errors.

---

## 9. Where To Go Next

1. **Add an endpoint** — add an `rpc` to the `.proto`, implement it in `server.js`, call it in `client.js`. You now know the full loop.
2. **Generate real types** — run `protoc` (or `buf`) to emit TypeScript interfaces.
3. **Add auth** — put a bearer token in metadata, validate it in an interceptor.
4. **Interceptors** — gRPC's middleware: logging, metrics, retries, tracing.
5. **Deadlines everywhere** — the single best production practice.
6. **Reflection** — enable `grpc reflection` so tools like `grpcurl` can call your server without the `.proto`:
   ```bash
   grpcurl -plaintext localhost:50051 greeter.Greeter/SayHello \
     -d '{"name":"Ada"}'
   ```

---

## Cheat Sheet

```proto
rpc Unary(A) returns (B);
rpc ServerStream(A) returns (stream B);
rpc ClientStream(stream A) returns (B);
rpc Bidi(stream A) returns (stream B);
```

```js
// server handler signatures
(call, callback) => {}      // unary + client-streaming
(call) => {}                // server-streaming + bidi

// stream events
stream.on('data', fn)       // message arrived
stream.write(obj)           // send a message
stream.end()                // I'm done sending
stream.on('end', fn)        // other side finished
stream.on('error', fn)      // something broke
stream.on('cancelled', fn)  // caller went away
```
