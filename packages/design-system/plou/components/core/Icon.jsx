import React from 'react';

// The Plou icon set — hand-drawn 24x24 line glyphs, stroke:currentColor, round caps.
// Never filled, except play/pause (solid, always inside a gradient bubble).
export const PLOU_ICONS = {
  radar: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  forecast: <><circle cx="7.5" cy="6.5" r="2.5" /><path d="M7.5 2v1.4M7.5 9.6V11M3.9 6.5H2.5M12.5 6.5h-1.4M4.6 3.6l1 1M9.4 3.6l-1 1" /><path d="M18 20H8a3.5 3.5 0 01-.5-6.96A4.5 4.5 0 0116 12a3.5 3.5 0 012 8z" /></>,
  bell: <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009.5 19.6a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9.5a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></>,
  crosshair: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  sun: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></>,
  layers: <path d="M4 7h16M4 12h16M4 17h16" />,
};

const SOLID = {
  play: <path d="M6 4l14 8-14 8V4z" />,
  pause: <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>,
};

export function Icon({ name, size = 20, strokeWidth, color = 'currentColor', style, ...rest }) {
  const solid = SOLID[name];
  const sw = strokeWidth != null ? strokeWidth : (size >= 30 ? 1.6 : 1.8);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? color : 'none'}
      stroke={solid ? 'none' : color}
      strokeWidth={solid ? undefined : sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden="true"
      {...rest}
    >
      {solid || PLOU_ICONS[name] || PLOU_ICONS.radar}
    </svg>
  );
}
