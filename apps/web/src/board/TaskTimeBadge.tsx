import { useEffect, useState } from 'react';
import { t, type components } from '@fem-ho/contracts';
import { useAppearance } from '../app/theme.js';
type Summary = components['schemas']['TaskTimeSummary'];
export function durationClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600),
    minutes = Math.floor(whole / 60) % 60,
    rest = whole % 60;
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function durationMinutes(seconds: number): string {
  const total = Math.floor(seconds / 60);
  return total < 60
    ? t('duration.minutes', { minutes: total })
    : t('duration.hoursMinutes', { hours: Math.floor(total / 60), minutes: total % 60 });
}

export function TaskTimeBadge({ summary }: { summary: Summary }) {
  const [now, setNow] = useState(Date.now);
  const running = summary.open_started_at.length > 0;
  const eink = useAppearance() === 'eink';
  useEffect(() => {
    if (!running) return;
    const update = () => {
      if (!document.hidden) setNow(Date.now());
    };
    update();
    const timer = setInterval(update, eink ? 60_000 : 1_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [running, eink]);
  const seconds =
    summary.seconds +
    summary.open_started_at.reduce(
      (total, start) => total + Math.max(0, now - Date.parse(start)) / 1000,
      0,
    );
  const duration = eink && running ? durationMinutes(seconds) : durationClock(seconds);
  const description = `${t('tracking.total', { duration })} · ${t(summary.segments === 1 ? 'tracking.oneSegment' : 'tracking.segments', { count: summary.segments })}`;
  return (
    <span
      className="task-time-badge"
      data-testid="task-time"
      data-running={running}
      title={description}
      aria-label={description}
      tabIndex={0}
    >
      {duration}
    </span>
  );
}
