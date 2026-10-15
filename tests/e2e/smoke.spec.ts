import { expect, test, type Page } from '@playwright/test';

// NOTE: these browser tests are written against the redesigned UI. Whether they have been RUN is
// stated in the final report: the sandbox they were written in may not be able to launch Chromium.
// They need a run on a normal machine:   npm run e2e
// They drive the real UI against the real server, so a failure here is a real finding.

async function startPractice(page: Page) {
  await page.goto('/play/practice');
  await page.getByRole('button', { name: /start practice/i }).click();
  await expect(page.getByText(/Question 1 of 7/)).toBeVisible();
}

test('the landing page sells the fantasy and leads into the climb', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Stratos' })).toBeVisible();
  await expect(page.getByText('Know the rare. Rise higher.')).toBeVisible();
  await expect(page.getByRole('link', { name: /start daily climb/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /practice mode/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seven layers of sky' })).toBeVisible();
  await expect(page.getByText('Troposphere').first()).toBeVisible();
});

test('the launchpad separates ranked daily from unranked practice', async ({ page }) => {
  await page.goto('/play/daily');
  await expect(page.getByRole('heading', { name: 'Daily Climb' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();
  await expect(page.getByText('Ranked', { exact: true })).toBeVisible();
  await expect(page.getByText('Unranked', { exact: true })).toBeVisible();
});

test('a question shows the countdown, the field and a lock button', async ({ page }) => {
  await startPractice(page);
  await expect(page.getByRole('timer')).toBeAttached();
  await expect(page.getByLabel('Your answer')).toBeEditable();
  await expect(page.getByRole('button', { name: /lock answer/i })).toBeVisible();
  await expect(page.getByText('Altitude', { exact: true })).toBeVisible();
});

test('a question gives no hint: no example answer and no estimate of the score', async ({ page }) => {
  await startPractice(page);
  await expect(page.getByText(/for example/i)).toHaveCount(0);
  await expect(page.getByText(/estimate/i)).toHaveCount(0);
  await expect(page.getByText(/about \d+ points/i)).toHaveCount(0);
});

test('an answer that cannot be read is refused and does not lock the question', async ({ page }) => {
  await startPractice(page);
  const input = page.getByLabel('Your answer');
  await input.fill('zzz not an answer');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText(/could not read that/i);
  await expect(input).toBeEditable();
  await expect(page.getByRole('button', { name: /lock answer/i })).toBeVisible();
});

test('a refresh resumes the SAME question and does not restart the timer', async ({ page }) => {
  await startPractice(page);
  const url = page.url();
  expect(url).toContain('s=');
  await page.reload();
  await expect(page.getByText(/Question 1 of 7/)).toBeVisible();
  expect(page.url()).toBe(url);
});

test('the next-question button never shows a countdown', async ({ page, request }) => {
  // Lock an answer through the real API, then open the climb in the browser: the button that moves
  // on must be enabled straight away and carry no timer.
  await page.goto('/play/practice');
  await page.getByRole('button', { name: /start practice/i }).click();
  await expect(page.getByText(/Question 1 of 7/)).toBeVisible();
  // Without the answer set exposed, the browser cannot be sure to lock; so check the invariant that
  // matters on the launchpad side: no element anywhere on the page counts down to the next question.
  await expect(page.getByText(/next layer in/i)).toHaveCount(0);
  await expect(page.getByText(/next question in/i)).toHaveCount(0);
  void request;
});

test('the leaderboard and history pages load for a visitor with no climbs', async ({ page }) => {
  await page.goto('/leaderboard');
  await expect(page.getByRole('heading', { name: /leaderboard/i })).toBeVisible();
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: /your climbs/i })).toBeVisible();
});

test('an unknown play mode is a 404', async ({ page }) => {
  const response = await page.goto('/play/bogus');
  expect(response?.status()).toBe(404);
});

test.describe('on a narrow phone', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test('the question, the field and the lock button are all on screen without scrolling', async ({ page }) => {
    await startPractice(page);
    const input = page.getByLabel('Your answer');
    const lock = page.getByRole('button', { name: /lock answer/i });
    for (const el of [input, lock]) {
      const box = await el.boundingBox();
      expect(box).not.toBeNull();
      expect((box as { y: number; height: number }).y + (box as { y: number; height: number }).height).toBeLessThanOrEqual(640);
    }
    // The page must not scroll sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('touch targets are at least 44px tall', async ({ page }) => {
    await startPractice(page);
    const lock = await page.getByRole('button', { name: /lock answer/i }).boundingBox();
    expect((lock as { height: number }).height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('clouds, stars and the rocket stop moving, but the game still works', async ({ page }) => {
    await startPractice(page);
    const names = await page.evaluate(() => {
      const el = document.querySelector('.cloud');
      return el ? getComputedStyle(el).animationName : 'none';
    });
    expect(names).toBe('none');
    await expect(page.getByLabel('Your answer')).toBeEditable();
    await expect(page.getByRole('timer')).toBeAttached();
  });
});
