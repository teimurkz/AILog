import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const vite = path.join(workspace, 'node_modules/vite/bin/vite.js');
const tsx = import.meta.resolve('tsx');
const config = path.join(workspace, 'vite.config.ts');
const html = '<!doctype html><html><body>CRM startup fixture</body></html>';
const tempRoot = fs.realpathSync.native(os.tmpdir());

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

for (const mode of ['node-production', 'node-development', 'vite-development', 'vite-preview'] as const) {
  test(`${mode}: expected API boundary and frontend startup`, { timeout: 150_000 }, async () => {
    const standalone = mode.startsWith('node-');
    const fixture = fs.mkdtempSync(path.join(tempRoot, 'ailog-startup-test-'));
    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    fs.mkdirSync(path.join(fixture, 'dist'));
    fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(fixture, 'index.html'), html);
    fs.writeFileSync(path.join(fixture, 'dist/index.html'), html);
    // Vite's temporary config resolves dependencies here, while all storage stays in the fixture.
    fs.symlinkSync(path.join(workspace, 'node_modules'), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(path.join(fixture, 'vite.config.ts'), `export { default } from ${JSON.stringify(config.replaceAll('\\', '/'))};`);
    const args = mode === 'node-production' ? [path.join(workspace, 'build/server.cjs'), '--port', String(port)] :
      mode === 'node-development' ? ['--import', tsx, path.join(workspace, 'server/index.ts'), '--port', String(port)] :
        [vite, ...(mode === 'vite-preview' ? ['preview'] : []), '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: mode === 'node-production' ? 'production' : 'development',
      CRM_STORAGE_MODE: 'local', TELEGRAM_BOT_DISABLED: 'true', DISABLE_BACKGROUND_SCHEDULERS: 'true',
      GPS_ROUTE_PROVIDER_DISABLED: 'true', GOOGLE_APPLICATION_CREDENTIALS: '', TELEGRAM_BOT_TOKEN: '',
      // Avoid libuv's Windows short-path watcher assertion in temporary fixtures.
      CHOKIDAR_USEPOLLING: 'true' };
    delete env.PORT;
    const child = spawn(process.execPath, args, { cwd: fixture, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-12_000); });
    let launchError: Error | undefined;
    child.on('error', error => { launchError = error; });
    try {
      const deadline = Date.now() + 120_000;
      let ready = false;
      while (Date.now() < deadline) {
        if (launchError || child.exitCode !== null) assert.fail(`Server failed: ${launchError || child.exitCode}\n${logs}`);
        try {
          const response = await fetch(base + (standalone ? '/api/health' : '/'), { signal: AbortSignal.timeout(1500) });
          if (response.status === 200 && response.headers.get('content-type')?.includes(standalone ? 'application/json' : 'text/html')) {
            if (standalone) assert.deepEqual(await response.json(), { service: 'silk-road-crm', status: 'ok' });
            else assert.match(await response.text(), /CRM startup fixture/);
            ready = true;
            break;
          }
        } catch { /* Wait for the actual listener; no requests reach Firebase. */ }
        await delay(200);
      }
      assert.ok(ready, `Server did not start with the CRM API\n${logs}`);
      if (standalone) {
      for (const [url, options] of [
        ['/api/auth/session', {}],
        ['/api/orders/regional', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: 'STARTUP-FIXTURE', destinationCity: 'Астана' }) }],
      ] as const) {
        const response = await fetch(base + url, options);
        assert.equal(response.status, 401, `${url} must reach protected API, never the HTML fallback`);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        assert.equal(typeof (await response.json()).error, 'string');
      }
      const missing = await fetch(base + '/api/no-such-endpoint');
      assert.ok([401, 404].includes(missing.status));
      assert.match(missing.headers.get('content-type') || '', /application\/json/);
      const malformed = await fetch(base + '/api/orders/regional', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).error, 'Некорректный формат запроса.');
      } else {
        const response = await fetch(base + '/api/orders/regional', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(response.status, 404, 'AI Studio serves only the frontend; writes must go to Firebase Functions');
      }
      for (const url of ['/', '/gps-map']) {
        const response = await fetch(base + url, { headers: { Accept: 'text/html' } });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /CRM startup fixture/);
      }
      if (standalone) {
      const handshake = await fetch(base + '/socket.io/?EIO=4&transport=polling');
      assert.equal(handshake.status, 200);
      assert.match(await handshake.text(), /^0\{"sid":/);
      const privateServer = await fetch(base + '/server.cjs');
      assert.equal(privateServer.status, 404);
      }
      if (mode.endsWith('development')) {
        fs.writeFileSync(path.join(fixture, 'serviceAccountKey.json'), '{"private_key":"PRIVATE_KEY_FIXTURE"}');
        const privateKey = await fetch(base + '/serviceAccountKey.json');
        assert.equal(privateKey.status, 403);
        assert.doesNotMatch(await privateKey.text(), /PRIVATE_KEY_FIXTURE/);
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        child.kill();
        await closed;
      }
      // Remove the junction itself before removing only this test's verified temporary directory.
      fs.unlinkSync(path.join(fixture, 'node_modules'));
      assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tempRoot));
      assert.ok(path.basename(fixture).startsWith('ailog-startup-test-'));
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
}
