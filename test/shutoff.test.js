// -----------------------------------------------------------------------------
// The shutoff keeper alone (src/shutoff.js) and its file in /data
// (src/store.js): a fake YoLink of three functions, a clock the tests move, and
// one run on the real clock measuring the period of the resends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShutoffKeeper } from '../src/shutoff.js';
import { MAX_SHUTOFFS, loadShutoffs, normalizeShutoffs, saveShutoffs } from '../src/store.js';

/** Timers the tests run by hand: `ms` kept, run with runTimeouts(). */
function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { id, fn, ms });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    timeouts: () => [...pending.values()],
    async runTimeouts() {
      for (const t of [...pending.values()]) {
        pending.delete(t.id);
        await t.fn();
      }
    },
  };
}

const TIMINGS = {
  check: 90_000,
  resends: 3,
  heldEvery: 15 * 60_000,
  expiry: 24 * 60 * 60_000,
  minGap: 60_000,
  openBlock: 20_000,
  retry: 15_000,
};
const quiet = { info() {}, warn() {}, debug() {} };

/**
 * A keeper on a fake YoLink: `yl.closed` is what a read shows; `yl.fail` an
 * error kind the send throws, `yl.readFail` the read. `loaded`: /data read.
 */
function keeperOf({
  timings = TIMINGS,
  timers = createFakeTimers(),
  clock = { now: 1_000 },
  loaded = true,
} = {}) {
  const yl = {
    sends: [],
    reads: 0,
    closed: false,
    fail: undefined,
    readFail: undefined,
    ready: {},
    saved: [],
  };
  const keeper = new ShutoffKeeper({
    send: async (entry) => {
      yl.sends.push({ id: entry.id, at: clock.now });
      if (yl.fail) {
        throw Object.assign(new Error(yl.fail), { kind: yl.fail });
      }
      return yl.answer;
    },
    read: async (entry) => {
      const ticket = keeper.ticket();
      yl.reads += 1;
      if (yl.readFail) {
        throw Object.assign(new Error(yl.readFail), { kind: yl.readFail });
      }
      keeper.observe(entry.id, yl.closed, ticket);
    },
    ready: () => yl.ready,
    save: async (list) => yl.saved.push(list),
    logger: quiet,
    timers,
    monotonic: () => clock.now,
    wallNow: () => 1_790_000_000_000 + clock.now,
    timings,
  });
  if (loaded) {
    keeper.restore([], { ok: true });
    yl.saved.length = 0;
  }
  return { keeper, yl, timers, clock };
}

const runAll = async (timers, clock) => {
  const ms = Math.max(0, ...timers.timeouts().map((t) => t.ms));
  clock.now += ms;
  await timers.runTimeouts();
};

test('a click sends at once and keeps the shutoff until a later read shows it closed', async () => {
  const { keeper, yl, timers, clock } = keeperOf();
  assert.equal(await keeper.click('v1', 'Valve'), 'sent');
  assert.deepEqual(yl.sends, [{ id: 'v1', at: 1_000 }]);
  assert.equal(yl.saved.length >= 1, true);
  await keeper.saving;
  assert.deepEqual(yl.saved.filter((list) => list.length > 0)[0], [
    { id: 'v1', name: 'Valve', at: 1_790_000_001_000 },
  ]);
  // A reading that started before the send ended never confirms it.
  const early = keeper.entries.get('v1').doneTicket - 1;
  keeper.observe('v1', true, early);
  assert.equal(keeper.entries.size, 1);
  keeper.observe('v1', false, keeper.ticket());
  assert.equal(keeper.entries.size, 1);
  keeper.observe('v1', true, keeper.ticket());
  assert.equal(keeper.entries.size, 0);
  await keeper.saving;
  assert.deepEqual(yl.saved.at(-1), []);
  assert.equal(timers.timeouts().length, 0);
  await runAll(timers, clock);
  assert.equal(yl.sends.length, 1);
});

test('a live report counts from the start of the send; a read from its end', async () => {
  const { keeper, yl } = keeperOf();
  let release;
  keeper.send = () => new Promise((resolve) => (release = resolve));
  const sending = keeper.click('v1', 'Valve');
  const entry = keeper.entries.get('v1');
  // A reading started before the send: never.
  keeper.observe('v1', true, entry.startTicket - 1, { live: true });
  assert.equal(keeper.entries.size, 1);
  // A read started during the send: not yet (it may predate the command).
  keeper.observe('v1', true, keeper.ticket());
  assert.equal(keeper.entries.size, 1);
  // A live report during the send: the device speaking after the command left.
  keeper.observe('v1', true, keeper.ticket(), { live: true });
  assert.equal(keeper.entries.size, 0);
  release();
  await sending;
  assert.equal(yl.sends.length, 0);
});

