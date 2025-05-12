function usage() {
    console.log(`go2web – tiny fetcher & searcher
  
    go2web -u <URL>         fetch URL
    go2web -s <search>      search
    go2web -h               help`);
    process.exit(0);
  }
  
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h')) usage();
  
const net = require('net');

async function httpGetRaw(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== 'http:') throw new Error('only http for now');
  const socket = net.createConnection(80, u.hostname);
  const req = `GET ${u.pathname || '/'} HTTP/1.1\r\nHost: ${u.hostname}\r\nConnection: close\r\n\r\n`;
  socket.write(req);
  let data = '';
  for await (const chunk of socket) data += chunk.toString('utf8');
  return data.split('\r\n\r\n')[1]; 
}