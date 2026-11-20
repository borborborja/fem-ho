import { t } from '@fem-ho/contracts';
import { SourceBadge } from '@fem-ho/design-system/femho';
import type { Task } from '../app/types.js';

export function McpSourceBadge({ activity }: { activity: Task['mcp_activity'] }) {
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
  return <SourceBadge label={t('source.mcp')} detailsLabel={t('source.mcpDetails')} rows={rows} />;
}
