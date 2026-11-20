import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/pomodoro.json' with { type: 'json' };
import {
  applyPomodoroCommand,
  emptyPomodoroSnapshot,
  pomodoroRemainingMs,
  projectPomodoroTimer,
  type PomodoroCommand,
} from './pomodoro.js';

interface Scenario {
  name: string;
  steps: { command?: PomodoroCommand; now_ms?: number; expect?: object; conflict?: true }[];
}

const cases = fixtures as Scenario[];

describe('Pomodoro en paritat amb Android', () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      let snapshot = emptyPomodoroSnapshot();
      for (const step of scenario.steps) {
        if (step.command !== undefined) {
          const result = applyPomodoroCommand(snapshot, step.command);
          if (step.conflict === true) {
            expect(result).toBeNull();
            continue;
          }
          if (result === null) throw new Error(`Ordre rebutjada: ${JSON.stringify(step.command)}`);
          snapshot = result;
        }
        const timer =
          step.now_ms === undefined
            ? snapshot.timer
            : projectPomodoroTimer(snapshot.timer, step.now_ms);
        const display =
          timer === null || step.now_ms === undefined
            ? timer
            : { ...timer, remaining_ms: pomodoroRemainingMs(timer, step.now_ms) };
        if (step.expect !== undefined) {
          expect({ ...snapshot, timer: display }).toMatchObject(step.expect);
        }
      }
    });
  }
});
