import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectEdge, disconnect } from '../src/browser/edgeLauncher.js';
test('独立EdgeへのCDP切断はEdgeとページを終了させない', async () => {
  const executable = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  await access(executable);
  const port = await new Promise<number>(resolve => {
    const server = createServer(); server.listen(0, '127.0.0.1', () => { const value = (server.address() as { port: number }).port; server.close(() => resolve(value)); });
  });
  const profile = await mkdtemp(join(tmpdir(), 'bugyo-cdp-test-'));
  const child = spawn(executable, ['--headless', '--no-sandbox', '--edge-skip-compat-layer-relaunch', '--disable-features=AutoDeElevate', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let spawnError: Error | undefined; child.on('error', e => spawnError = e);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError;
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Edge CDP endpoint did not start');
    const first = await connectEdge(port);
    const page = first.contexts()[0].pages()[0] ?? await first.contexts()[0].newPage();
    await page.setContent('<title>preserved-draft</title><p>draft data</p>');
    await disconnect(first);
    assert.equal((await fetch(`http://127.0.0.1:${port}/json/version`)).ok, true);
    const second = await connectEdge(port);
    assert.ok((await Promise.all(second.contexts()[0].pages().map(p => p.title()))).includes('preserved-draft'));
    await disconnect(second);
  } finally {
    // Only this test's disposable headless browser is closed. Production never does this.
    try {
      const cleanup = await connectEdge(port);
      const session = await cleanup.newBrowserCDPSession();
      await session.send('Browser.close');
    } catch { child.kill(); }
    await new Promise(resolve => setTimeout(resolve, 500));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