test('the valve answering its own request closed confirms the shutoff', async () => {
  const { keeper, yl, timers } = keeperOf();
  yl.answer = 'closed';
  assert.equal(await keeper.click('v1', 'Valve'), 'sent');
  assert.equal(keeper.entries.size, 0);
  assert.equal(timers.timeouts().length, 0);
});

test('resends: 3 after 90 s each, then held every 15 min; read before each', async () => {
  const { keeper, yl, timers, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  for (let i = 1; i <= 3; i += 1) {
    assert.deepEqual(
      timers.timeouts().map((t) => t.ms),
      [90_000],
    );
    await runAll(timers, clock);
    assert.equal(yl.reads, i);
    assert.equal(yl.sends.length, 1 + i);
  }
  await runAll(timers, clock);
  assert.equal(yl.sends.length, 4, 'held: not sent at once');
  assert.equal(keeper.summary().held, 1);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [15 * 60_000],
  );
  await runAll(timers, clock);
  assert.equal(yl.sends.length, 5);
  // Seen closed at the read of a check: not sent.
  yl.closed = true;
  await runAll(timers, clock);
  assert.equal(yl.sends.length, 5);
  assert.equal(keeper.entries.size, 0);
});

test('given up 24 h after its first send, not before; a new click counts again', async () => {
  const { keeper, yl, timers, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  const first = clock.now;
  for (let i = 0; i < 4; i += 1) {
    await runAll(timers, clock);
  }
  const sends = yl.sends.length;
  // The check right before the 24 h: sent again.
  clock.now = first + TIMINGS.expiry - 1 - 15 * 60_000;
  await runAll(timers, clock);
  assert.equal(yl.sends.length, sends + 1);
  // At 24 h: given up, said by the summary.
  clock.now = first + TIMINGS.expiry - 15 * 60_000;
  await runAll(timers, clock);
  assert.equal(keeper.entries.size, 0);
  assert.equal(yl.sends.length, sends + 1);
  assert.deepEqual(keeper.summary().givenUp, ['Valve']);
  // A new click: kept again, no longer given up.
  await keeper.click('v1', 'Valve');
  assert.deepEqual(keeper.summary().givenUp, []);
  assert.equal(keeper.entries.get('v1').firstSent, clock.now);
});

test('a refused account: nothing sent, no timer; fireAll sends it, with a new budget', async () => {
  const { keeper, yl, timers } = keeperOf();
  yl.ready = { blocked: true };
  assert.equal(await keeper.click('v1', 'Valve'), 'blocked');
  assert.equal(keeper.blocked, true);
  assert.equal(yl.sends.length, 0);
  assert.equal(timers.timeouts().length, 0);
  yl.ready = {};
  keeper.fireAll();
  assert.equal(keeper.blocked, false);
  await keeper.entries.get('v1').inFlight;
  assert.equal(yl.sends.length, 1);
});

test('a pause asked by YoLink: a click still sends once; the resends wait for its end', async () => {
  const { keeper, yl, timers, clock } = keeperOf();
  yl.ready = { wait: 300_000 };
  assert.equal(await keeper.click('v1', 'Valve'), 'sent');
  assert.equal(yl.sends.length, 1);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [300_000],
    'checked at the end of the pause',
  );
  // A second click within a minute: no second request during the pause.
  clock.now += 59_999;
  assert.equal(await keeper.click('v1', 'Valve'), 'paused');
  assert.equal(yl.sends.length, 1);
  clock.now += 1;
  assert.equal(await keeper.click('v1', 'Valve'), 'sent');
  assert.equal(yl.sends.length, 2);
  // fireAll during the pause: waits.
  clock.now += 60_000;
  keeper.fireAll();
  assert.equal(yl.sends.length, 2);
  yl.ready = {};
  await runAll(timers, clock);
  assert.equal(yl.reads, 1);
  assert.equal(yl.sends.length, 3);
});

