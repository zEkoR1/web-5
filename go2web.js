const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { once } = require('events');

const CACHE_DIR = path.join(os.homedir(), '.go2web_cache');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function usage() {
  console.log(`go2web – tiny fetcher & searcher (no HTTP libs)\n\nUsage:\n  go2web -u <URL>         fetch URL and print response\n  go2web -s <search>      search term (DuckDuckGo) – top 10 links\n  go2web -h               this help`);
  process.exit(0);
}

function cliError(msg) {
  console.error(`Error: ${msg}`);
  usage();
}

 const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h')) usage();
let mode = null;
let param = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-u') {
    mode = 'url';
    param = args[i + 1];
    break;
  }
  if (args[i] === '-s') {
    mode = 'search';
    param = args.slice(i + 1).join(' ');
    break;
  }
}
if (!mode || !param) cliError('Missing parameter');


function cachePath(urlStr) {
  return path.join(
    CACHE_DIR,
    encodeURIComponent(urlStr.replace(/[^\w.-]/g, '_')),
  );
}

function getFromCache(urlStr) {
  const p = cachePath(urlStr);
  try {
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
      return fs.readFileSync(p);
    }

} catch (_) {

  }
  return null;
}

function saveToCache(urlStr, buf) {
  try {
    fs.writeFileSync(cachePath(urlStr), buf);
  } catch (_) {
  }
}

function parseHeaders(headerText) {
  const lines = headerText.split(/\r?\n/);
  const [protocol, statusCode, ...statusMsg] = lines[0].split(' ');
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx > -1) {
      const key = lines[i].slice(0, idx).trim().toLowerCase();
      const val = lines[i].slice(idx + 1).trim();
      headers[key] = val;
    }
  }
  return { protocol, statusCode: parseInt(statusCode, 10), statusMsg: statusMsg.join(' '), headers };
}

function parseChunked(decoder, buf) {
  let pos = 0;
  const chunks = [];
  while (pos < buf.length) {
    const endSize = buf.indexOf('\r\n', pos, 'ascii');
    if (endSize === -1) break;
    const sizeStr = buf.slice(pos, endSize).toString('ascii').trim();
    const size = parseInt(sizeStr, 16);
    if (size === 0) break;
    const start = endSize + 2;
    const end = start + size;
    chunks.push(buf.slice(start, end));
    pos = end + 2; 
  }
  return Buffer.concat(chunks).toString(decoder);
}

async function rawRequest(urlStr, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');
  const cached = getFromCache(urlStr);
  if (cached) return cached.toString('utf8');

  const u = new URL(urlStr);
  const isHttps = u.protocol === 'https:';
  const port = u.port || (isHttps ? 443 : 80);
  const socket = isHttps
    ? tls.connect(port, u.hostname, { servername: u.hostname })
    : net.createConnection(port, u.hostname);

  const reqLines = [
    `GET ${u.pathname || '/'}${u.search || ''} HTTP/1.1`,
    `Host: ${u.hostname}`,
    'User-Agent: go2web/1.0',
    'Accept: text/html, application/json;q=0.9, */*;q=0.8',
    'Accept-Encoding: identity',
    'Connection: close',
    '',
    '',
  ].join('\r\n');

  socket.write(reqLines);

  const dataChunks = [];
  socket.on('data', (d) => dataChunks.push(d));
  await once(socket, 'end');
  socket.destroy();
  const rawBuf = Buffer.concat(dataChunks);

  const headerEnd = rawBuf.indexOf('\r\n\r\n');
  if (headerEnd === -1) throw new Error('Malformed response');
  const headerText = rawBuf.slice(0, headerEnd).toString('ascii');
  const bodyBuf = rawBuf.slice(headerEnd + 4);
  const { statusCode, headers } = parseHeaders(headerText);

  if ([301, 302, 303, 307, 308].includes(statusCode)) {
    const loc = headers.location;
    if (!loc) throw new Error('Redirect w/o location');
    const next = new URL(loc, u); // relative ok
    return rawRequest(next.href, redirectCount + 1);
  }

  let bodyText;
  if (headers['transfer-encoding'] === 'chunked') {
    bodyText = parseChunked('utf8', bodyBuf);
  } else {
    bodyText = bodyBuf.toString('utf8');
  }

  if (statusCode === 200) saveToCache(urlStr, Buffer.from(bodyText, 'utf8'));

  const ctype = (headers['content-type'] || '').split(';')[0].trim();
  if (ctype === 'application/json') {
    try {
      const parsed = JSON.parse(bodyText);
      return JSON.stringify(parsed, null, 2);
    } catch (_) {
    }
  }
  if (ctype === 'text/html' || ctype === 'text/xml' || ctype.includes('html')) {
    return stripHTML(bodyText);
  }
  return bodyText;
}

function stripHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[\r\n]+/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function doSearch(term) {
    const url   = `https://duckduckgo.com/html/?q=${encodeURIComponent(term)}`;
    const html  = await rawRequest(url, 0, true);        // preserve HTML
    const re    = /<a[^>]+class="result__a"[^>]+href="([^">]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const res   = [];
    let m;
    while ((m = re.exec(html)) && res.length < 10) {
      res.push({ url: m[1], title: stripHTML(m[2]) });
    }
    if (!res.length) return console.log('No results found');
    res.forEach((r, i) => console.log(`${i + 1}. ${r.title}\n   ${r.url}\n`));
  }
  

async function doFetch(url) {
  try {
    const txt = await rawRequest(url);
    console.log(txt);
  } catch (e) {
    console.error(`Fetch error: ${e.message}`);
    process.exit(1);
  }
}

(async function main() {
  try {
    if (mode === 'url') {
      await doFetch(param);
    } else if (mode === 'search') {
      await doSearch(param);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
