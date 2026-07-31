import { chromium } from 'playwright';

const URL = (process.env.BASE_URL || 'http://localhost:8765') + '/index.html';
const out = [];
const ok = (c, m) => out.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);

const PROBE = `
  window.__spins = [];
  document.addEventListener('DOMContentLoaded', () => {
    const w = document.getElementById('wheel');
    const read = () => {
      const t = /^transform (\\d+)ms/.exec(w.style.transition || '');
      const r = /rotate\\(([-\\d.]+)deg\\)/.exec(w.style.transform || '');
      return { ms: t ? +t[1] : null, rot: r ? +r[1] : 0 };
    };
    let last = read();
    new MutationObserver(() => {
      const cur = read();
      if (cur.ms !== null && cur.rot !== last.rot) window.__spins.push(cur);
      last = cur;
    }).observe(w, { attributes: true, attributeFilter: ['style'] });
  });
`;

let browser;
process.on('uncaughtException', e => { console.log(out.join('\n')); console.log('\nTHREW: ' + e.message); process.exit(1); });
browser = await chromium.launch();

const NOLOSE = { losers: 0, lockRestart: false, songs: Array.from({ length: 24 }, (_, i) => ({ title: 'S' + i, artist: 'A' })) };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.addInitScript(PROBE);
  // These suites are about the gestures, not the first-visit nudge — arriving as
  // a player who has already flicked keeps the wheel still until they act.
  await page.addInitScript(() => localStorage.setItem('roulette:flicked', '1'));
  await page.addInitScript(st => localStorage.setItem('roulette:settings', JSON.stringify(st)), opts.settings || NOLOSE);
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('#wheel path').length > 0);

  const b = await page.locator('#wrap').boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  // clockwise from 12 o'clock, at 30% of the wheel's width from centre (mid-annulus)
  const at = (deg, frac = 0.30) => {
    const r = deg * Math.PI / 180, d = b.width * frac;
    return [cx + d * Math.sin(r), cy - d * Math.cos(r)];
  };
  return { page, errs, box: b, at };
}

const rot = p => p.$eval('#wheel', el => {
  const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || 'rotate(0deg)');
  return m ? +m[1] : 0;
});
const trans = p => p.$eval('#wheel', el => el.style.transition || '');
const spins = p => p.evaluate(() => window.__spins);
const listLen = p => p.$$eval('#setlist li', n => n.length);
const mode = p => p.$eval('#spin', el => el.dataset.mode);
const isDragging = p => p.$eval('#wrap', el => el.classList.contains('dragging'));
const settle = (p, t = 15000) =>
  p.waitForFunction(() => ['spin', 'locked', 'again'].includes(document.querySelector('#spin').dataset.mode), null, { timeout: t });

// Sweep the pointer along the wheel's arc. `stepMs` throttles it to set the speed.
async function arc(page, at, { from = 0, deg = 90, steps = 12, stepMs = 0, down = true, up = true, pause = 0, frac = 0.30 }) {
  if (down) { await page.mouse.move(...at(from, frac)); await page.mouse.down(); }
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(...at(from + deg * i / steps, frac));
    if (stepMs) await page.waitForTimeout(stepMs);
  }
  if (pause) await page.waitForTimeout(pause);
  if (up) await page.mouse.up();
}

