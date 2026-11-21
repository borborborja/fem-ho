import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/calendar-suggestions.json' with { type: 'json' };
import { isCurrentCalendarSuggestion } from './calendar-suggestions.js';

describe('finestra de propostes de calendari compartida amb Android', () => {
  it.each(fixtures)('$name', (scenario) => {
    const start = Date.parse('2026-11-21T09:00:00Z');
    const active = isCurrentCalendarSuggestion(
      {
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(start + scenario.ends_seconds * 1000).toISOString(),
        all_day: scenario.all_day ?? false,
        declined: scenario.declined ?? false,
      },
      start + scenario.now_seconds * 1000,
    );
    expect(active ? 'doing' : 'todo').toBe(scenario.expected);
  });
});