test('fireAll within a minute of a send, after stop(): checked later, never orphaned', async () => {
  const { keeper, yl, timers, clock } = keeperOf();
  yl.fail = 'unavailable';
  await keeper.click('v1', 'Valve');
  keeper.stop();
  assert.equal(timers.timeouts().length, 0);
  clock.now += 200;
  keeper.fireAll();
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [59_800],
  );
  yl.fail = undefined;
  await runAll(timers, clock);
  assert.equal(yl.sends.length, 2);
});

test('fireAll: skips a shutoff sent less than a minute ago or in flight', async () => {
  const { keeper, yl, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  clock.now += 59_999;
  keeper.fireAll();
  assert.equal(yl.sends.length, 1);
  clock.now += 1;
  keeper.fireAll();
  keeper.fireAll();
  await keeper.entries.get('v1').inFlight;
  assert.equal(yl.sends.length, 2, 'one send in flight at a time');
});

test('a failed send is checked again in 15 s; 429 asks the app to pause', async () => {
  let paused;
  const { keeper, yl, timers, clock } = keeperOf();
  keeper.onRateLimited = (err) => (paused = err.kind);
  yl.fail = 'unavailable';
  assert.equal(await keeper.click('v1', 'Valve'), 'failed');
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [15_000],
  );
  yl.fail = 'rate_limited';
  await runAll(timers, clock);
  assert.equal(paused, 'rate_limited');
  assert.equal(keeper.entries.size, 1);
});

test('404: given up only when the read after it is a 404 too', async () => {
  const { keeper, yl, timers, clock } = keeperOf();
  yl.fail = 'not_found';
  await keeper.click('v1', 'Valve');
  assert.equal(keeper.entries.size, 1, 'one 404 is not enough');
  // The read answers: kept, sent again.
  await runAll(timers, clock);
  assert.equal(keeper.entries.size, 1);
  assert.equal(yl.sends.length, 2);
  // A send accepted, then a 404 read: still kept.
  yl.fail = undefined;
  await runAll(timers, clock);
  yl.readFail = 'not_found';
  await runAll(timers, clock);
  assert.equal(keeper.entries.size, 1, 'a 404 read after an accepted send is not enough');
  // Both unknown: given up at the read after a 404 send.
  yl.fail = 'not_found';
  while (keeper.entries.get('v1')?.lastError?.kind !== 'not_found') {
    await runAll(timers, clock);
  }
  assert.equal(keeper.entries.size, 1);
  await runAll(timers, clock);
  assert.equal(keeper.entries.size, 0);
  assert.equal(timers.timeouts().length, 0);
});

test('/data never written before it was read; the file read is merged', async () => {
  const { keeper, yl } = keeperOf({ loaded: false });
  await keeper.click('v1', 'Clicked');
  await keeper.click('v3', 'Done');
  keeper.letGo('v3', 'confirmed');
  await keeper.saving;
  assert.deepEqual(yl.saved, [], 'nothing written: /data not read');
  // Unreadable: still nothing written.
  keeper.restore([], { ok: false });
  await keeper.saving;
  assert.deepEqual(yl.saved, []);
  // Read: merged (v3 let go meanwhile is not taken back), then written.
  keeper.restore(
    [
      { id: 'v2', name: 'Kept', at: 5 },
      { id: 'v3', name: 'Done', at: 6 },
    ],
    { ok: true },
  );
  await keeper.saving;
  assert.deepEqual(
    yl.saved.at(-1).map((e) => e.id),
    ['v1', 'v2'],
  );
});

test('a click while its send is in flight: one request, not two', async () => {
  const { keeper, yl } = keeperOf();
  let release;
  keeper.send = (entry) => {
    yl.sends.push({ id: entry.id });
    return new Promise((resolve) => (release = resolve));
  };
  const first = keeper.click('v1', 'Valve');
  const second = keeper.click('v1', 'Valve');
  release();
  assert.deepEqual(await Promise.all([first, second]), ['sent', 'sent']);
  assert.equal(yl.sends.length, 1);
});