// --- 1. the wheel follows the finger ----------------------------------------
{
  const { page, errs, at } = await newPage();
  const before = await rot(page);
  await arc(page, at, { deg: 90, up: false });
  const during = await rot(page);
  const tr = await trans(page);
  const dragged = await isDragging(page);
  await page.mouse.up();
  await page.waitForTimeout(300);

  ok(Math.abs(during - before - 90) < 2, `drag of 90deg turns the wheel 90deg (got ${(during - before).toFixed(1)})`);
  ok(tr === 'none', `no transition while dragging (got "${tr}")`);
  ok(dragged, 'wrap is marked dragging during the gesture');
  ok(!(await isDragging(page)), 'dragging class cleared on release');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// Flick at a chosen angular speed, dispatched in-page. The mouse API's speed is
// whatever the driver and the machine manage — around 450 deg/s here, less on a
// loaded CI runner — so anything asserting on *power* sets its own spacing.
// Returns the speed actually achieved, for the failure message.
async function flickAt(page, degPerSec, { totalDeg = 120, steps = 8 } = {}) {
  const measured = await page.evaluate(async ({ degPerSec, totalDeg, steps }) => {
    const wrap = document.getElementById('wrap'), b = wrap.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, d = b.width * 0.30;
    const at = deg => ({ clientX: cx + d * Math.sin(deg * Math.PI / 180),
                         clientY: cy - d * Math.cos(deg * Math.PI / 180) });
    const stepDeg = totalDeg / steps, stepMs = stepDeg / degPerSec * 1000;
    wrap.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, bubbles: true, cancelable: true, ...at(0) }));
    const t0 = performance.now();
    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, stepMs));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, bubbles: true, ...at(i * stepDeg) }));
    }
    const speed = totalDeg / (performance.now() - t0) * 1000;
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true, ...at(totalDeg) }));
    return speed;
  }, { degPerSec, totalDeg, steps });
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'busy', null, { timeout: 3000 });
  return measured;
}

