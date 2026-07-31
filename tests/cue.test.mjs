// The two ways the wheel says "you can grab me": grip notches milled into the
// rim, and a single nudge on a first visit.
import { chromium } from 'playwright';

const URL = (process.env.BASE_URL || 'http://localhost:8765') + '/index.html';
const out = [];
const ok = (c, m) => out.push(`${c ? 'PASS' : 'FAIL'}  ${m}`);

let browser;
process.on('uncaughtException', e => { console.log(out.join('\n')); console.log('\nTHREW: ' + e.message); process.exit(1); });
browser = await chromium.launch();

async function newPage({ flicked = false, ...ctxOpts } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...ctxOpts });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  if (flicked) await page.addInitScript(() => localStorage.setItem('roulette:flicked', '1'));
  await page.goto(URL);
  await page.waitForFunction(() => document.querySelectorAll('#wheel path').length > 0);
  return { page, errs };
}

const rot = p => p.$eval('#wheel', el => {
  const m = /rotate\(([-\d.]+)deg\)/.exec(el.style.transform || 'rotate(0deg)');
  return m ? +m[1] : 0;
});
// Sample the wheel's angle over a window and report how far it ever strayed.
const strayed = async (page, ms) => {
  let max = 0;
  for (let t = 0; t < ms; t += 60) {
    max = Math.max(max, Math.abs(await rot(page)));
    await page.waitForTimeout(60);
  }
  return max;
};

// --- the grip notches -------------------------------------------------------
{
  const { page, errs } = await newPage({ flicked: true });
  const teeth = await page.$$eval('#wheel line', ns => ns.length);
  ok(teeth === 72, `the rim carries 72 grip notches (got ${teeth})`);

  const geom = await page.$eval('#wheel line', l => ({
    r0: Math.hypot(l.x1.baseVal.value - 300, l.y1.baseVal.value - 300),
    r1: Math.hypot(l.x2.baseVal.value - 300, l.y2.baseVal.value - 300),
  }));
  ok(geom.r0 > 282 && geom.r1 < 300,
     `they sit in the rim band, clear of the wedges (r ${geom.r0.toFixed(1)}–${geom.r1.toFixed(1)})`);

  // Inside #wheel means they turn with it, which is the point.
  const inWheel = await page.$eval('#wheel line', l => l.closest('#wheel') !== null);
  ok(inWheel, 'they live inside the rotating group, so they turn with the wheel');

  // and they survive a redraw
  await page.locator('#spin').click();
  await page.waitForFunction(() => ['spin', 'locked', 'again'].includes(document.querySelector('#spin').dataset.mode), null, { timeout: 15000 });
  ok(await page.$$eval('#wheel line', ns => ns.length) === 72, 'and are still there after the wheel redraws');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

// --- the first-visit nudge --------------------------------------------------
{
  const { page, errs } = await newPage();
  const max = await strayed(page, 2600);
  ok(max > 3, `a first visit nudges the wheel (strayed ${max.toFixed(1)}deg)`);
  ok(Math.abs(await rot(page)) < 0.5, `and settles back to where it started (at ${(await rot(page)).toFixed(1)}deg)`);
  ok(await page.$$eval('#setlist li', n => n.length) === 0, 'the nudge is not a spin — nothing is landed');
  ok(await page.$eval('#spin', el => el.dataset.mode) === 'spin', 'and the hub stays ready');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}
{
  const { page, errs } = await newPage({ flicked: true });
  ok(await strayed(page, 2600) < 0.5, 'someone who has flicked before is not nudged again');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}
{
  const { page, errs } = await newPage({ reducedMotion: 'reduce' });
  ok(await strayed(page, 2600) < 0.5, 'no nudge under reduced motion — the motion was the whole message');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}
{
  // Touching anything at all cancels it: being shown that the wheel moves is
  // only useful before you have moved it.
  const { page, errs } = await newPage();
  const b = await page.locator('#wrap').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.18);
  await page.mouse.down(); await page.mouse.up();
  const max = await strayed(page, 2400);
  ok(max < 0.5, `a press before it fires cancels the nudge (strayed ${max.toFixed(1)}deg)`);
  ok(await page.$$eval('#setlist li', n => n.length) === 0, 'and that press landed nothing');
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs[0] : ''}`);
  await page.context().close();
}

await browser.close();
console.log(out.join('\n'));
const failed = out.filter(l => l.startsWith('FAIL'));
console.log(`\n${out.length - failed.length}/${out.length} passed`);
process.exit(failed.length ? 1 : 0);
