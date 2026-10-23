import {collisionInfo} from './public/collision-world.mjs';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, rename, stat, open, unlink, readdir } from 'node:fs/promises';
import { EmbodiedLife } from './src/embodied-life.mjs';
import {RuntimeClock} from './src/runtime-clock.mjs';
import { VERSION } from './public/world-spec.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// One running service serves one immutable room build. Editing files cannot mix
// a new model layout with a resident still using the previous collision world.
const publicFiles=new Map();
async function cachePublic(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
 const file=path.join(folder,entry.name);if(entry.isDirectory())await cachePublic(file);else publicFiles.set(file,await readFile(file));
}}
await cachePublic(path.join(root,'public'));
const collisionManifest=JSON.parse(publicFiles.get(path.join(root,'public','assets','room-collision.json')).toString('utf8'));
for(const [relative,expected]of Object.entries(collisionManifest.sources??{})){
 const content=publicFiles.get(path.join(root,'public',relative));
 if(!content||createHash('sha256').update(content).digest('hex')!==expected)throw new Error(`模型与碰撞不一致：${relative}，请重新生成场景碰撞。`);
}
const port = Number(process.env.MIRROR_HOME_PORT || 4191);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MIRROR_HOME_PORT');
const stateDir = path.resolve(process.env.MIRROR_HOME_STATE_DIR || path.join(root, 'runtime-v5.7.0'));
await mkdir(stateDir, { recursive: true });
const savePath = path.join(stateDir, 'home-state.json');
let saved = null;
try {
  saved = JSON.parse(await readFile(savePath, 'utf8'));
  if (saved === null) throw new Error('Saved home cannot be null');
}
catch (error) {
  if (error.code !== 'ENOENT') throw new Error(`Cannot read saved home. Original preserved at ${savePath}`, { cause: error });
}
const simulation = new EmbodiedLife(saved);
const runtimeClock=new RuntimeClock(simulation);
const testing=process.env.MIRROR_HOME_TEST_MODE==='1';
if(testing&&['runtime','runtime-v5.2','runtime-v5.3'].some(dir=>stateDir===path.join(root,dir)))throw new Error('测试模式必须使用独立存档目录');
if(!testing){simulation.setSpeed(1);simulation.environmentCommand('daytime','local');}
// A state directory has one simulation writer. Recover only a dead process's lock.
const lockPath = path.join(stateDir, 'server.lock');
try {
  const prior = JSON.parse(await readFile(lockPath, 'utf8'));
  let alive = true;
  try { process.kill(prior.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  if (alive) throw new Error('该存档目录已有服务运行，请使用独立 MIRROR_HOME_STATE_DIR');
  await unlink(lockPath);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const lockHandle = await open(lockPath, 'wx');
const instanceId=randomUUID(),controlToken=randomBytes(32).toString('hex');
await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(),root,stateDir,port,instanceId,controlToken }));
await lockHandle.close();
const neural = simulation.neural;
const clients = new Set();
let persistenceError = null;
let lastSavedAt = null;
let lastSavedRealSeconds = -Infinity;
let saveChain = Promise.resolve();
let shutdownRequested=false;
function persist(pausedOverride) {
  let serialized;
  const savedRealSeconds = simulation.state.realSeconds;
  try { const state=simulation.serialize();if(typeof pausedOverride==='boolean')state.paused=pausedOverride;serialized = JSON.stringify(state, null, 2); }
  catch(error) { persistenceError=error.message; console.error('Save rejected:',error.message); return Promise.resolve(); }
  saveChain = saveChain.then(async () => {
    await writeFile(`${savePath}.tmp`, serialized, 'utf8');
    await rename(`${savePath}.tmp`, savePath);
    lastSavedAt = new Date().toISOString();
    lastSavedRealSeconds = savedRealSeconds;
    persistenceError = null;
  }).catch(error => {
    persistenceError = error.message;
    console.error('Save failed:', error.message);
  });
  return saveChain;
}
const current = () => ({ ...simulation.snapshot(), collision:collisionInfo, neural: neural.snapshot(),
  server: { testing, timezone: 'Asia/Shanghai', connected: true, lastSavedAt, persistenceError, timing:runtimeClock.snapshot() } });
