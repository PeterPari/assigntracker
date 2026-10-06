// Unit tests for the pure logic block of index.html (between the <logic> markers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDEX } from './harness.mjs';

const html = readFileSync(INDEX, 'utf8');
const block = html.match(/\/\* <logic> \*\/([\s\S]*?)\/\* <\/logic> \*\//)[1];
const L = new Function(`${block}; return { fmtDur, fmtDurLong, allDone, totalMins, countLabel, cleanName, doneLead, fmtClock, startFromParts, durationFromEnd, durationOnDone, isComplete, schedule, progress, moveRow, removeRow, chainOn, keepPlan, serialize, hydrate, cleanRow };`)();

const row = (id, mins, o = {}) => ({ id, name: id, mins, status: 0, start: null, ...o });
const H = (h, m = 0) => h * 60 + m;

test('fmtDur follows the spec examples', () => {
  assert.equal(L.fmtDur(30), '30 min');
  assert.equal(L.fmtDur(45), '45 min');
  assert.equal(L.fmtDur(60), '1 hr');
  assert.equal(L.fmtDur(120), '2 hrs');
  assert.equal(L.fmtDur(150), '2 hrs 30 min');
});
test('fmtDur never shows an empty unit', () => {
  for (let m = 1; m < 1500; m++) {
    const s = L.fmtDur(m);
    assert.ok(!/\b0 (hr|hrs|min)\b/.test(s), `${m} -> ${s}`);
  }
  assert.equal(L.fmtDur(61), '1 hr 1 min');
  assert.equal(L.fmtDur(600), '10 hrs');
});

test('fmtClock is 12-hour and wraps past midnight', () => {
  assert.equal(L.fmtClock(H(15, 30)), '3:30 PM');
  assert.equal(L.fmtClock(0), '12:00 AM');
  assert.equal(L.fmtClock(H(12)), '12:00 PM');
  assert.equal(L.fmtClock(H(12, 5)), '12:05 PM');
  assert.equal(L.fmtClock(H(23, 59)), '11:59 PM');
  assert.equal(L.fmtClock(H(24, 15)), '12:15 AM');
  assert.equal(L.fmtClock(H(25, 15)), '1:15 AM');
  assert.equal(L.fmtClock(H(49, 15)), '1:15 AM');
});

test('startFromParts reads the editor fields', () => {
  assert.equal(L.startFromParts('3', '30', 'PM'), H(15, 30));
  assert.equal(L.startFromParts('3', '30', 'AM'), H(3, 30));
  assert.equal(L.startFromParts('12', '', 'AM'), 0);
  assert.equal(L.startFromParts('12', '15', 'PM'), H(12, 15));
  assert.equal(L.startFromParts('9', '', 'AM'), H(9));
  assert.equal(L.startFromParts('15', '30', 'AM'), H(15, 30), '13-23 are 24-hour');
  assert.equal(L.startFromParts('0', '10', 'PM'), 10, '0 reads as 12 AM');
  assert.equal(L.startFromParts('', '', 'AM'), null);
  assert.equal(L.startFromParts('', '30', 'AM'), undefined);
  assert.equal(L.startFromParts('24', '', 'AM'), undefined);
  assert.equal(L.startFromParts('3', '60', 'AM'), undefined);
  assert.equal(L.startFromParts('x', '', 'AM'), undefined);
});

test('isComplete needs a name and a duration', () => {
  assert.equal(L.isComplete({ name: 'a', mins: 5 }), true);
  assert.equal(L.isComplete({ name: ' ', mins: 5 }), false);
  assert.equal(L.isComplete({ name: 'a', mins: 0 }), false);
});

test('schedule, chained: lower starts follow the previous end', () => {
  const s = L.schedule([row('a', 30, { start: H(9) }), row('b', 90), row('c', 45)], true);
  assert.deepEqual(s.map((x) => x.start), [H(9), H(9, 30), H(11)]);
  assert.deepEqual(s.map((x) => x.end), [H(9, 30), H(11), H(11, 45)]);
  assert.deepEqual(s.map((x) => x.derived), [false, true, true]);
});
test('schedule, chained: no first start means the rows above any cut are blank', () => {
  const s = L.schedule([row('a', 30), row('b', 90), row('c', 45)], true);
  assert.deepEqual(s.map((x) => [x.start, x.end]), [[null, null], [null, null], [null, null]]);
});
test('schedule, chained: a row with its own start cuts the chain before it and the rows after continue from it', () => {
  const rows = [row('a', 60, { start: H(9) }), row('b', 60, { start: H(10, 35) }), row('c', 30)];
  const s = L.schedule(rows, true);
  assert.deepEqual(s.map((x) => x.start), [H(9), H(10, 35), H(11, 35)]);
  assert.deepEqual(s.map((x) => x.end), [H(10), H(11, 35), H(12, 5)]);
  assert.deepEqual(s.map((x) => x.derived), [false, false, true]);
});
test('schedule, chained: a cut works even when the first row has no start', () => {
  const s = L.schedule([row('a', 30), row('b', 90, { start: H(10) }), row('c', 45)], true);
  assert.deepEqual(s.map((x) => x.start), [null, H(10), H(11, 30)]);
  assert.deepEqual(s.map((x) => x.end), [null, H(11, 30), H(12, 15)]);
});
test('schedule, chained: end past midnight is plain clock time', () => {
  const s = L.schedule([row('a', H(2), { start: H(23, 15) }), row('b', H(1))], true);
  assert.equal(L.fmtClock(s[0].end), '1:15 AM');
  assert.equal(L.fmtClock(s[1].start), '1:15 AM');
  assert.equal(L.fmtClock(s[1].end), '2:15 AM');
});
test('schedule, unchained: each row uses only its own start', () => {
  const s = L.schedule([row('a', 30, { start: H(9) }), row('b', 90), row('c', 45, { start: H(14) })], false);
  assert.deepEqual(s.map((x) => x.start), [H(9), null, H(14)]);
  assert.deepEqual(s.map((x) => x.end), [H(9, 30), null, H(14, 45)]);
  assert.deepEqual(s.map((x) => x.derived), [false, false, false]);
});
test('schedule: a row without a duration has no end and passes the start through', () => {
  const s = L.schedule([row('a', 0, { start: H(9) }), row('b', 30)], true);
  assert.equal(s[0].end, null);
  assert.equal(s[1].start, H(9));
});

test('progress averages row share and minute share; in-progress counts as 0', () => {
  assert.equal(L.progress([]), 0);
  assert.equal(L.progress([row('a', 60)]), 0);
  assert.equal(L.progress([row('a', 60, { status: 1 })]), 0);
  assert.equal(L.progress([row('a', 60, { status: 2 })]), 100);
  // 1 of 4 rows done, 90 of 315 minutes done -> (0.25 + 0.2857) / 2 = 26.8 -> 27
  const rows = [row('a', 90, { status: 2 }), row('b', 150, { status: 1 }), row('c', 45), row('d', 30)];
  assert.equal(L.progress(rows), 27);
  // 1 of 2 rows done, 30 of 90 minutes -> (0.5 + 0.333) / 2 = 41.7 -> 42
  assert.equal(L.progress([row('a', 30, { status: 2 }), row('b', 60)]), 42);
});
test('progress ignores unfinished rows and never shows 100 before everything is done', () => {
  assert.equal(L.progress([row('a', 60, { status: 2 }), { id: 'x', name: '', mins: 0, status: 0, start: null }]), 100);
  // 999 of 1000 rows done and 99900 of 99901 minutes: 99.95 rounds to 100, but one row is still open
  const rows = Array.from({ length: 999 }, (_, i) => row('d' + i, 100, { status: 2 })).concat(row('open', 1));
  assert.equal(L.progress(rows), 99);
});

test('moveRow keeps the chain anchor in the first slot', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30), row('c', 30)];
  const m = L.moveRow(rows, 2, 0, true);
  assert.deepEqual(m.map((r) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(m.map((r) => r.start), [H(9), null, null]);
  assert.equal(L.moveRow(rows, 1, 1, true), rows);
});
test('moveRow unchained: starts travel with their rows', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10) }), row('c', 30)];
  const m = L.moveRow(rows, 0, 2, false);
  assert.deepEqual(m.map((r) => [r.id, r.start]), [['b', H(10)], ['c', null], ['a', H(9)]]);
});
test('removeRow keeps the chain anchor when the first row goes', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30), row('c', 30)];
  const m = L.removeRow(rows, 'a', true);
  assert.deepEqual(m.map((r) => [r.id, r.start]), [['b', H(9)], ['c', null]]);
  assert.deepEqual(L.removeRow([], 'a', true), []);
});
test('chainOn discards every lower start and keeps the first', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10) }), row('c', 30, { start: H(12) })];
  assert.deepEqual(L.chainOn(rows).map((r) => r.start), [H(9), null, null]);
});

