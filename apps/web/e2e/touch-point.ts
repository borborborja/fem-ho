import { expect, type Locator } from '@playwright/test';

/** El centre d'un títol és tocable quan la seva columna s'ha ajustat al visor. */
export async function touchPoint(title: Locator): Promise<{ x: number; y: number }> {
  await title.evaluate((node) =>
    node.closest('[data-column-status]')?.scrollIntoView({
      block: 'nearest',
      inline: 'start',
      behavior: 'instant',
    }),
  );
  await title.scrollIntoViewIfNeeded();

  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        point = await title.evaluate((node) => {
          const { x, y, width, height } = node.getBoundingClientRect();
          const center = { x: x + width / 2, y: y + height / 2 };
          return node.contains(document.elementFromPoint(center.x, center.y)) ? center : null;
        });
        return point;
      },
      { message: 'El punt del gest toca el títol' },
    )
    .not.toBeNull();
  return point!;
}
