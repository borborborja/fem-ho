import React from 'react';
import { ChecklistRow } from './ChecklistRow.jsx';

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
  lists,
  listsExpanded = false,
  listsToggleLabel,
  onToggleLists,
  addForm,
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

        {/*
          Les subtasques i les llistes, desplegades a la mateixa targeta.
          **Un sol commutador per a totes dues.** Per a qui mira el tauler són el
          mateix: coses que falten dins d'aquesta tasca. La distinció —una subtasca no
          té nom, una llista sí— es veu dins, a l'epígraf de cada bloc.
        */}
        {listsToggleLabel === undefined ? null : (
          <button
            type="button"
            onClick={onToggleLists}
            aria-expanded={listsExpanded}
            data-testid="card-lists-toggle"
            style={{
              alignSelf: 'flex-start',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--ink-soft)',
              padding: '2px 0',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {listsToggleLabel}
          </button>
        )}

        {listsExpanded && lists !== undefined
          ? lists.map((list) => (
              <div
                key={list.id}
                data-testid="card-list"
                style={{
                  background: 'var(--tag-bg)',
                  borderRadius: 12,
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-soft)' }}>
                    {list.name === null || list.name === undefined || list.name === '' ? (
                      <span
                        style={{
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          fontSize: 9.5,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {list.subtasksLabel}
                      </span>
                    ) : (
                      <span style={{ fontWeight: 700, fontSize: 11.5, color: 'var(--ink)' }}>
                        {list.name}
                      </span>
                    )}
                  </div>
                  {list.pinLabel === undefined ? null : (
                    <button
                      type="button"
                      onClick={list.onPinToggle}
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: 'var(--plou-blue-ink)',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                      }}
                    >
                      {list.pinLabel}
                    </button>
                  )}
                </div>

                {list.items.map((item) => (
                  <ChecklistRow
                    key={item.id}
                    text={item.text}
                    done={item.done}
                    toggleLabel={item.toggleLabel}
                    onToggle={item.onToggle}
                    style={{ padding: '3px 0' }}
                  />
                ))}
              </div>
            ))
          : null}

        {/*
          Afegir una subtasca o una llista sense sortir de la targeta.
          El nom buit vol dir subtasca: és el que fa que les dues coses càpiguen en un
          formulari en comptes de dos.
        */}
        {addForm !== undefined ? (
          <>
            {addForm.open ? (
              <div
                style={{
                  background: 'var(--tag-bg)',
                  borderRadius: 12,
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <input
                  className="plou-input"
                  placeholder={addForm.listNamePlaceholder}
                  value={addForm.listName}
                  onChange={addForm.onListName}
                  style={{ fontSize: 11.5, padding: '6px 10px' }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="plou-input"
                    placeholder={addForm.itemPlaceholder}
                    value={addForm.itemText}
                    onChange={addForm.onItemText}
                    onKeyDown={addForm.onItemKeyDown}
                    data-testid="card-add-item"
                    style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                  />
                  <button
                    type="button"
                    onClick={addForm.onSubmit}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--plou-blue-ink)',
                      padding: '0 4px',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {addForm.submitLabel}
                  </button>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={addForm.onToggle}
              data-testid="card-add-toggle"
              style={{
                alignSelf: 'flex-start',
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--ink-faint)',
                padding: '1px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              {addForm.toggleLabel}
            </button>
          </>
        ) : null}

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