test('serialize stores finished rows only and carries the anchor', () => {
  const state = { chain: true, times: true, rows: [{ id: 'd', name: '', mins: 0, status: 0, start: H(8) }, row('a', 30)] };
  const out = L.serialize(state);
  assert.deepEqual(out.rows.map((r) => [r.id, r.start]), [['a', H(8)]]);
  assert.equal(out.v, 1);
  assert.equal(out.times, true);
  assert.equal(out.chain, true);
});
test('hydrate round-trips and defends against bad data', () => {
  const state = { chain: false, times: true, rows: [row('a', 30, { start: H(9), status: 2 }), row('b', 60, { start: H(11) })] };
  assert.deepEqual(L.hydrate(L.serialize(state)), state);
  const h = L.hydrate({ rows: [row('ok', 5), { id: 1 }, null, { id: 'z', name: 'z', mins: -3 }, { id: 'q', name: 'q', mins: 10, status: 9, start: 99999 }] });
  assert.deepEqual(h.rows.map((r) => r.id), ['ok', 'q']);
  assert.equal(h.rows[1].status, 0);
  assert.equal(h.rows[1].start, null);
  assert.equal(h.chain, true);
  assert.equal(h.times, false);
  assert.deepEqual(L.hydrate(undefined), { rows: [], times: false, chain: true });
});
test('hydrate keeps the starts that cut a chained list', () => {
  const h = L.hydrate({ chain: true, rows: [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10) })] });
  assert.deepEqual(h.rows.map((r) => r.start), [H(9), H(10)]);
});
test('hydrate keeps one row per id and caps name length', () => {
  const h = L.hydrate({ rows: [row('x', 10), row('x', 20), { ...row('long', 5), name: 'n'.repeat(500) }] });
  assert.deepEqual(h.rows.map((r) => [r.id, r.mins]), [['x', 10], ['long', 5]]);
  assert.equal(h.rows[1].name.length, 200);
});

