import { chromium } from 'playwright';

const URL = (process.env.BASE_URL || 'http://localhost:8765') + '/index.html';
const out = [];
const ok = (c, m) => out.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);

// Non-invasive probe: watch #wheel's style attribute and record each launch
// (a transform transition with a fresh target rotation).
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
process.on('uncaughtException',e=>{console.log(out.join('\n'));console.log('\nTHREW: '+e.message);process.exit(1);});
browser = await chromium.launch();

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
  if (opts.settings) await page.addInitScript(
    st => localStorage.setItem('roulette:settings', JSON.stringify(st)), opts.settings);
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('#wheel path').length > 0);
  return { page, errs };
}

const hub = '#spin';
const rot = p => p.$eval('#wheel', el => {
  const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || 'rotate(0deg)');
  return m ? +m[1] : 0;
});
const spins = p => p.evaluate(() => window.__spins);
const listLen = p => p.$$eval('#setlist li', n => n.length);
const mode = p => p.$eval(hub, el => el.dataset.mode);
const charging = p => p.$eval(hub, el => el.classList.contains('charging'));
const settle = (p, t = 15000) =>
  p.waitForFunction(() => ['spin', 'locked', 'again'].includes(document.querySelector('#spin').dataset.mode), null, { timeout: t });

// --- 1. hold duration drives the spin, and one gesture == one spin -----------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  const box = await page.locator(hub).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  const hold = async ms => {
    const before = await rot(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    const wound = await rot(page);
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'busy');
    await settle(page);
    const s = (await spins(page)).at(-1);
    return { ms: s.ms, delta: s.rot - before, wound: wound - before };
  };

  const tap = await hold(0);
  const mid = await hold(900);
  const full = await hold(2100);

  // Upper bound is loose: a "0ms" hold is really one driver round trip, which
  // is slower on a loaded CI runner and charges the spin a little.
  ok(tap.ms >= 1400 && tap.ms < 2600, `tap spins weakly (${tap.ms}ms, ${(tap.delta / 360).toFixed(1)} turns)`);
  ok(mid.ms > tap.ms, `mid hold spins longer than tap (${mid.ms}ms vs ${tap.ms}ms)`);
  ok(full.ms > mid.ms && full.ms <= 4600, `full hold spins longest (${full.ms}ms vs ${mid.ms}ms)`);
  ok(full.delta > mid.delta && mid.delta > tap.delta,
     `revolutions scale with charge (${[tap, mid, full].map(x => (x.delta / 360).toFixed(1)).join(' -> ')} turns)`);

  // Whole turns only. `delta` also carries the random 0-360deg the wheel travels
  // to line the winner up under the pointer, which is a third of a tap's total
  // distance but a twelfth of a full charge's — comparing raw degrees per second
  // measures that lottery as much as the charge. floor(delta/360) is the turn
  // count exactly, so this compares like with like.
  const speed = x => Math.floor(x.delta / 360) * 360 / x.ms * 1000;
  ok(speed(full) > speed(tap) * 1.25,
     `full charge is faster, not just longer (${speed(tap) | 0} -> ${speed(full) | 0} deg/s)`);

  ok(full.wound < -5, `wheel winds back while loading (${full.wound.toFixed(1)}deg)`);
  ok((await spins(page)).length === 3, `3 gestures produced exactly 3 launches (got ${(await spins(page)).length})`);
  ok(await listLen(page) === 3, `setlist has exactly 3 entries — no double-spin (got ${await listLen(page)})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 2. keyboard hold, and focus survives the spin ---------------------------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  await page.locator(hub).focus();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.down('Space');
  await page.waitForTimeout(700);
  const fill = await page.$eval(hub, el => +el.style.getPropertyValue('--p'));
  await page.keyboard.up('Space');
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'busy');
  const focusedDuringSpin = await page.evaluate(() => document.activeElement.id);
  const ariaBusy = await page.$eval(hub, el => el.getAttribute('aria-disabled'));
  await settle(page);

  ok(fill > 20 && fill < 60, `Space hold charges the ring (--p=${fill.toFixed(0)})`);
  ok((await spins(page)).length === 1, `Space produced exactly 1 launch (got ${(await spins(page)).length})`);
  ok(await listLen(page) === 1, `Space produced exactly 1 landing (got ${await listLen(page)})`);
  ok(focusedDuringSpin === 'spin', `focus stays on the hub during the spin (was #${focusedDuringSpin})`);
  ok(ariaBusy === 'true', `hub reports aria-disabled while spinning (got ${ariaBusy})`);
  ok(await page.evaluate(() => window.scrollY) === scrollBefore, 'Space did not scroll the page');

  if (await mode(page) === 'spin') {
    await page.keyboard.down('Space'); await page.waitForTimeout(150); await page.keyboard.up('Space');
    await page.waitForTimeout(300);
    ok((await spins(page)).length === 2, 'a second Space hold works immediately after landing, no re-focus needed');
  } else ok(true, 'skipped follow-up hold — first spin ended the set');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 3. auto-repeat must not machine-gun ------------------------------------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  await page.locator(hub).focus();
  // simulate a key held down with OS auto-repeat
  await page.evaluate(() => {
    const b = document.getElementById('spin');
    for (let i = 0; i < 12; i++)
      b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: i > 0, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(500);
  ok(await charging(page), 'auto-repeat keeps a single charge running');
  await page.evaluate(() => document.getElementById('spin').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })));
  await settle(page);
  ok((await spins(page)).length === 1, `auto-repeat produced exactly 1 spin (got ${(await spins(page)).length})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 4. the wedge flip during the hold, and cancelling puts it back ----------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  const box = await page.locator(hub).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const reds = () => page.$$eval('#wheel path', ns => ns.filter(n => n.getAttribute('fill') === '#bf2f38').length);
  const golds = () => page.$$eval('#wheel path', ns => ns.filter(n => n.getAttribute('fill') === '#e9b44c').length);
  const odds = () => page.$eval('#odds', el => el.textContent);

  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await settle(page);

  if (await mode(page) !== 'spin') ok(true, 'skipped flip test — first spin ended the set');
  else {
    const [r0, g0, o0] = [await reds(), await golds(), await odds()];
    ok(g0 === 1, `a landed song leaves one gold wedge (got ${g0})`);

    await page.mouse.down();
    await page.waitForTimeout(400);
    const [r1, g1] = [await reds(), await golds()];
    ok(r1 === r0 + 1 && g1 === 0, `the gold wedge turns red while loading (${g0} gold/${r0} red -> ${g1}/${r1})`);
    ok(await odds() === o0, 'the odds tally is unchanged by the flip (it already counted)');

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(120);
    ok(await reds() === r0 && await golds() === g0, 'cancelling the charge puts the wedge back');
    ok(await odds() === o0, 'odds restored after cancel');
    ok(!(await charging(page)), 'charging state cleared on cancel');
    ok((await spins(page)).length === 1, `cancelled charge did not spin (launches=${(await spins(page)).length})`);
    ok(await mode(page) === 'spin', 'hub is ready to spin again after a cancel');
    await page.mouse.up();
    await page.waitForTimeout(200);
    ok((await spins(page)).length === 1, 'releasing after a cancel does not spin either');
  }
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 5. Escape cancels ------------------------------------------------------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  const box = await page.locator(hub).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(!(await charging(page)), 'Escape cancels the charge');
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok((await spins(page)).length === 0, `Escape-cancelled charge never spins (launches=${(await spins(page)).length})`);
  ok(await rot(page) === 0, 'wheel eased back to its resting angle');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 6. drag off the hub mid-hold still spins -------------------------------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  const box = await page.locator(hub).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.move(10, 10, { steps: 8 });
  await page.waitForTimeout(300);
  const stillCharging = await charging(page);
  await page.mouse.up();
  await page.waitForTimeout(500);
  ok(stillCharging, 'charge survives the pointer leaving the hub');
  ok((await spins(page)).length === 1, `release outside the hub still spins (launches=${(await spins(page)).length})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 7. assistive-tech click path ------------------------------------------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  await page.$eval(hub, el => el.click());   // bare synthetic click, no pointer/key events
  await page.waitForTimeout(500);
  ok((await spins(page)).length === 1, `a bare click still spins (launches=${(await spins(page)).length})`);
  await settle(page);
  ok(await listLen(page) === 1, `and lands exactly once (got ${await listLen(page)})`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 8. end of set: countdown, then a plain press ---------------------------
{
  const { page, errs } = await newPage();
  await page.evaluate(() => localStorage.setItem('roulette:settings',
    JSON.stringify({ losers: 30, lockRestart: true, songs: [{ title: 'Solo', artist: 'X' }] })));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#wheel path').length > 0);
  await page.$eval(hub, el => el.click());
  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'locked', null, { timeout: 20000 });
  const lockedLabel = await page.$eval('#spin .lab', el => el.textContent);
  ok(/^Locked/.test(lockedLabel), `set ends into a locked countdown ("${lockedLabel.replace(/\n/g, ' ')}")`);
  ok(await page.$eval(hub, el => el.getAttribute('aria-disabled')) === 'true', 'locked hub is aria-disabled');

  const b2 = await page.locator(hub).boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down(); await page.waitForTimeout(400);
  ok(!(await charging(page)), 'no charge starts while locked');
  await page.mouse.up();
  await page.waitForTimeout(100);
  const spinsBefore = (await spins(page)).length;

  await page.waitForFunction(() => document.querySelector('#spin').dataset.mode === 'again', null, { timeout: 20000 });
  const againLabel = await page.$eval('#spin .lab', el => el.textContent);
  ok(/Play/.test(againLabel), `unlocks to a plain play-again button ("${againLabel.replace(/\n/g, ' ')}")`);
  ok(await page.$eval('#hint', el => el.textContent).then(t => /Press/.test(t)), 'hint says press, not hold');
  ok(await page.$eval(hub, el => el.getAttribute('aria-disabled')) === 'false', 'unlocked hub is not aria-disabled');
  ok((await spins(page)).length === spinsBefore, 'the press attempt during the lock never spun');

  await page.click(hub);
  await page.waitForTimeout(250);
  ok(await mode(page) === 'spin', 'a single press restarts the set');
  ok(await listLen(page) === 0, 'restart clears the setlist');
  ok(await rot(page) === 0, 'restart snaps the wheel back to 0deg');
  ok(await page.$eval('#hint', el => el.textContent).then(t => /Hold/.test(t)), 'hint is back to the spin instruction');
  ok(await page.$eval('#verdict', el => el.hidden), 'verdict panel hidden again');

  // and the charge gesture works again after the restart
  const b3 = await page.locator(hub).boundingBox();
  await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2);
  await page.mouse.down(); await page.waitForTimeout(350);
  ok(await charging(page), 'hold-to-spin works again after a restart');
  await page.mouse.up();
  await page.waitForTimeout(300);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 9. reduced motion ------------------------------------------------------
{
  const { page, errs } = await newPage({ reducedMotion: 'reduce', ...{ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } } });
  const box = await page.locator(hub).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2100);
  const wound = await rot(page);
  const fill = await page.$eval(hub, el => +el.style.getPropertyValue('--p'));
  await page.mouse.up();
  await page.waitForTimeout(400);
  const s = (await spins(page)).at(-1);
  ok(wound === 0, `no wind-back under reduced motion (rotation=${wound})`);
  ok(fill > 95, `ring still fills under reduced motion (--p=${fill.toFixed(0)})`);
  ok(s.ms === 1000, `reduced motion uses one short spin (${s.ms}ms)`);
  ok(s.rot < 720, `and only one revolution (${(s.rot / 360).toFixed(1)} turns)`);
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 10. opening Settings cancels a charge; Apply & restart clears it -------
{
  const { page, errs } = await newPage({ settings: { losers: 0, lockRestart: false, songs: Array.from({length:24},(_,i)=>({title:'S'+i,artist:'A'})) } });
  const box = await page.locator(hub).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // (a) the gear opening Settings must abandon an in-flight charge
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.$eval('#gear', el => el.click());
  await page.waitForTimeout(150);
  ok(!(await charging(page)), 'opening Settings cancels an in-flight charge');
  await page.mouse.up();
  await page.waitForTimeout(400);
  ok((await spins(page)).length === 0, `releasing after Settings opened does not spin (launches=${(await spins(page)).length})`);

  // (b) Apply & restart while a charge is running. Opening the dialog above has
  // populated the form, so submitting it now actually restarts.
  await page.$eval('#cancelSettings', el => el.click());
  await page.waitForTimeout(100);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(300);
  ok(await charging(page), 'charging again after the dialog closed');
  await page.evaluate(() => document.getElementById('settingsForm')
    .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  await page.waitForTimeout(200);
  ok(await page.$eval('#songErr', el => el.textContent) === '', 'the form submitted cleanly (no validation error)');
  ok(!(await charging(page)), 'restart clears the charging state');
  ok(await rot(page) === 0, 'wheel snaps back to 0deg with no animated unwind');
  ok(await mode(page) === 'spin', 'hub is back in spin mode');
  await page.mouse.up();
  await page.waitForTimeout(700);
  ok((await spins(page)).length === 0, `no spin fires after a mid-charge restart (launches=${(await spins(page)).length})`);
  ok(await listLen(page) === 0, 'setlist still empty');

  // and the hub still works normally afterwards
  await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  await page.waitForTimeout(400);
  ok((await spins(page)).length === 1, 'hold-to-spin works after the restart');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- 11. wedge-count extremes ----------------------------------------------
for (const losers of [0, 50]) {
  const { page, errs } = await newPage();
  await page.evaluate(n => localStorage.setItem('roulette:settings',
    JSON.stringify({ losers: n, lockRestart: false, songs: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] })), losers);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#wheel path').length > 0);
  const box = await page.locator(hub).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.waitForTimeout(1000); await page.mouse.up();
  await page.waitForTimeout(400);
  const s = (await spins(page)).at(-1);
  ok(s && s.ms >= 1400 && s.ms <= 4600, `losers=${losers}: duration stays in band (${s && s.ms}ms)`);
  await settle(page);
  ok(await page.$eval('#status', el => el.textContent).then(t => t.length > 0), `losers=${losers}: spin resolved to a wedge`);
  ok(errs.length === 0, `losers=${losers}: no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

await browser.close();
console.log(out.join('\n'));
const failed = out.filter(l => l.startsWith('FAIL'));
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
