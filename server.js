// board — a tiny public message board. Zero dependencies, Node built-ins only.

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);
const BOARD_TITLE = process.env.BOARD_TITLE || 'message board';

const MAX_MESSAGES = 100;
const MAX_TEXT_LENGTH = 280;
const MAX_BODY_BYTES = 16 * 1024; // safety cap against unbounded request bodies

// In-memory storage — stateless per contract; loss on restart is accepted.
const messages = [];

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function renderPage() {
  const title = escapeHtml(BOARD_TITLE);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    max-width: 640px;
    margin: 3rem auto;
    padding: 0 1.25rem;
    line-height: 1.5;
  }
  h1 { font-size: 1.5rem; margin-bottom: 1.25rem; }
  form { display: flex; gap: 0.5rem; margin-bottom: 2rem; }
  input[type="text"] {
    flex: 1;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    border: 1px solid #8888;
    border-radius: 6px;
  }
  button {
    padding: 0.5rem 1rem;
    font-size: 1rem;
    border: 1px solid #8888;
    border-radius: 6px;
    background: #1266f1;
    color: white;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  ul { list-style: none; padding: 0; margin: 0; }
  li {
    padding: 0.75rem 0;
    border-bottom: 1px solid #8883;
  }
  li:last-child { border-bottom: none; }
  .text { display: block; white-space: pre-wrap; word-break: break-word; }
  .time { display: block; font-size: 0.8rem; opacity: 0.65; margin-top: 0.15rem; }
  .error { color: #c0392b; font-size: 0.9rem; margin: -1rem 0 1.5rem; min-height: 1.2em; }
  .empty { opacity: 0.65; }
</style>
</head>
<body>
<h1 id="heading">${title}</h1>
<form id="post-form">
  <input id="text-input" type="text" maxlength="${MAX_TEXT_LENGTH}" placeholder="Say something..." autocomplete="off" required>
  <button type="submit">Post</button>
</form>
<div class="error" id="error" role="alert"></div>
<ul id="messages"></ul>
<script>
(function () {
  var form = document.getElementById('post-form');
  var input = document.getElementById('text-input');
  var list = document.getElementById('messages');
  var errorEl = document.getElementById('error');

  function relativeTime(iso) {
    var then = new Date(iso).getTime();
    var diffSec = Math.round((Date.now() - then) / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return diffSec + ' seconds ago';
    var diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return diffMin + (diffMin === 1 ? ' minute ago' : ' minutes ago');
    var diffHour = Math.round(diffMin / 60);
    if (diffHour < 24) return diffHour + (diffHour === 1 ? ' hour ago' : ' hours ago');
    var diffDay = Math.round(diffHour / 24);
    return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
  }

  function render(items) {
    list.textContent = '';
    if (!items.length) {
      var li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No messages yet — be the first.';
      list.appendChild(li);
      return;
    }
    items.forEach(function (msg) {
      var li = document.createElement('li');

      var textEl = document.createElement('span');
      textEl.className = 'text';
      textEl.textContent = msg.text; // textContent only — never innerHTML on untrusted data

      var timeEl = document.createElement('span');
      timeEl.className = 'time';
      timeEl.textContent = relativeTime(msg.created_at);
      timeEl.title = msg.created_at;

      li.appendChild(textEl);
      li.appendChild(timeEl);
      list.appendChild(li);
    });
  }

  function load() {
    fetch('/api/messages')
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () {
        errorEl.textContent = 'Could not load messages.';
      });
  }

  form.addEventListener('submit', function (evt) {
    evt.preventDefault();
    errorEl.textContent = '';
    var text = input.value;
    var button = form.querySelector('button');
    button.disabled = true;
    fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body.error || 'failed to post');
          return body;
        });
      })
      .then(function () {
        input.value = '';
        load();
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
      })
      .finally(function () {
        button.disabled = false;
      });
  });

  load();
})();
</script>
</body>
</html>
`;
}

function readBody(req, callback) {
  let data = '';
  let tooLarge = false;

  req.on('data', (chunk) => {
    if (tooLarge) return;
    data += chunk;
    if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
      tooLarge = true;
    }
  });

  req.on('end', () => {
    if (tooLarge) {
      callback(new Error('body too large'), null);
      return;
    }
    callback(null, data);
  });

  req.on('error', (err) => {
    callback(err, null);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    const page = renderPage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    sendJson(res, 200, messages);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/messages') {
    readBody(req, (err, raw) => {
      if (err) {
        sendJson(res, 400, { error: 'request body too large' });
        return;
      }

      let parsed;
      try {
        parsed = raw.length ? JSON.parse(raw) : {};
      } catch (e) {
        sendJson(res, 400, { error: 'malformed JSON' });
        return;
      }

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        typeof parsed.text !== 'string' ||
        parsed.text.trim().length === 0
      ) {
        sendJson(res, 400, { error: 'text is required and must be a non-empty string' });
        return;
      }

      if (parsed.text.length > MAX_TEXT_LENGTH) {
        sendJson(res, 400, { error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` });
        return;
      }

      const message = {
        id: crypto.randomUUID(),
        text: parsed.text,
        created_at: new Date().toISOString(),
      };

      messages.unshift(message);
      if (messages.length > MAX_MESSAGES) {
        messages.length = MAX_MESSAGES;
      }

      sendJson(res, 201, message);
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`board listening on 0.0.0.0:${PORT} (title="${BOARD_TITLE}")`);
  });
}

module.exports = server;