test('durationFromEnd: minutes forward from the start, wrapping past midnight', () => {
  assert.equal(L.durationFromEnd(H(9), H(10, 30)), 90);
  assert.equal(L.durationFromEnd(H(9), H(9, 5)), 5);
  assert.equal(L.durationFromEnd(H(23, 15), H(1, 15)), 120);
  assert.equal(L.durationFromEnd(H(9), H(8)), 23 * 60, 'earlier clock time means the next day');
  assert.equal(L.durationFromEnd(H(9), H(9)), null, 'zero is not a duration');
  assert.equal(L.durationFromEnd(null, H(9)), null);
  assert.equal(L.durationFromEnd(H(9), null), null);
});

test('durationOnDone: finishing now sets start-to-now, and keeps the plan when finished early', () => {
  assert.equal(L.durationOnDone(H(9), H(9, 40)), 40);
  assert.equal(L.durationOnDone(H(23, 30), H(0, 10)), 40, 'past midnight');
  assert.equal(L.durationOnDone(H(9), H(21)), 720, 'exactly 12 hours is still a real duration');
  assert.equal(L.durationOnDone(H(15), H(13)), null, 'start is 2 hours ahead: finished early, keep the plan');
  assert.equal(L.durationOnDone(H(9), H(9)), null, 'same minute: nothing to record');
  assert.equal(L.durationOnDone(null, H(9)), null);
});

test('moveRow chained: an unstarted first row keeps its plan in the first slot', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30), row('c', 30)];
  assert.deepEqual(L.moveRow(rows, 0, 2, true).map((r) => [r.id, r.start]), [['b', H(9)], ['c', null], ['a', null]]);
  assert.deepEqual(L.moveRow(rows, 2, 1, true).map((r) => [r.id, r.start]), [['a', H(9)], ['c', null], ['b', null]]);
});
test('moveRow chained: a started row keeps its own start wherever it goes', () => {
  const rows = [row('a', 30, { start: H(9, 10), status: 1 }), row('b', 30), row('c', 30, { start: H(11), status: 1 })];
  // an unstarted row goes on top of a started one: the started row keeps 9:10, the top row has no start
  assert.deepEqual(L.moveRow(rows, 1, 0, true).map((r) => [r.id, r.start]), [['b', null], ['a', H(9, 10)], ['c', H(11)]]);
  // a started row with its own start moves down: nothing changes hands
  assert.deepEqual(L.moveRow(rows, 2, 1, true).map((r) => [r.id, r.start]), [['a', H(9, 10)], ['c', H(11)], ['b', null]]);
});
test('moveRow chained: a plan is dropped when a started row takes the top', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10), status: 1 })];
  assert.deepEqual(L.moveRow(rows, 1, 0, true).map((r) => [r.id, r.start]), [['b', H(10)], ['a', null]]);
});
test('removeRow chained: the plan moves to the next row; a started first row takes its start with it', () => {
  const plan = [row('a', 30, { start: H(9) }), row('b', 30), row('c', 30, { start: H(11), status: 1 })];
  assert.deepEqual(L.removeRow(plan, 'a', true).map((r) => [r.id, r.start]), [['b', H(9)], ['c', H(11)]]);
  const started = [row('a', 30, { start: H(9), status: 2 }), row('b', 30)];
  assert.deepEqual(L.removeRow(started, 'a', true).map((r) => [r.id, r.start]), [['b', null]]);
  const lower = [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10), status: 1 }), row('c', 30)];
  assert.deepEqual(L.removeRow(lower, 'b', true).map((r) => [r.id, r.start]), [['a', H(9)], ['c', null]]);
});
test('moveRow and removeRow unchained never touch starts', () => {
  const rows = [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10) }), row('c', 30)];
  assert.deepEqual(L.moveRow(rows, 0, 2, false).map((r) => [r.id, r.start]), [['b', H(10)], ['c', null], ['a', H(9)]]);
  assert.deepEqual(L.removeRow(rows, 'a', false).map((r) => [r.id, r.start]), [['b', H(10)], ['c', null]]);
});
test('serialize keeps cuts in a chained list', () => {
  const state = { chain: true, times: true, rows: [row('a', 30, { start: H(9) }), row('b', 30, { start: H(10, 35), status: 1 }), row('c', 30)] };
  assert.deepEqual(L.serialize(state).rows.map((r) => r.start), [H(9), H(10, 35), null]);
});

