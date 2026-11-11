/**
 * Route wiring tests: the seven exact Fetch routes, disposal inside
 * `ctx.effect`, the workspaces projection (including `live` and `git`), the ping
 * verification channel, and the "handler never throws" guarantee.
 */

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { apply as pluginApply, inject as pluginInject, name as pluginName } from '../../lib/index.js';
import { ROUTE_DEFINITIONS, ROUTE_PREFIX, createRoutes, registerRoutes } from '../../lib/host/routes.js';
import { call, encode, makeApp, postJson, temporaryDirectory } from './support.mjs';

/**
 * Build a fake plugin context that captures effects and route registrations.
 * @param services - service map for `ctx.get`.
 * @returns `{ ctx, routes, effects, disposers }`.
 */
function fakePluginContext(services = {}) {
  const routes = [];
  const effects = [];
  const disposers = [];
  return {
    routes,
    effects,
    disposers,
    ctx: {
      get(name) {
        return services[name];
      },
      effect(callback, label) {
        effects.push(label);
        const dispose = callback();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      },
      connection: {
        fetch: {
          register(route) {
            routes.push(route);
            return () => {
              const index = routes.indexOf(route);
              if (index !== -1) routes.splice(index, 1);
            };
          },
        },
      },
    },
  };
}

describe('plugin module face', () => {
  it('exports the contracted module face', () => {
    assert.equal(pluginName, 'workspace-ide');
    assert.deepEqual(pluginInject, ['connection']);
    assert.equal(typeof pluginApply, 'function');
  });

  it('apply registers all seven routes through ctx.effect', () => {
    const fake = fakePluginContext();
    pluginApply(fake.ctx);
    assert.equal(fake.routes.length, 7);
    assert.equal(fake.effects.length, 7);
    assert.deepEqual(fake.routes.map((route) => route.path).sort(), [
      `${ROUTE_PREFIX}file`,
      `${ROUTE_PREFIX}git`,
      `${ROUTE_PREFIX}list`,
      `${ROUTE_PREFIX}ping`,
      `${ROUTE_PREFIX}save`,
      `${ROUTE_PREFIX}search`,
      `${ROUTE_PREFIX}workspaces`,
    ]);
  });

  it('apply degrades without a connection service', () => {
    assert.doesNotThrow(() => pluginApply(undefined));
    assert.doesNotThrow(() => pluginApply({ get: () => undefined }));
    assert.doesNotThrow(() => pluginApply({ get: () => undefined, connection: {} }));
  });
});

describe('route table', () => {
  it('declares the contracted paths, methods and body mode', () => {
    assert.equal(ROUTE_DEFINITIONS.length, 7);
    const expected = new Map([
      ['workspaces', ['GET']],
      ['list', ['GET']],
      ['file', ['GET']],
      ['search', ['GET']],
      ['git', ['GET']],
      ['save', ['POST']],
      ['ping', ['POST']],
    ]);
    for (const definition of ROUTE_DEFINITIONS) {
      assert.equal(definition.path, `/api/dsh-workspace-ide.${definition.name}`);
      assert.deepEqual([...definition.methods], expected.get(definition.name));
    }
    for (const route of createRoutes({ get: () => undefined })) {
      assert.equal(route.requestBody, 'buffered');
      assert.equal(typeof route.fetch, 'function');
    }
  });

  it('registerRoutes is a no-op without the Fetch service', () => {
    assert.doesNotThrow(() => registerRoutes({ get: () => undefined }));
    assert.doesNotThrow(() => registerRoutes({ get: () => undefined, connection: { fetch: {} } }));
    assert.doesNotThrow(() => registerRoutes(undefined));
  });

  it('the registered disposer removes the route', () => {
    const fake = fakePluginContext();
    registerRoutes(fake.ctx);
    assert.equal(fake.routes.length, 7);
    assert.equal(fake.disposers.length, 7);
    for (const dispose of fake.disposers) dispose();
    assert.equal(fake.routes.length, 0);
  });
});