test('a new click before the 24 h: they count from its own first send', async () => {
  const { keeper, timers, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  await runAll(timers, clock);
  clock.now += 60 * 60_000;
  await keeper.click('v1', 'Valve');
  assert.equal(keeper.entries.get('v1').firstSent, clock.now);
});

test('openings: refused 20 s after a click, the click count moves', async () => {
  const { keeper, clock } = keeperOf();
  assert.equal(keeper.justClicked('v1'), false);
  assert.equal(keeper.clickCount('v1'), 0);
  await keeper.click('v1', 'Valve');
  assert.equal(keeper.clickCount('v1'), 1);
  clock.now += 19_999;
  assert.equal(keeper.justClicked('v1'), true);
  clock.now += 1;
  assert.equal(keeper.justClicked('v1'), false);
});

test('stop: no timer and no send after it, even for a send in flight', async () => {
  const { keeper, yl, timers } = keeperOf();
  let release;
  keeper.send = () => new Promise((resolve) => (release = resolve));
  const sending = keeper.click('v1', 'Valve');
  keeper.stop();
  release();
  await sending;
  assert.equal(timers.timeouts().length, 0);
  assert.equal(yl.sends.length, 0);
});

test('restore: the shutoffs of /data, never twice, sent by fireAll', async () => {
  const { keeper, yl } = keeperOf();
  await keeper.click('v1', 'Clicked');
  keeper.restore([
    { id: 'v1', name: 'Old', at: 5 },
    { id: 'v2', name: '', at: 6 },
  ]);
  assert.deepEqual(
    [...keeper.entries.values()].map((e) => [e.id, e.name]),
    [
      ['v1', 'Clicked'],
      ['v2', 'v2'],
    ],
  );
  keeper.fireAll();
  await keeper.entries.get('v2').inFlight;
  assert.deepEqual(
    yl.sends.map((s) => s.id),
    ['v1', 'v2'],
  );
});

test('the file of /data: repaired, bounded, unreadable never taken for empty', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-yolink-shutoffs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await loadShutoffs(dir), { ok: true, list: [] });
  const list = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, at: i + 1 }));
  await saveShutoffs(dir, list);
  const back = await loadShutoffs(dir);
  assert.equal(back.ok, true);
  assert.equal(back.list.length, MAX_SHUTOFFS);
  const raw = JSON.parse(await readFile(join(dir, 'yolink-shutoffs.json'), 'utf8'));
  assert.equal(raw.version, 1);
  assert.deepEqual(
    normalizeShutoffs({
      version: 1,
      shutoffs: [
        { id: 'a', name: 'A\u0000\nB', at: 3, extra: 1 },
        { id: 'a', name: 'twice' },
        { id: '../x', name: 'bad id' },
        { id: 7 },
        null,
        { id: 'b', at: -1 },
      ],
    }),
    [
      { id: 'a', name: 'A  B', at: 3 },
      { id: 'b', name: '', at: 0 },
    ],
  );
  assert.deepEqual(normalizeShutoffs({ version: 2, shutoffs: [{ id: 'a' }] }), []);
  await writeFile(join(dir, 'yolink-shutoffs.json'), 'not json');
  const garbage = await loadShutoffs(dir);
  assert.equal(garbage.ok, true);
  assert.ok(garbage.error);
  await rm(join(dir, 'yolink-shutoffs.json'));
  // A directory in place of the file: unreadable, never taken for empty.
  await mkdir(join(dir, 'yolink-shutoffs.json'));
  const unreadable = await loadShutoffs(dir);
  assert.equal(unreadable.ok, false);
});

test('real clock: the resends keep their period and stop once seen closed', async (t) => {
  const clock = {
    get now() {
      return performance.now();
    },
  };
  const timers = { setTimeout, clearTimeout };
  const timings = { ...TIMINGS, check: 40, heldEvery: 80, resends: 2, minGap: 10 };
  const { keeper, yl } = keeperOf({ timings, timers, clock });
  t.after(() => keeper.stop());
  await keeper.click('v1', 'Valve');
  const deadline = performance.now() + 5_000;
  while (yl.sends.length < 5 && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(yl.sends.length >= 5, true, 'five sends within 5 s');
  const gaps = yl.sends.slice(1).map((s, i) => s.at - yl.sends[i].at);
  // Two resends 40 ms apart, then held: 80 ms. Never faster (a storm), wide margins.
  assert.ok(gaps[0] >= 39 && gaps[1] >= 39, `gaps ${gaps}`);
  assert.ok(gaps[2] >= 79 && gaps[3] >= 79, `held gaps ${gaps}`);
  yl.closed = true;
  const sends = yl.sends.length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(yl.sends.length <= sends + 1, 'stops at the next check');
  assert.equal(keeper.entries.size, 0);
});
