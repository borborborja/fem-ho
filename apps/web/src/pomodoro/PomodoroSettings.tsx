import { t, type PomodoroSettings } from '@fem-ho/contracts';
import { usePomodoro } from './PomodoroProvider.js';

const durations = [
  { key: 'focus_minutes', label: 'pomodoro.focusMinutes', max: 180 },
  { key: 'short_break_minutes', label: 'pomodoro.shortBreakMinutes', max: 180 },
  { key: 'long_break_minutes', label: 'pomodoro.longBreakMinutes', max: 180 },
  { key: 'long_break_every', label: 'pomodoro.longBreakEvery', max: 20 },
] as const;

const preferences = [
  { key: 'auto_start_focus', label: 'pomodoro.autoStartFocus' },
  { key: 'auto_start_break', label: 'pomodoro.autoStartBreak' },
  { key: 'sound', label: 'pomodoro.sound' },
] as const;

export function PomodoroSettingsFields() {
  const focus = usePomodoro();
  if (focus === null) return null;
  const { settings, changeSettings } = focus;
  return (
    <div className="pomodoro-settings">
      <label>
        <input
          type="checkbox"
          role="switch"
          data-testid="settings-pomodoro-enabled"
          checked={settings.enabled}
          disabled={focus.unavailable}
          onChange={(event) => void changeSettings({ enabled: event.target.checked })}
        />{' '}
        {t('pomodoro.enabled')}
      </label>
      {focus.unavailable && <p role="status">{t('pomodoro.unavailable')}</p>}
      {focus.issue !== undefined && (
        <p role="alert">
          {t(focus.issue === 'conflict' ? 'pomodoro.conflict' : 'pomodoro.saveError')}
        </p>
      )}
      {settings.enabled && (
        <>
          <label>
            {t('pomodoro.mode')}{' '}
            <select
              className="plou-input"
              data-testid="settings-pomodoro-mode"
              value={settings.mode}
              onChange={(event) =>
                void changeSettings({ mode: event.currentTarget.value as PomodoroSettings['mode'] })
              }
            >
              <option value="playful">{t('pomodoro.playful')}</option>
              <option value="serious">{t('pomodoro.serious')}</option>
            </select>
          </label>
          <div className="pomodoro-settings-times">
            {durations.map(({ key, label, max }) => (
              <label key={`${key}:${settings[key]}`}>
                {t(label)}
                <input
                  className="plou-input"
                  type="number"
                  min={1}
                  max={max}
                  required
                  step={1}
                  defaultValue={settings[key]}
                  data-testid={`settings-pomodoro-${key}`}
                  onBlur={(event) => {
                    const input = event.currentTarget;
                    const value = input.valueAsNumber;
                    if (input.validity.valid && value !== settings[key])
                      void changeSettings({ [key]: value });
                    else input.valueAsNumber = settings[key];
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
            ))}
          </div>
          {preferences.map(({ key, label }) => (
            <label key={key}>
              <input
                type="checkbox"
                data-testid={`settings-pomodoro-${key}`}
                checked={settings[key]}
                onChange={(event) => void changeSettings({ [key]: event.target.checked })}
              />{' '}
              {t(label)}
            </label>
          ))}
          {settings.sound && <p>{t('pomodoro.soundHint')}</p>}
        </>
      )}
    </div>
  );
}