describe('GET workspaces', () => {
  it('returns an empty list without the registry service', async () => {
    const { status, body } = await call(makeApp(), 'workspaces');
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, workspaces: [] });
  });

  it('projects registry entries, session counts and live state', async () => {
    const services = {
      workspaceRegistry: {
        list: () => [
          { id: 'w1', path: '/workspaces/alpha', title: 'Alpha', sessionIds: ['s1', 's2'] },
          { id: 'w2', path: '/workspaces/beta', title: '', sessionIds: ['s3'] },
          { id: 'w3', path: '/workspaces/gamma', sessionIds: [] },
        ],
      },
      sessions: {
        list: () => [{ id: 's2' }, { id: 's9' }],
      },
    };
    const { status, body } = await call(makeApp(services), 'workspaces');
    assert.equal(status, 200);
    assert.deepEqual(body.workspaces, [
      { id: 'w1', path: '/workspaces/alpha', title: 'Alpha', sessionCount: 2, live: true, git: false },
      { id: 'w2', path: '/workspaces/beta', title: 'beta', sessionCount: 1, live: false, git: false },
      { id: 'w3', path: '/workspaces/gamma', title: 'gamma', sessionCount: 0, live: false, git: false },
    ]);
  });

  it('flags workspaces that carry a .git marker and never throws on misses', async (t) => {
    const gitDirectory = temporaryDirectory(t, 'wsi-ws-gitdir-');
    mkdirSync(join(gitDirectory, '.git'));
    const gitFile = temporaryDirectory(t, 'wsi-ws-gitfile-');
    writeFileSync(join(gitFile, '.git'), 'gitdir: /somewhere/.git/worktrees/wt\n');
    const plain = temporaryDirectory(t, 'wsi-ws-plain-');
    const locked = temporaryDirectory(t, 'wsi-ws-locked-');
    mkdirSync(join(locked, '.git'));
    chmodSync(locked, 0o000);
    try {
      const services = {
        workspaceRegistry: {
          list: () => [
            { id: 'git-dir', path: gitDirectory, title: 'Git dir', sessionIds: [] },
            { id: 'git-file', path: gitFile, title: 'Git file', sessionIds: [] },
            { id: 'plain', path: plain, title: 'Plain', sessionIds: [] },
            { id: 'locked', path: locked, title: 'Locked', sessionIds: [] },
            { id: 'missing', path: join(plain, 'ghost'), title: 'Missing', sessionIds: [] },
            { id: 'relative', path: 'relative/path', title: 'Relative', sessionIds: [] },
          ],
        },
      };
      const { status, body } = await call(makeApp(services), 'workspaces');
      assert.equal(status, 200);
      const flags = new Map(body.workspaces.map((workspace) => [workspace.id, workspace.git]));
      assert.equal(flags.get('git-dir'), true);
      assert.equal(flags.get('git-file'), true);
      assert.equal(flags.get('plain'), false);
      assert.equal(flags.get('locked'), false);
      assert.equal(flags.get('missing'), false);
      assert.equal(flags.get('relative'), false);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  it('degrades when services are missing or throw', async () => {
    const throwing = {
      workspaceRegistry: { list: () => { throw new Error('boom'); } },
      sessions: { list: () => { throw new Error('boom'); } },
    };
    const { status, body } = await call(makeApp(throwing), 'workspaces');
    assert.equal(status, 200);
    assert.deepEqual(body.workspaces, []);
  });
});

describe('POST ping', () => {
  it('appends a JSON line to $DSH_HOME/workspace-ide/status.jsonl', async (t) => {
    const home = temporaryDirectory(t, 'wsi-dsh-home-');
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    t.after(() => {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    });
    const { status, body } = await postJson(makeApp(), 'ping', { stage: 'panel', detail: { tab: 'files' } });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    const file = join(home, 'workspace-ide', 'status.jsonl');
    assert.equal(existsSync(file), true);
    const [line] = readFileSync(file, 'utf8').trim().split('\n');
    const record = JSON.parse(line);
    assert.equal(record.stage, 'panel');
    assert.deepEqual(record.detail, { tab: 'files' });
    assert.equal(record.pid, process.pid);
    assert.equal(Number.isNaN(Date.parse(record.at)), false);
  });

  it('always answers ok, even for garbage bodies', async (t) => {
    const home = temporaryDirectory(t, 'wsi-dsh-home-');
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    t.after(() => {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    });
    const garbage = await call(makeApp(), 'ping', '', { method: 'POST', body: 'not json at all' });
    assert.equal(garbage.status, 200);
    assert.deepEqual(garbage.body, { ok: true });
    const empty = await call(makeApp(), 'ping', '', { method: 'POST' });
    assert.deepEqual(empty.body, { ok: true });
  });
});

describe('handler guard', () => {
  it('never throws and always sets no-store, whatever the input', async (t) => {
    const root = temporaryDirectory(t);
    // Isolate the ping route so the guard run cannot touch the developer's real
    // ~/.dsh workspace-ide status log.
    const home = temporaryDirectory(t, 'wsi-dsh-home-');
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    t.after(() => {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    });
    const app = makeApp();
    const requests = [
      { name: 'workspaces', query: '', ok: true },
      { name: 'list', query: '', ok: false },
      { name: 'list', query: '?root=%2Fdefinitely%2Fmissing%2Fpath', ok: false },
      { name: 'file', query: '', ok: false },
      { name: 'search', query: '', ok: false },
      { name: 'git', query: '', ok: false },
      { name: 'git', query: `?root=${encode(root)}&kind=bogus`, ok: false },
      { name: 'search', query: `?root=${encode(root)}&q=${encode('a(')}&regex=1`, ok: false },
      { name: 'save', query: '', ok: false },
      { name: 'ping', query: '', ok: true },
    ];
    for (const request of requests) {
      const route = app.find((entry) => entry.name === request.name);
      const init = route.methods.includes('POST')
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"broken":' }
        : undefined;
      const response = await route.fetch(new Request(`http://localhost/api/dsh-workspace-ide.${request.name}${request.query}`, init));
      assert.ok(response instanceof Response, `${request.name} returned a Response`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.equal(body.ok, request.ok, `${request.name}${request.query} ok flag`);
      if (!request.ok) assert.equal(typeof body.error.code, 'string');
    }
  });

  it('degrades when ctx.get throws instead of failing the route', async () => {
    const app = createRoutes({
      get() {
        throw new Error('ctx.get exploded');
      },
    });
    const route = app.find((entry) => entry.name === 'workspaces');
    const response = await route.fetch(new Request('http://localhost/api/dsh-workspace-ide.workspaces'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
  });
});