// --- 2. flick speed picks the spin ------------------------------------------
{
  const { page, errs, at } = await newPage();
  // First a real mouse flick, to prove the actual pointer path works end to
  // end. Nothing is asserted about its power — that's the driver's speed.
  await arc(page, at, { deg: 90, steps: 12, stepMs: 0 });
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'busy', null, { timeout: 3000 });
  await settle(page);
  ok((await spins(page)).length === 1, `a mouse flick spins (launches=${(await spins(page)).length})`);
  ok(await listLen(page) === 1, `and lands exactly one song (got ${await listLen(page)})`);

  const slow = await flickAt(page, 260);
  await settle(page);
  const brisk = await flickAt(page, 500);
  await settle(page);
  const s = await spins(page);

  ok(s.length === 3, `each flick launched exactly once (got ${s.length})`);
  ok(s[1].ms > 1400, `a slow flick still spins (${s[1].ms}ms at ~${slow | 0} deg/s)`);
  ok(s[2].ms > s[1].ms, `a brisker flick spins longer (${s[2].ms}ms at ~${brisk | 0} deg/s vs ${s[1].ms}ms)`);
  ok(s[2].ms < 4600, `and is not yet full power (${s[2].ms}ms)`);
  ok(await listLen(page) === 3, `3 flicks landed 3 songs (got ${await listLen(page)})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 2b. full power, and the instant-flick edge case -------------------------
// The driver tops out around 450 deg/s, so a genuinely fast flick has to be
// dispatched in-page. All the moves land in one task, which is also the case
// where the elapsed time can round to zero.
{
  const { page, errs } = await newPage();
  const span = await page.evaluate(() => {
    const wrap = document.getElementById('wrap'), b = wrap.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, d = b.width * 0.30;
    const at = deg => ({ clientX: cx + d * Math.sin(deg * Math.PI / 180),
                         clientY: cy - d * Math.cos(deg * Math.PI / 180) });
    const fire = (type, deg) => wrap.dispatchEvent(new PointerEvent(type, {
      pointerId: 7, bubbles: true, cancelable: true, ...at(deg) }));
    const t0 = performance.now();
    fire('pointerdown', 0);
    for (let i = 1; i <= 8; i++) window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 7, bubbles: true, ...at(i * 15) }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true, ...at(120) }));
    return performance.now() - t0;
  });
  await page.waitForTimeout(400);
  const s = (await spins(page)).at(-1);
  ok(s && s.ms === 4600, `an instant 120deg flick is full power (${s && s.ms}ms, dispatched over ${span.toFixed(2)}ms)`);
  ok((await spins(page)).length === 1, `and fires exactly once (got ${(await spins(page)).length})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 3. a drag that stops before release doesn't spin ------------------------
{
  const { page, errs, at } = await newPage();
  const before = await rot(page);
  await arc(page, at, { deg: 90, steps: 12, stepMs: 0, pause: 300 });
  await page.waitForTimeout(500);

  ok((await spins(page)).length === 0, `stopping before release doesn't spin (launches=${(await spins(page)).length})`);
  ok(await listLen(page) === 0, 'nothing landed in the setlist');
  ok(Math.abs((await rot(page)) - before - 90) < 2, 'the wheel stays where it was dragged to');
  ok(await mode(page) === 'spin', 'hub is still ready to spin');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 4. backwards gives a little, then blocks -------------------------------
{
  const { page, errs, at } = await newPage();
  const before = await rot(page);
  await arc(page, at, { deg: -90, steps: 12, up: false });
  const held = await rot(page);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await rot(page);

  ok(Math.abs(held - before + 18) < 2, `backwards blocks at ~18deg of give (got ${(held - before).toFixed(1)})`);
  ok(Math.abs(after - before) < 1, `releasing from the stop springs back (got ${(after - before).toFixed(1)})`);
  ok((await spins(page)).length === 0, `a backwards drag never spins (launches=${(await spins(page)).length})`);

  // and a fast backwards flick is no different
  await arc(page, at, { deg: -120, steps: 14, stepMs: 0 });
  await page.waitForTimeout(500);
  ok((await spins(page)).length === 0, `a backwards flick never spins (launches=${(await spins(page)).length})`);
  ok(await listLen(page) === 0, 'and lands nothing');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 5. forwards works immediately after hitting the stop -------------------
{
  const { page, errs, at } = await newPage();
  const before = await rot(page);
  await arc(page, at, { from: 0, deg: -90, steps: 12, up: false });     // pinned at the stop
  await arc(page, at, { from: -90, deg: 30, steps: 6, down: false, up: false });
  const fwd = await rot(page);
  await page.mouse.up();
  await page.waitForTimeout(400);

  ok(Math.abs(fwd - before - 12) < 3,
     `30deg forward from the stop moves 12deg, not 0 (got ${(fwd - before).toFixed(1)})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 6. a tap on the wedges does nothing ------------------------------------
{
  const { page, errs, at } = await newPage();
  const before = await rot(page);
  await page.mouse.move(...at(0));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(400);

  ok((await spins(page)).length === 0, `tapping the wedges doesn't spin (launches=${(await spins(page)).length})`);
  ok(await rot(page) === before, 'and doesn\'t move the wheel');
  ok(await listLen(page) === 0, 'and lands nothing');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 7. the wedge flip during a drag, and its undo --------------------------
{
  const { page, errs, at } = await newPage();
  const reds = () => page.$$eval('#wheel path', ns => ns.filter(n => n.getAttribute('fill') === '#bf2f38').length);
  const golds = () => page.$$eval('#wheel path', ns => ns.filter(n => n.getAttribute('fill') === '#e9b44c').length);

  await arc(page, at, { deg: 90, steps: 12, stepMs: 0 });   // flick to land one
  await settle(page);
  const [r0, g0] = [await reds(), await golds()];
  ok(g0 === 1, `a landed song leaves one gold wedge (got ${g0})`);

  // a tap must not flip it
  await page.mouse.move(...at(0)); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(150);
  ok(await golds() === g0, 'a tap on the wedges does not flip the pending wedge');

  // a real drag does
  await arc(page, at, { deg: 60, steps: 8, stepMs: 10, up: false });
  ok(await reds() === r0 + 1 && await golds() === 0, `the gold wedge reddens during the drag (${g0}/${r0} -> ${await golds()}/${await reds()})`);
  await page.waitForTimeout(300);   // stop, so the release is not a flick
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok(await reds() === r0 && await golds() === g0, 'ending the drag without a flick puts the wedge back');
  ok((await spins(page)).length === 1, `and no second spin fired (launches=${(await spins(page)).length})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 8. the hub and the corners are not the wheel ---------------------------
{
  const { page, errs, at, box } = await newPage();
  // a drag starting in the square's corner
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  const corner = await isDragging(page);
  await page.mouse.move(...at(45));
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok(!corner, 'a press in the wrap corner starts no drag');
  ok((await spins(page)).length === 0, `and cannot spin (launches=${(await spins(page)).length})`);

  // a press just inside the hub still charges the hub, not the wheel
  await page.mouse.move(...at(0, 0.08));
  await page.mouse.down();
  await page.waitForTimeout(300);
  ok(await page.$eval('#spin', el => el.classList.contains('charging')), 'a press on the hub still charges it');
  ok(!(await isDragging(page)), 'and starts no wheel drag');
  await page.mouse.up();
  await settle(page);
  ok(await listLen(page) === 1, 'the hub hold still lands a song');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 9. inert while spinning, and after the set ends -------------------------
{
  const { page, errs, at } = await newPage();
  await arc(page, at, { deg: 90, steps: 12, stepMs: 0 });
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'busy', null, { timeout: 3000 });
  await page.mouse.move(...at(0));
  await page.mouse.down();
  const midSpin = await isDragging(page);
  await page.mouse.up();
  ok(!midSpin, 'no drag can start while the wheel is spinning');
  await settle(page);
  ok((await spins(page)).length === 1, `still exactly one launch (got ${(await spins(page)).length})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}
{
  const { page, errs, at } = await newPage({ settings: { losers: 30, lockRestart: true, songs: [{ title: 'Solo', artist: 'X' }] } });
  await page.$eval('#spin', el => el.click());
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'locked', null, { timeout: 20000 });
  const before = (await spins(page)).length;
  await arc(page, at, { deg: 90, steps: 12, stepMs: 0 });
  await page.waitForTimeout(400);
  ok(!(await isDragging(page)) && (await spins(page)).length === before, 'the wheel is inert during the end-of-set countdown');
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'again', null, { timeout: 20000 });
  await arc(page, at, { deg: 90, steps: 12, stepMs: 0 });
  await page.waitForTimeout(400);
  ok((await spins(page)).length === before, 'and inert in play-again mode');
  ok(await mode(page) === 'again', 'a flick does not restart the set');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 10. releasing far off the wheel still spins ----------------------------
{
  const { page, errs, at } = await newPage();
  // the finger slides outward off the rim as it flicks, and lets go outside
  await arc(page, at, { deg: 60, steps: 8, stepMs: 0, up: false });
  await arc(page, at, { from: 60, deg: 60, steps: 8, stepMs: 0, down: false, up: false, frac: 0.75 });
  const outside = await isDragging(page);
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok(outside, 'the drag survives the pointer leaving the wheel');
  ok((await spins(page)).length === 1, `a flick released off the wheel still spins (launches=${(await spins(page)).length})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 11. cancel paths --------------------------------------------------------
{
  const { page, errs, at } = await newPage();
  await arc(page, at, { deg: 60, steps: 8, stepMs: 5, up: false });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  ok(!(await isDragging(page)), 'tabbing away mid-drag ends the drag');
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok((await spins(page)).length === 0, `and the release afterwards does not spin (launches=${(await spins(page)).length})`);
  ok(await mode(page) === 'spin', 'hub is still ready');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 12. Apply & restart mid-drag -------------------------------------------
{
  const { page, errs, at } = await newPage();
  await page.$eval('#gear', el => el.click());
  await page.waitForTimeout(100);
  await page.$eval('#cancelSettings', el => el.click());
  await page.waitForTimeout(100);

  await arc(page, at, { deg: 60, steps: 8, stepMs: 5, up: false });
  await page.evaluate(() => document.getElementById('settingsForm')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  await page.waitForTimeout(200);
  ok(!(await isDragging(page)), 'restart clears an in-flight drag');
  ok(await rot(page) === 0, 'wheel snaps back to 0deg');
  await page.mouse.up();
  await page.waitForTimeout(600);
  ok((await spins(page)).length === 0, `no spin fires after a mid-drag restart (launches=${(await spins(page)).length})`);
  ok(await listLen(page) === 0, 'setlist still empty');

  await arc(page, at, { deg: 90, steps: 12, stepMs: 0 });
  await page.waitForTimeout(400);
  ok((await spins(page)).length === 1, 'and the flick works again afterwards');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

await browser.close();
console.log(out.join('\n'));
const failed = out.filter(l => l.startsWith('FAIL'));
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