let lastBroadcastAt = -Infinity;
function broadcast(force = false) {
  if (!clients.size) return;
  const now = performance.now();
  // A paused body needs only a light cadence for Beijing time and cooldowns.
  // Commands still reach every viewer immediately.
  if (!force && simulation.state.paused && now - lastBroadcastAt < 1000) return;
  lastBroadcastAt = now;
  const data = `data: ${JSON.stringify(current())}\n\n`;
  for (const client of clients) {
    if (client.writableLength > 256 * 1024 || client.destroyed) {
      clients.delete(client); client.destroy();
    } else client.write(data);
  }
}
function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}
async function body(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 8192) throw Object.assign(new Error('请求过大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求格式无效'), { statusCode: 400 }); }
}
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.ico':'image/x-icon' };
const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!expectedHosts.has(request.headers.host)) return json(response, 403, { error:'仅支持本机访问' });
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const origin = `http://${request.headers.host}`;
    if (/^\/api\/(auth(?:\/|$)|account(?:\/|$)|fly(?:\/|$)|research(?:\/|$))/.test(url.pathname)) {
      return json(response, 410, { error: '该功能已停用' });
    }
    if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, {
      ok: !persistenceError, version: VERSION, persistenceError, instanceId, pid:process.pid,
      neural: { ...neural.snapshot(), frame: undefined }, mode: 'single-resident' });
    if (request.method === 'GET' && url.pathname === '/api/state') return json(response, 200, current());
    if (request.method === 'GET' && url.pathname === '/api/neural/cells') return json(response,200,neural.cells({
      query:url.searchParams.get('q')??'',role:url.searchParams.get('role')??'all',page:Number(url.searchParams.get('page')??0)}));
    if (request.method === 'GET' && url.pathname === '/api/stream') {
      response.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
      response.write(`retry: 1500\ndata: ${JSON.stringify(current())}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (request.headers.origin !== origin) return json(response, 403, { error: '操作需要同源本地页面' });
      if(url.pathname==='/api/shutdown'){
        if(request.headers.authorization!==`Bearer ${controlToken}`)return json(response,403,{error:'需要本机服务控制凭据'});
        if(closing||shutdownRequested)return json(response,409,{error:'服务正在关闭'});
        shutdownRequested=true;
        const wasPaused=simulation.state.paused;simulation.setPaused(true);await persist(wasPaused);
        if(persistenceError){shutdownRequested=false;simulation.setPaused(wasPaused);return json(response,500,{error:persistenceError});}
        // Persist the user's original pause choice; do not tick between save and exit.
        json(response,200,{ok:true,instanceId});void shutdown(true);return;
      }
      if(shutdownRequested)return json(response,409,{error:'服务正在关闭'});
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error:'需要 JSON 格式' });
      const command = await body(request);
      if (!command || typeof command !== 'object' || Array.isArray(command)) return json(response, 400, { error:'请求格式无效' });
      if (url.pathname !== '/api/command') return json(response, 404, { error: '接口不存在' });
      if(!testing&&((command.type==='speed'&&command.value!==1)||(command.type==='daytime'&&command.value!=='local')))return json(response,403,{error:'正式版本固定北京时间与1倍生活速度'});
      if (command.type === 'speed') simulation.setSpeed(command.value);
      else if (command.type === 'pause') simulation.setPaused(command.value);
      else if (['daytime', 'screen', 'leave-game', 'disturbance', 'game'].includes(command.type)) simulation.environmentCommand(command.type, command.value);
      else if (['feed','mist','chime'].includes(command.type)) simulation.interact(command.type);
      else return json(response, 400, { error:'未知操作' });
      await persist();
      broadcast(true);
      return json(response, 200, current());
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error:'不支持此操作' });
    const decoded = decodeURIComponent(url.pathname);
    if (decoded === '/wallet-client.mjs') return json(response, 404, { error: '文件不存在' });
    const isVendor = decoded.startsWith('/vendor/three/');
    const base = isVendor ? path.join(root, 'node_modules', 'three') : path.join(root, 'public');
    const relative = isVendor ? decoded.slice('/vendor/three/'.length) : decoded === '/' ? 'index.html' : decoded.slice(1);
    const filename = path.resolve(base, relative);
    if (!filename.startsWith(`${base}${path.sep}`)) return json(response, 403, { error:'路径不可访问' });
    const content=isVendor?await readFile(filename):publicFiles.get(filename);
    if(!content)return json(response,404,{error:'文件不存在'});
    response.writeHead(200, { 'Content-Type':types[path.extname(filename)] || 'application/octet-stream', 'Content-Length':content.length, 'Cache-Control':'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error.statusCode || (error instanceof URIError ? 400 : 500);
    if (status === 500) console.error(error);
    if (!response.headersSent) json(response, status, { error: status === 500 ? '本地服务发生错误，请查看运行日志' : error.message });
    else response.end();
  }
});

// Fixed-step life continues independently of the number of browser viewers.
let previousTick = performance.now();
const tickTimer = setInterval(() => {
  const now = performance.now();
  const elapsed = Math.max(0, (now - previousTick) / 1000);
  previousTick = now;
  // Windows timers may wake later than 20ms. Integrate elapsed active time;
  // the body retains its internal 20ms steps. Do not replay hours after sleep.
  runtimeClock.advance(elapsed);
}, 8);
const streamTimer = setInterval(broadcast, 100);
const saveTimer = setInterval(() => {
  // Paused life can still have real-time interaction cooldowns. Save until
  // those deadlines have passed, then leave the unchanged neural state alone.
  if (simulation.state.paused && !persistenceError
      && Object.values(simulation.state.cooldowns).every(until => until <= lastSavedRealSeconds)) return;
  void persist();
}, 5000);
let closing = false;
async function shutdown(alreadySaved=false) {
  if (closing) return;
  closing = true;
  clearInterval(tickTimer); clearInterval(streamTimer); clearInterval(saveTimer);
  if(alreadySaved!==true)await persist();
  for (const client of clients) client.end();
  try { await unlink(lockPath); } catch (error) { if (error.code !== 'ENOENT') persistenceError ||= error.message; }
  server.close(() => process.exit(persistenceError ? 1 : 0));
  setTimeout(() => process.exit(persistenceError ? 1 : 0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('error', error => { console.error(error.message); process.exit(1); });
await persist();
server.listen(port, '127.0.0.1', () => {
  console.log(`Mirror Gap Home v${VERSION}: http://127.0.0.1:${port}\nState: ${savePath}`);
});
