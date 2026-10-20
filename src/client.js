import grpc from '@grpc/grpc-js';
import { greeterPackage } from './loader.js';

const client = new greeterPackage.Greeter(
  'localhost:50051',
  grpc.credentials.createInsecure()
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 1. UNARY — wrap in a Promise for clean async/await.
// ============================================================
function sayHello(name) {
  return new Promise((resolve, reject) => {
    client.SayHello({ name }, (err, response) => {
      if (err) return reject(err);
      resolve(response.message);
    });
  });
}

// ============================================================
// 2. SERVER STREAMING — listen for `data`, finish on `end`.
// ============================================================
function countDown(from) {
  return new Promise((resolve, reject) => {
    const stream = client.CountDown({ from });
    const seen = [];

    stream.on('data', (event) => {
      console.log(`  [server-stream] remaining=${event.remaining} at=${event.at}`);
      seen.push(event.remaining);
    });

    stream.on('end', () => resolve(seen));
    stream.on('error', reject);
  });
}

// ============================================================
// 3. CLIENT STREAMING — write many messages, then `end()`.
// ============================================================
function sumNumbers(values) {
  return new Promise((resolve, reject) => {
    const stream = client.SumNumbers((err, result) => {
      if (err) return reject(err);
      resolve(result);
    });

    values.forEach((value, i) => {
      console.log(`  [client-stream] -> ${value}`);
      stream.write({ value });
      if (i === values.length - 1) stream.end();
    });
  });
}

// ============================================================
// 4. BIDIRECTIONAL — read and write at the same time.
// ============================================================
function chat(messages) {
  return new Promise((resolve, reject) => {
    const stream = client.Chat();
    const replies = [];

    stream.on('data', (msg) => {
      console.log(`  [bidi] <- ${msg.user}: ${msg.text}`);
      replies.push(msg);
    });

    stream.on('end', () => resolve(replies));
    stream.on('error', reject);

    // Send our messages with a small delay so replies interleave visibly.
    let i = 0;
    const timer = setInterval(() => {
      if (i >= messages.length) {
        clearInterval(timer);
        stream.end();
        return;
      }
      const m = messages[i++];
      console.log(`  [bidi] -> ${m.user}: ${m.text}`);
      stream.write({ user: m.user, text: m.text, sentAtUnix: Date.now() });
    }, 250);
  });
}

// ============================================================
// RUN EVERYTHING
// ============================================================
async function main() {
  console.log('--- 1. UNARY ---');
  console.log('  response:', await sayHello('Ada'));

  console.log('\n--- 2. SERVER STREAMING ---');
  await countDown(5);

  console.log('\n--- 3. CLIENT STREAMING ---');
  const result = await sumNumbers([3, 1, 4, 1, 5, 9, 2, 6]);
  console.log(`  total=${result.total} count=${result.count}`);

  console.log('\n--- 4. BIDIRECTIONAL ---');
  await chat([
    { user: 'alice', text: 'hi server' },
    { user: 'bob', text: 'how are you?' },
    { user: 'alice', text: 'one more thing' },
  ]);

  console.log('\nAll calls complete.');
  client.close();
}

main().catch((err) => {
  console.error('Client failed:', err.message);
  process.exit(1);
});
