import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

for (const gesture of ['pointer', 'keyboard'] as const) {
  test(`reordenar amb ${gesture} conserva els veïns després de recarregar`, async ({
    page,
  }, info) => {
    await enterAsNew(page, {
      name: 'Ordre del tauler',
      email: `board-order-${gesture}-${info.repeatEachIndex}-${info.retry}@example.com`,
      password: 'la-contrasenya-de-prova',
    });
    const headers = { authorization: `Bearer ${await token(page)}` };
    const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
      id: string;
    }[];
    const scope = scopes[0]!.id;
    const ids: string[] = [];
    for (const [index, title] of ['Primera', 'Segona', 'Tercera'].entries()) {
      const created = await page.request.post('/api/v1/tasks', {
        headers,
        data: {
          scope_id: scope,
          title,
          status: 'todo',
          position: `a${index}`,
        },
      });
      expect(created.status()).toBe(201);
      ids.push(((await created.json()) as { id: string }).id);
    }
    await page.goto(`/?scopes=${scope}`);
    const column = page.getByTestId('column-todo');
    const third = column.getByTestId(`task-${ids[2]}`);
    const second = column.getByTestId(`task-${ids[1]}`);
    await expect(third).toBeVisible();
    const moved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/v1/tasks/${ids[2]}/move`,
    );
    if (gesture === 'keyboard') {
      await third.focus();
      await page.keyboard.press('Space');
      await expect(page.getByTestId('drag-overlay')).toBeVisible();
      await expect(column).toHaveAttribute('data-drop-target', 'true');
      await page.keyboard.press('ArrowUp');
      await expect(second).toHaveAttribute('data-insert-edge', 'top');
      await page.keyboard.press('Space');
    } else {
      const from = (await third.boundingBox())!;
      const to = (await second.boundingBox())!;
      await page.mouse.move(from.x + 30, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 30, from.y - 10, { steps: 6 });
      await page.mouse.move(to.x + 30, to.y + 4, { steps: 8 });
      await expect(second).toHaveAttribute('data-insert-edge', 'top');
      await page.mouse.up();
    }
    expect((await moved).ok()).toBe(true);
    await page.reload();
    const ordered = column.locator('[data-draggable-id]');
    await expect(ordered).toHaveCount(3);
    await expect(ordered.nth(0)).toHaveAttribute('data-draggable-id', ids[0]!);
    await expect(ordered.nth(1)).toHaveAttribute('data-draggable-id', ids[2]!);
    await expect(ordered.nth(2)).toHaveAttribute('data-draggable-id', ids[1]!);
  });
}
