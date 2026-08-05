import React from 'react';

/**
 * TaskCard — la targeta del kanban.
 *
 * PORTADA de `design/prototip/Fem-ho Web.dc.html`, conservant els estils en línia
 * caràcter a caràcter: radi 16, vora hairline, ombra de targeta, padding 12, 9px de
 * separació interna, títol a 13,5px pes 600 amb interlineat 1.3, pastilla de projecte
 * a 10,5px, inicial de persona en cercle de 18px.
 *
 * El que SÍ que s'ha traduït és el vocabulari: el prototip fa servir `column` amb
 * valors catalans i `iaMode` amb `off|assist|auto`; aquí és `status` amb
 * `inbox·todo·doing·done` i `aiMode` amb `manual·assisted·delegated` (D2, docs/00).
 *
 * Els textos NO surten d'aquí: arriben com a props des del catàleg (regla 3). Un
 * component del design system no pot portar català a dins, perquè el mateix component
 * l'ha de poder fer servir Android amb el seu propi `strings.xml`.
 */
export function TaskCard({
  title,
  project,
  assigneeInitials,
  time,
  aiMode = 'manual',
  aiModeLabel,
  quickActions = [],
  checklistProgress,
  hasUnseenAiChange = false,
  dragging = false,
  onOpen,
  onToggleDone,
  done = false,
  style,
  ...rest
}) {
  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--card-border)',
        borderRadius: 16,
        boxShadow: 'var(--card-shadow)',
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
        // Mentre s'arrossega, la targeta original queda a 0.4 (docs/02 §4).
        opacity: dragging ? 0.4 : 1,
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      {/* Canvi autònom no vist: punt de 6px a la cantonada superior dreta amb
          --plou-orange (docs/09 §3). Desapareix en obrir la tasca. */}
      {hasUnseenAiChange ? (
        <span
          data-testid="unseen-ai-change"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--plou-orange)',
          }}
        />
      ) : null}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}
      >
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          {/* Cercle d'estat de 22px. Clicar-lo NOMÉS commuta l'estat i no obre res
              (docs/02 §4). */}
          <button
            type="button"
            onClick={onToggleDone}
            aria-pressed={done}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              flexShrink: 0,
              border: done ? 'none' : '2px solid var(--card-border)',
              background: done ? 'var(--gradient-brand-2stop)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {done ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <polyline
                  points="20 6 9 17 4 12"
                  stroke="var(--on-brand)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </button>

          <button
            type="button"
            onClick={onOpen}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              border: 'none',
              background: 'none',
              padding: 0,
              margin: 0,
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                lineHeight: 1.3,
                color: 'var(--ink)',
              }}
            >
              {title}
            </span>

            <span
              style={{
                display: 'flex',
                gap: 5,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {project ? (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: 100,
                    background: 'var(--tag-bg)',
                    color: 'var(--tag-text)',
                  }}
                >
                  {project}
                </span>
              ) : null}

              {assigneeInitials ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: 'var(--tag-bg)',
                    color: 'var(--ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {assigneeInitials}
                </span>
              ) : null}

              {time ? (
                <span style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{time}</span>
              ) : null}

              {/* `manual` NO pinta res: és el cas normal i no ha d'ocupar espai
                  (docs/09 §3). El color no és mai l'únic senyal, per això hi ha text. */}
              {aiMode !== 'manual' && aiModeLabel ? (
                <span
                  data-testid={`ai-mode-${aiMode}`}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: 100,
                    background:
                      aiMode === 'delegated' ? 'var(--gradient-wash-tag)' : 'var(--tag-bg)',
                    color: 'var(--ink-soft)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill={aiMode === 'delegated' ? 'currentColor' : 'none'}
                    />
                  </svg>
                  {aiModeLabel}
                </span>
              ) : null}

              {checklistProgress ? (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: 100,
                    background: 'var(--tag-bg)',
                    color: 'var(--tag-text)',
                  }}
                >
                  {checklistProgress}
                </span>
              ) : null}
            </span>
          </button>
        </div>

        {/* Accions ràpides: NOMÉS a les targetes de l'Inbox (docs/02 §4). */}
        {quickActions.length > 0 ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 100,
                  background: 'var(--ghost-bg)',
                  color: 'var(--ink-soft)',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
