import { expect, test } from '@playwright/test';
import { enter, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

for (const width of [1280, 390]) {
  test(`seleccionar un àmbit amb projectes no desplaça els controls a ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await enter(page);
    const headers = { authorization: `Bearer ${await token(page)}` };
    const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
      id: string;
      name: string;
    }[];
    const work = scopes.find((scope) => scope.name === 'Feina')!;
    const personal = scopes.find((scope) => scope.name === 'Personal')!;
    const projectResponse = await page.request.post('/api/v1/projects', {
      headers,
      data: { scope_id: work.id, name: `Projecte ${width}` },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = (await projectResponse.json()) as { id: string };
    await page.goto(`/board?scopes=${personal.id}`);
    const chip = page.getByTestId(`scope-${work.id}`);
    const filter = page.getByTestId(`scope-projects-${work.id}`);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => document.fonts.ready);

    const positions = () =>
      page.getByTestId('scope-chips').evaluate((container) =>
        [
          ...Array.from(container.children),
          document.querySelector('[data-testid="topbar-add"]')!,
        ].map((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
    const before = await positions();
    await expect(filter).toBeHidden();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(filter).toBeVisible();
    expect(await positions()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`scope-active-${width}.png`) });

    await filter.click();
    await page.getByTestId(`scope-project-${project.id}`).click();
    expect(await positions()).toEqual(before);
    await page.keyboard.press('Escape');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(filter).toBeHidden();
    expect(await positions()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`scope-inactive-${width}.png`) });
    await chip.click();
    await expect(filter).toHaveAttribute('aria-expanded', 'false');
    expect(await positions()).toEqual(before);
  });
}
