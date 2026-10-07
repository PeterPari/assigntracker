// Unit tests for the pure logic block of index.html (between the <logic> markers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDEX } from './harness.mjs';

const html = readFileSync(INDEX, 'utf8');
const block = html.match(/\/\* <logic> \*\/([\s\S]*?)\/\* <\/logic> \*\//)[1];
const L = new Function(`${block}; return { fmtDur, fmtDurLong, allDone, totalMins, countLabel, fmtClock, startFromParts, durationFromEnd, durationOnDone, isComplete, schedule, progress, moveRow, removeRow, chainOn, keepPlan, serialize, hydrate, cleanRow, validDue, colsOf, subjectKey, csvCell, stamp, SAVE_HEADER, saveKey, saveRecord, savedIds, savesCsv };`)();

const row = (id, mins, o = {}) => ({ id, name: id, mins, status: 0, start: null, subject: '', due: null, type: '', ...o });
const NO_COLS = { subject: false, due: false, type: false };
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
  const state = { chain: false, times: true, cols: { subject: true, due: false, type: true }, rows: [row('a', 30, { start: H(9), status: 2, subject: 'Math', due: '2026-10-14', type: 'Quiz' }), row('b', 60, { start: H(11) })] };
  assert.deepEqual(L.hydrate(L.serialize(state)), state);
  const h = L.hydrate({ rows: [row('ok', 5), { id: 1 }, null, { id: 'z', name: 'z', mins: -3 }, { id: 'q', name: 'q', mins: 10, status: 9, start: 99999 }] });
  assert.deepEqual(h.rows.map((r) => r.id), ['ok', 'q']);
  assert.equal(h.rows[1].status, 0);
  assert.equal(h.rows[1].start, null);
  assert.equal(h.chain, true);
  assert.equal(h.times, false);
  assert.deepEqual(L.hydrate(undefined), { rows: [], times: false, chain: true, cols: NO_COLS });
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

test('validDue accepts only real calendar days written YYYY-MM-DD', () => {
  assert.equal(L.validDue('2026-10-14'), '2026-10-14');
  assert.equal(L.validDue('2028-02-29'), '2028-02-29');
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '10/14/2026', '2026-1-4', '', ' 2026-10-14', null, undefined, 20261014, {}]) {
    assert.equal(L.validDue(bad), null, String(bad));
  }
});
test('cleanRow keeps subject, due date and type, and defends against bad ones', () => {
  const ok = L.cleanRow({ id: 'a', name: 'a', mins: 10, subject: 'Math', due: '2026-10-14', type: 'Quiz' });
  assert.deepEqual([ok.subject, ok.due, ok.type], ['Math', '2026-10-14', 'Quiz']);
  const bad = L.cleanRow({ id: 'b', name: 'b', mins: 10, subject: 7, due: '2026-02-30', type: { x: 1 } });
  assert.deepEqual([bad.subject, bad.due, bad.type], ['', null, '']);
  const long = L.cleanRow({ id: 'c', name: 'c', mins: 10, subject: 's'.repeat(300), type: 't'.repeat(300) });
  assert.deepEqual([long.subject.length, long.type.length], [100, 100]);
});
test('none of the three extra fields is needed for a row to be finished', () => {
  assert.equal(L.isComplete(row('a', 5)), true);
  assert.equal(L.isComplete(row('a', 5, { subject: 'Math', due: '2026-10-14', type: 'Quiz' })), true);
  assert.equal(L.isComplete(row('', 5, { subject: 'Math' })), false);
});
test('serialize writes the column choices and trims the text; hydrate reads them back', () => {
  const out = L.serialize({ chain: true, times: false, cols: { subject: true, due: true, type: false }, rows: [row('a', 30, { subject: '  Math ', type: ' Quiz  ', due: '2026-10-14' })] });
  assert.deepEqual(out.cols, { subject: true, due: true, type: false });
  assert.deepEqual([out.rows[0].subject, out.rows[0].type, out.rows[0].due], ['Math', 'Quiz', '2026-10-14']);
  assert.deepEqual(L.hydrate(out).cols, { subject: true, due: true, type: false });
});
test('an old document with no column fields loads with every column hidden and empty', () => {
  const h = L.hydrate({ v: 1, times: true, chain: false, rows: [{ id: 'a', name: 'a', mins: 30, status: 1, start: H(9) }] });
  assert.deepEqual(h.cols, NO_COLS);
  assert.deepEqual([h.rows[0].subject, h.rows[0].due, h.rows[0].type], ['', null, '']);
  assert.deepEqual(L.hydrate({ cols: { subject: 'yes', due: 1, type: true } }).cols, { subject: false, due: false, type: true }, 'only true turns a column on');
  assert.deepEqual(L.hydrate({ cols: 'x' }).cols, NO_COLS);
});

