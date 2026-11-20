import { expect, it } from 'vitest';
import fixtures from '../fixtures/done-day.json' with { type: 'json' };
import { createDoneDayFilter } from './done-day.js';
import type { TaskStatus } from './index.js';
import { localDateOf } from './timezone.js';

it.each(fixtures)(
  '$name',
  ({ timezone, now, selectedDay, clearedAt, tasks, visibleIds, hasActiveClear }) => {
    const today = localDateOf(timezone, new Date(now));
    const filter = createDoneDayFilter({ timezone, today, day: selectedDay ?? today, clearedAt });

    expect(filter.hasActiveClear).toBe(hasActiveClear);
    expect(
      tasks
        .filter((task) => filter.isVisible(task.status as TaskStatus, task.completedAt))
        .map((task) => task.id),
    ).toEqual(visibleIds);
  },
);
