import grpc from '@grpc/grpc-js';
import { greeterPackage } from './loader.js';

const server = new grpc.Server();

// ------------------------------------------------------------
// UNARY — one request, one response.
// `call` holds the request, `callback` sends the reply.
// ------------------------------------------------------------
function sayHello(call, callback) {
  const name = call.request.name || 'world';
  console.log(`[unary]   SayHello("${name}")`);
  callback(null, { message: `Hello, ${name}! (from gRPC)` });
}

// ------------------------------------------------------------
// SERVER STREAMING — one request, many responses.
// We write to `call` and then `call.end()` to close the stream.
// ------------------------------------------------------------
function countDown(call) {
  const from = call.request.from ?? 5;
  console.log(`[server]  CountDown(${from})`);
  let remaining = from;

  const timer = setInterval(() => {
    if (remaining < 0) {
      clearInterval(timer);
      call.end();
      return;
    }
    call.write({ remaining, at: new Date().toISOString() });
    remaining -= 1;
  }, 300);

  // If the client cancels, stop the timer.
  call.on('cancelled', () => clearInterval(timer));
}

// ------------------------------------------------------------
// CLIENT STREAMING — many requests, one response.
// `call` is a readable stream of incoming messages.
// `call.on('data')` fires per message, `call.on('end')` when done.
// ------------------------------------------------------------
function sumNumbers(call, callback) {
  console.log('[client]  SumNumbers()');
  let total = 0;
  let count = 0;

  call.on('data', (chunk) => {
    total += chunk.value;
    count += 1;
  });

  call.on('end', () => {
    callback(null, { total, count });
  });

  call.on('error', (err) => console.error('[client]  stream error:', err.message));
}

// ------------------------------------------------------------
// BIDIRECTIONAL — both sides stream simultaneously.
// No callback: we write and read until both sides end.
// ------------------------------------------------------------
function chat(call) {
  console.log('[bidi]    Chat() opened');
  const history = [];

  call.on('data', (msg) => {
    console.log(`[bidi]    <- ${msg.user}: ${msg.text}`);
    history.push(msg);

    // Echo an acknowledgement for every message received.
    call.write({
      user: 'server',
      text: `ack (${history.length}): "${msg.text}"`,
      sentAtUnix: Date.now(),
    });
  });

  call.on('end', () => {
    console.log(`[bidi]    Chat() closed after ${history.length} messages`);
    call.end();
  });

  // Greet the client as soon as the stream opens.
  call.write({ user: 'server', text: 'welcome! say something.', sentAtUnix: Date.now() });
}

server.addService(greeterPackage.Greeter.service, {
  SayHello: sayHello,
  CountDown: countDown,
  SumNumbers: sumNumbers,
  Chat: chat,
});

const PORT = '0.0.0.0:50051';
server.bindAsync(PORT, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) {
    console.error('Failed to bind:', err);
    process.exit(1);
  }
  console.log(`gRPC server listening on ${PORT} (bound port ${port})`);
});