test('fmtDurLong spells out hours and minutes, joined with "and", dropping an empty unit', () => {
  assert.equal(L.fmtDurLong(150), '2 hours and 30 minutes');
  assert.equal(L.fmtDurLong(61), '1 hour and 1 minute');
  assert.equal(L.fmtDurLong(60), '1 hour');
  assert.equal(L.fmtDurLong(120), '2 hours');
  assert.equal(L.fmtDurLong(45), '45 minutes');
  assert.equal(L.fmtDurLong(1), '1 minute');
  assert.equal(L.fmtDurLong(0), '0 minutes');
  for (let m = 1; m < 1500; m++) assert.ok(!/\b0 (hours?|minutes?)\b/.test(L.fmtDurLong(m)), `${m} -> ${L.fmtDurLong(m)}`);
});

test('allDone needs a finished row and every finished row done; unfinished rows do not count', () => {
  const draft = { id: 'x', name: '', mins: 0, status: 0, start: null };
  assert.equal(L.allDone([]), false);
  assert.equal(L.allDone([draft]), false, 'a draft alone is not an assignment');
  assert.equal(L.allDone([row('a', 30)]), false);
  assert.equal(L.allDone([row('a', 30, { status: 1 })]), false, 'in progress is not done');
  assert.equal(L.allDone([row('a', 30, { status: 2 })]), true);
  assert.equal(L.allDone([row('a', 30, { status: 2 }), row('b', 30, { status: 1 })]), false);
  assert.equal(L.allDone([row('a', 30, { status: 2 }), row('b', 45, { status: 2 })]), true);
  assert.equal(L.allDone([row('a', 30, { status: 2 }), draft]), true, 'the draft is ignored, as in progress');
});

test('totalMins adds up the finished rows only', () => {
  assert.equal(L.totalMins([]), 0);
  assert.equal(L.totalMins([row('a', 30, { status: 2 }), row('b', 90, { status: 2 })]), 120);
  assert.equal(L.totalMins([row('a', 30, { status: 2 }), { id: 'x', name: '', mins: 15, status: 0, start: null }]), 30);
  assert.equal(L.progress([row('a', 30, { status: 2 }), row('b', 90, { status: 2 })]), 100, 'allDone agrees with progress');
});

test('countLabel is singular only for one', () => {
  assert.equal(L.countLabel(1), '1 assignment');
  assert.equal(L.countLabel(2), '2 assignments');
  assert.equal(L.countLabel(30), '30 assignments');
});

test('cleanName tidies whitespace and stops at 40 characters', () => {
  assert.equal(L.cleanName('  Mary   Ann '), 'Mary Ann');
  assert.equal(L.cleanName('\n\tSam\t'), 'Sam');
  assert.equal(L.cleanName(''), '');
  assert.equal(L.cleanName('   '), '');
  assert.equal(L.cleanName(null), '');
  assert.equal(L.cleanName(undefined), '');
  assert.equal(L.cleanName('x'.repeat(60)), 'x'.repeat(40));
  assert.equal(L.cleanName('a'.repeat(39) + ' b'), 'a'.repeat(39), 'no dangling space when the cut lands on one');
});

test('doneLead speaks to you without a name and names them with one', () => {
  assert.equal(L.doneLead(''), 'You finished all of your assignments in');
  assert.equal(L.doneLead('   '), 'You finished all of your assignments in');
  assert.equal(L.doneLead(null), 'You finished all of your assignments in');
  assert.equal(L.doneLead('Sam'), 'Sam finished all of their assignments in');
  assert.equal(L.doneLead('  Mary   Ann '), 'Mary Ann finished all of their assignments in');
});
