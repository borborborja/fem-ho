import React, { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

/** La provinença és llegible també amb teclat i en una pantalla sense ratolí. */
export function SourceBadge({ label, detailsLabel, rows, icon }) {
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = pinned || (!dismissed && (hovered || focused));

  const dismiss = useCallback(() => {
    setPinned(false);
    setDismissed(true);
    setHovered(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    // La capa superior evita que la vora de la targeta o el scroll de la columna el tallin.
    panel.showPopover?.();
    const place = () => {
      const { left, top, bottom } = anchor.getBoundingClientRect();
      const margin = 8;
      panel.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - panel.offsetWidth - margin))}px`;
      panel.style.top = `${
        bottom + panel.offsetHeight + margin <= window.innerHeight
          ? bottom
          : Math.max(margin, top - panel.offsetHeight)
      }px`;
    };
    place();

    const outside = (event) => {
      if (!anchor.contains(event.target) && !panel.contains(event.target)) dismiss();
    };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      // El primer Esc tanca la provinença encara que siguem dins del detall de la tasca.
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const scroll = (event) => {
      if (!panel.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', place);
    };
  }, [dismiss, open]);

  const enter = (event) => {
    if (event.pointerType === 'mouse') {
      setDismissed(false);
      setHovered(true);
    }
  };
  const leave = (event) => {
    const target = event.relatedTarget;
    if (
      target instanceof Node &&
      (anchorRef.current?.contains(target) || panelRef.current?.contains(target))
    )
      return;
    setHovered(false);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={detailsLabel}
        title={icon == null ? undefined : detailsLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={open ? panelId : undefined}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) {
            setDismissed(false);
            setFocused(true);
          }
        }}
        onBlur={() => setFocused(false)}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (pinned) dismiss();
          else setPinned(true);
        }}
        style={{
          ...(icon == null
            ? {
                alignSelf: 'flex-start',
                border: '1px solid var(--border-subtle)',
                padding: '4px 7px',
                background: 'var(--tag-bg)',
                color: 'var(--tag-text)',
                fontFamily: 'inherit',
                fontSize: 10.5,
                fontWeight: 700,
              }
            : {
                width: 24,
                display: 'grid',
                placeItems: 'center',
                border: 'none',
                padding: 0,
                background: 'transparent',
                color: 'var(--ink-soft)',
              }),
          flexShrink: 0,
          borderRadius: 'var(--radius-pill)',
          minHeight: 24,
          cursor: 'pointer',
        }}
      >
        {icon ?? label}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          popover="manual"
          onPointerEnter={enter}
          onPointerLeave={leave}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            inset: 'auto',
            margin: 0,
            maxWidth: 'min(280px, calc(100vw - 16px))',
            maxHeight: 'min(240px, calc(100vh - 16px))',
            overflow: 'auto',
            boxSizing: 'border-box',
            padding: '8px 12px',
            border: '1px solid var(--card-border)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--panel-bg)',
            boxShadow: 'var(--shadow-dialog)',
            color: 'var(--ink)',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          <dl style={{ margin: 0, display: 'grid', gap: 6 }}>
            {rows.map(({ label: field, value }) => (
              <div key={field}>
                <dt style={{ fontWeight: 700 }}>{field}</dt>
                <dd dir="auto" style={{ margin: 0, overflowWrap: 'anywhere' }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}
