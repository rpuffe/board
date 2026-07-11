// Smoke test: post -> list -> 400 cases. Node built-ins only, no deps.
// Spawns the server as a child process against a scratch port and drives it
// over HTTP, the same way a real client would.

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8901;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = http.request(
      `${BASE}${urlPath}`,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = data.length ? JSON.parse(data) : null;
          } catch (e) {
            // leave json null for non-JSON responses
          }
          resolve({ status: res.statusCode, headers: res.headers, body: data, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await request('GET', '/healthz');
      if (res.status === 200) return;
    } catch (e) {
      // not up yet
    }
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become healthy in time');
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), BOARD_TITLE: 'test board' },
    stdio: 'inherit',
  });

  try {
    await waitForHealth(child);

    // GET / serves the configured heading
    const page = await request('GET', '/');
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('test board'), 'heading should reflect BOARD_TITLE');

    // GET /api/messages starts empty
    const empty = await request('GET', '/api/messages');
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.headers['content-type'], 'application/json');
    assert.deepStrictEqual(empty.json, []);

    // POST creates a message -> 201
    const posted = await request('POST', '/api/messages', JSON.stringify({ text: 'hello board' }));
    assert.strictEqual(posted.status, 201);
    assert.strictEqual(posted.json.text, 'hello board');
    assert.ok(posted.json.id);
    assert.ok(posted.json.created_at);

    // GET /api/messages now lists it, newest first
    const listed = await request('GET', '/api/messages');
    assert.strictEqual(listed.status, 200);
    assert.strictEqual(listed.json.length, 1);
    assert.strictEqual(listed.json[0].text, 'hello board');

    // second post appears before the first (newest first)
    const posted2 = await request('POST', '/api/messages', JSON.stringify({ text: 'second message' }));
    assert.strictEqual(posted2.status, 201);
    const listed2 = await request('GET', '/api/messages');
    assert.strictEqual(listed2.json.length, 2);
    assert.strictEqual(listed2.json[0].text, 'second message');
    assert.strictEqual(listed2.json[1].text, 'hello board');

    // 400: empty text
    const emptyText = await request('POST', '/api/messages', JSON.stringify({ text: '' }));
    assert.strictEqual(emptyText.status, 400);
    assert.strictEqual(emptyText.headers['content-type'], 'application/json');

    // 400: missing text field
    const missingText = await request('POST', '/api/messages', JSON.stringify({}));
    assert.strictEqual(missingText.status, 400);

    // 400: text over 280 characters
    const tooLong = await request('POST', '/api/messages', JSON.stringify({ text: 'x'.repeat(281) }));
    assert.strictEqual(tooLong.status, 400);

    // 281 chars rejected, 280 accepted (boundary)
    const atLimit = await request('POST', '/api/messages', JSON.stringify({ text: 'y'.repeat(280) }));
    assert.strictEqual(atLimit.status, 201);

    // 400: malformed JSON, not a crash
    const malformed = await request('POST', '/api/messages', '{not valid json');
    assert.strictEqual(malformed.status, 400);
    assert.strictEqual(malformed.headers['content-type'], 'application/json');

    // server is still alive after malformed JSON
    const stillUp = await request('GET', '/healthz');
    assert.strictEqual(stillUp.status, 200);

    // injection: posted text is stored verbatim (client renders via textContent,
    // never innerHTML — see server.js render()), so raw storage is expected here.
    const injected = await request(
      'POST',
      '/api/messages',
      JSON.stringify({ text: '<script>alert(1)</script>' })
    );
    assert.strictEqual(injected.status, 201);
    assert.strictEqual(injected.json.text, '<script>alert(1)</script>');

    console.log('smoke test: all checks passed');
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