test('csvCell quotes what needs it and keeps a spreadsheet from running text as a formula', () => {
  assert.equal(L.csvCell('plain'), 'plain');
  assert.equal(L.csvCell(45), '45');
  assert.equal(L.csvCell(''), '');
  assert.equal(L.csvCell('a, b'), '"a, b"');
  assert.equal(L.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(L.csvCell('two\nlines'), '"two\nlines"');
  assert.equal(L.csvCell('=1+1'), "'=1+1");
  assert.equal(L.csvCell('-5 problems'), "'-5 problems");
  assert.equal(L.csvCell('@sum'), "'@sum");
  assert.equal(L.csvCell('+1,2'), '"\'+1,2"', 'defused first, then quoted');
  assert.equal(L.csvCell('a=b'), 'a=b', 'only a leading character counts');
  assert.equal(L.csvCell(-3), '-3', 'numbers are not text');
});

test('stamp is local date and time, zero padded', () => {
  assert.equal(L.stamp(new Date(2026, 9, 5, 14, 3, 9)), '2026-10-05 14:03:09');
  assert.equal(L.stamp(new Date(2026, 0, 2, 0, 0, 0)), '2026-01-02 00:00:00');
});

test('saveKey is the time, zero padded so keys sort by time, then the random tail', () => {
  assert.equal(L.saveKey(1791504903000, 'abc123'), '001791504903000-abc123');
  assert.equal(L.saveKey(5, 'x'), '000000000000005-x');
  assert.ok(L.saveKey(999, 'z') < L.saveKey(1000, 'a'), 'an earlier save sorts first, whatever its tail');
});

test('saveRecord: every finished row with every field, the worked-out start and end, stamped, in list order', () => {
  const s = { rows: [
    row('Read ch. 4', 45, { status: 2, subject: 'Biology', due: '2026-10-09', type: 'Homework', start: H(15, 30) }),
    row('Essay', 90, { subject: ' English ' }),
  ], times: false, chain: true, cols: NO_COLS };
  assert.deepEqual(L.saveRecord(s, '2026-10-05 14:03:09', 'K'), {
    v: 1, k: 'K', at: '2026-10-05 14:03:09',
    rows: [
      { id: 'Read ch. 4', name: 'Read ch. 4', subject: 'Biology', type: 'Homework', due: '2026-10-09', status: 2, mins: 45, start: H(15, 30), end: H(16, 15) },
      { id: 'Essay', name: 'Essay', subject: 'English', type: '', due: null, status: 0, mins: 90, start: H(16, 15), end: H(17, 45) },
    ],
  }, 'the chained start follows the row above; text is trimmed; columns hidden in the menu are saved anyway');
});

test('saveRecord: unchained rows use only their own start; unfinished rows are left out; nothing finished is null', () => {
  const s = { rows: [row('a', 30, { status: 1, start: H(23, 45) }), row('b', 30), row('', 20), row('c', 0)], times: true, chain: false, cols: NO_COLS };
  const rec = L.saveRecord(s, 'T', 'K');
  assert.deepEqual(rec.rows.map((r) => [r.id, r.start, r.end]), [['a', H(23, 45), H(0, 15)], ['b', null, null]], 'an end past midnight wraps');
  assert.equal(L.saveRecord({ rows: [row('', 30), row('x', 0)], times: false, chain: true, cols: NO_COLS }, 'T', 'K'), null);
  assert.equal(L.saveRecord({ rows: [], times: false, chain: true, cols: NO_COLS }, 'T', 'K'), null);
});

const rec = (k, at, rows) => ({ v: 1, k, at, rows });
const srow = (id, o = {}) => ({ id, name: id, subject: '', type: '', due: null, status: 2, mins: 30, start: null, end: null, ...o });

test('savedIds collects every assignment id across saves, and ignores what is malformed', () => {
  const ids = L.savedIds([
    rec('1', 'T', [srow('a'), srow('b')]),
    rec('2', 'T', [srow('b'), srow('c'), null, { name: 'no id' }, { id: '' }, { id: 5 }]),
    null, 'junk', { rows: [srow('nokey')] }, { k: '3', rows: 'nope' },
  ]);
  assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
  assert.equal(L.savedIds([]).size, 0);
});

test('savesCsv: the header, then every saved row, oldest save first, with the ID column', () => {
  const csv = L.savesCsv([
    rec('002', '2026-10-06 21:00:00', [srow('a', { name: 'Read ch. 4', subject: 'Biology', type: 'Homework', due: '2026-10-09', mins: 50, start: H(15, 30), end: H(16, 20) })]),
    rec('001', '2026-10-05 22:15:03', [
      srow('a', { name: 'Read ch. 4', subject: 'Biology', type: 'Homework', due: '2026-10-09', status: 1, mins: 45, start: H(15, 30), end: H(16, 15) }),
      srow('b', { name: 'Essay "draft", v2', status: 0, mins: 90 }),
    ]),
  ]);
  assert.equal(csv, [
    'Saved,Status,Assignment,Subject,Due,Type,Minutes,Start,End,ID',
    '2026-10-05 22:15:03,In progress,Read ch. 4,Biology,2026-10-09,Homework,45,3:30 PM,4:15 PM,a',
    '2026-10-05 22:15:03,Not started,"Essay ""draft"", v2",,,,90,,,b',
    '2026-10-06 21:00:00,Done,Read ch. 4,Biology,2026-10-09,Homework,50,3:30 PM,4:20 PM,a',
    '',
  ].join('\n'));
  assert.equal(L.SAVE_HEADER, 'Saved,Status,Assignment,Subject,Due,Type,Minutes,Start,End,ID\n');
});

test('savesCsv is empty with nothing saved, and keeps bad shared data from breaking the file or running as a formula', () => {
  assert.equal(L.savesCsv([]), '');
  assert.equal(L.savesCsv([null, { rows: [srow('nokey')] }, rec('1', 'T', [])]), '');
  const csv = L.savesCsv([rec('1', 5, [
    srow('=cmd', { name: '=HYPERLINK("x")', subject: 7, type: null, due: {}, status: 'length', mins: 'many', start: 99999, end: -1 }),
  ])]);
  assert.equal(csv.split('\n')[1], `,Not started,"'=HYPERLINK(""x"")",,,,,,,'=cmd`);
});

test('subjectKey maps the eight classes, in any case and spacing', () => {
  for (const k of ['math', 'history', 'english', 'physics', 'french', 'aics', 'philosophy', 'research']) {
    assert.equal(L.subjectKey(k), k);
    assert.equal(L.subjectKey(`  ${k.toUpperCase()} `), k);
  }
});
test('subjectKey accepts common aliases and course names', () => {
  const cases = {
    math: ['Maths', 'Mathematics', 'Pre-Calculus', 'precalc', 'Calculus', 'Algebra 2', 'Geometry', 'Statistics'],
    history: ['US History', 'Advanced US History B', 'World History', 'hist'],
    english: ['English 11', 'English 11: American Literature-A', 'Lit', 'Literature'],
    physics: ['Classical Physics A', 'Physics'],
    french: ['French IV', 'french 4'],
    aics: ['AICS', 'AI', 'CS', 'Comp Sci', 'Computer Science', 'Adv. AI & Comp Sci'],
    philosophy: ['Phil', 'Western Philosophy', 'Introduction to Western Philosophy'],
    research: ['Research Practicum B', 'Practicum', 'research paper'],
  };
  for (const [key, subjects] of Object.entries(cases)) for (const s of subjects) assert.equal(L.subjectKey(s), key, s);
});
test('subjectKey is empty for an unknown, blank or missing subject', () => {
  for (const s of ['', '   ', 'Gym', 'Chemistry', 'Maintenance', 'Chair', 'Air quality', 'Aim', 'CSV', 'Philip', 'Historic', null, undefined]) assert.equal(L.subjectKey(s), '', String(s));
});
