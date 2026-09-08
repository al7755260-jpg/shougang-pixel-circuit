import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MultiplayerServer } from './server/multiplayer.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.ply': 'application/octet-stream', '.splat': 'application/octet-stream',
  '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary' };

export function createGameServer({ port = 4192, host = '0.0.0.0', distRoot = path.join(projectRoot, 'dist'), autoTick = true, now = Date.now,publicPage='',basePath='/' } = {}) {
  const root = path.resolve(distRoot);
  let multiplayer;
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD', Connection: 'close' }).end(); return; }
    if (Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding']) { res.writeHead(413, { Connection: 'close' }).end(); return; }
    let requested;
    try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (requested.includes('\0')) { res.writeHead(400).end(); return; }
    if (requested === '/api/health') {
      const body = JSON.stringify({ ok: true, multiplayer: true, protocol: 2, rulesVersion: 'public-preview-v0.1.0', maxPlayers: 6, rooms: multiplayer.rooms.size, publicOrigin:multiplayer.publicOrigin,shareUrls: multiplayer.getShareUrls() });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    if(basePath!=='/'&&requested.startsWith(basePath))requested='/'+requested.slice(basePath.length);
    const file = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, async (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('找不到文件，请先运行 npm run build。'); return; }
      const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (req.headers.range && !range) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      let responseFile=file,responseSize=stat.size;
      const acceptsGzip=String(req.headers['accept-encoding']||'').split(',').some(part=>{const [encoding,...params]=part.trim().split(';');const quality=params.find(p=>p.trim().startsWith('q='));return encoding.toLowerCase()==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);});
      headers.Vary='Accept-Encoding';
      if(!range&&acceptsGzip){
        const compressed=await fs.promises.stat(file+'.gz').catch(()=>null);
        if(compressed?.isFile()&&compressed.mtimeMs>=stat.mtimeMs){responseFile=file+'.gz';responseSize=compressed.size;headers['Content-Encoding']='gzip';headers['X-Uncompressed-Length']=stat.size;}
      }
      const sendFile = options => { const stream = fs.createReadStream(responseFile, options); stream.on('error', () => res.destroy()); stream.pipe(res); };
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') res.end(); else sendFile({ start, end });
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': responseSize });
        if (req.method === 'HEAD') res.end(); else sendFile();
      }
    });
  });
  server.maxHeadersCount = 60;
  server.on('clientError', (_, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  multiplayer = new MultiplayerServer(server, { autoTick, now,publicPage });
  return {
    server, multiplayer,
    listen: () => new Promise((resolve, reject) => {
      const fail = error => { multiplayer.close(); reject(error); };
      server.once('error', fail);
      server.listen(port, host, () => { server.off('error', fail); resolve(server.address()); });
    }),
    close: () => new Promise(resolve => { multiplayer.close(); server.close(resolve); server.closeIdleConnections(); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createGameServer({ port: Number(process.env.PORT || process.argv[2] || 4192),publicPage:process.env.GAME_PUBLIC_PAGE||'' });
  if(process.env.GAME_PUBLIC_ORIGIN)app.multiplayer.setPublicOrigin(process.env.GAME_PUBLIC_ORIGIN);
  try {
    const address = await app.listen();
    process.stdout.write(`首钢园像素大奖赛 http://127.0.0.1:${address.port}\n多人模式已启用，最多 6 人 / 房间。\n`);
    for (const url of app.multiplayer.getShareUrls()) process.stdout.write(`局域网加入 ${url}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
