import { t } from '@fem-ho/contracts';
import { SourceBadge } from '@fem-ho/design-system/femho';
import type { Task } from '../app/types.js';

export function McpSourceBadge({
  activity,
  compact = false,
}: {
  activity: Task['mcp_activity'];
  compact?: boolean;
}) {
  if (activity === undefined) return null;

  const { creation, origin } = activity;
  const unspecified = t('source.mcpUnspecified');
  const rows = [];
  if (creation !== undefined) {
    rows.push({ label: t('source.mcpCreation'), value: creation.origin ?? unspecified });
  }
  if (creation === undefined || creation.origin !== origin) {
    rows.push({ label: t('source.mcpLastChange'), value: origin ?? unspecified });
  }
  return (
    <SourceBadge
      label={t('source.mcp')}
      detailsLabel={t('source.mcpDetails')}
      rows={rows}
      icon={
        compact ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 3v4m8-4v4M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4" />
          </svg>
        ) : undefined
      }
    />
  );
}
