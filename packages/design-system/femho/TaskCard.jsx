import React, { useState } from 'react';
import { ChecklistRow } from './ChecklistRow.jsx';
import { useIsMobile } from './MentionPopover.jsx';

/** El llapis d'editar. Del disseny validat: 12px, traç 1.8. */
function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Llista amb un més: afegir una subtasca o una llista. */
function ListPlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h9" />
      <path d="M4 12h9" />
      <path d="M4 18h5" />
      <path d="M17 14v7" />
      <path d="M13.5 17.5h7" />
    </svg>
  );
}

/** La xinxeta de pinejar. Plena quan ho està. */
function PinIcon({ size = 13, filled = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21s-6-5.686-6-10a6 6 0 1 1 12 0c0 4.314-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}

/** El botó rodó de 20px de la cantonada, que apareix en passar-hi per sobre. */
function CardAction({ label, onClick, revealed, testId, color, children }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        // La targeta sencera obre el modal: aquestes accions no l'han de disparar.
        event.stopPropagation();
        onClick?.();
      }}
      title={label}
      aria-label={label}
      data-testid={testId}
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: color ?? 'var(--ink-faint)',
        opacity: revealed ? 1 : 0,
        // Amagat de veritat mentre no es revela: si només fos transparent, el ratolí
        // i el lector de pantalla hi arribarien igual i el cursor canviaria sol.
        pointerEvents: revealed ? 'auto' : 'none',
        transition: 'opacity 150ms',
      }}
    >
      {children}
    </button>
  );
}

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
  checklistProgress,
  lists,
  listsExpanded = false,
  listsToggleLabel,
  onToggleLists,
  addForm,
  /** Les accions que surten a la cantonada en passar-hi per sobre. */
  onEdit,
  editLabel,
  hasUnseenAiChange = false,
  dragging = false,
  onOpen,
  onToggleDone,
  toggleLabel,
  /**
   * La fletxa de la barra dreta: mou la targeta a la columna següent.
   *
   * Si hi és, la barra és una fletxa; si no, és la casella d'estat. Ho decideix qui
   * munta el tauler perquè és qui sap a quina columna és la targeta.
   */
  onAdvance,
  advanceLabel,
  done = false,
  style,
  ...rest
}) {
  /**
   * Les accions de la cantonada surten **en passar-hi per sobre**, com al disseny.
   *
   * Al mòbil no hi ha ratolí, i el disseny mòbil les pinta sempre; aquí es fa igual.
   * I es revelen també amb el focus del teclat: una acció que només existeix amb el
   * ratolí no la pot fer qui navega amb tabulador, i aquí n'hi ha dues que no tenen
   * cap altre camí.
   */
  const mobile = useIsMobile();
  const [active, setActive] = useState(false);
  const revealed = mobile || active;

  return (
    <div
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
      }}
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
      {/*
        Canvi autònom no vist: punt de 6px a la cantonada superior dreta amb
        --plou-orange (docs/09 §3). Desapareix en obrir la tasca.

        Ara la cantonada dreta és la barra de moure, que amb la tasca feta va amb el
        gradient de marca: sense l'anell del color de la targeta, el punt taronja s'hi
        perdria a dins. L'anell és el que el fa llegible sobre qualsevol de les dues.
      */}
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
            boxShadow: '0 0 0 1.5px var(--card-bg)',
            zIndex: 2,
          }}
        />
      ) : null}

      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: 12,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
        }}
      >
        {/*
          Les accions de la targeta, a la cantonada. `paddingRight` a la fila del títol
          perquè el text no hi passi per sota: les icones són absolutes i no aparten res.
        */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            zIndex: 1,
          }}
        >
          {onEdit === undefined ? null : (
            <CardAction label={editLabel} onClick={onEdit} revealed={revealed} testId="card-edit">
              <PencilIcon />
            </CardAction>
          )}
          {addForm === undefined ? null : (
            <CardAction
              label={addForm.toggleLabel}
              onClick={addForm.onToggle}
              revealed={revealed}
              testId="card-add-toggle"
            >
              <ListPlusIcon />
            </CardAction>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 9,
            alignItems: 'flex-start',
            // 66px: dues icones de 20 amb 4 de separació, i aire fins a la vora.
            paddingRight: onEdit === undefined && addForm === undefined ? 0 : 66,
          }}
        >
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

        {/*
          La secció desplegada, amb l'entrada de 200ms del disseny.

          **Les subtasques van nues i les llistes en caixa.** Al disseny anterior totes
          dues portaven caixa i epígraf; ara la distinció es veu sense dir-la: el que no
          té nom és el que pertoca a la tasca i prou, i posar-hi "SUBTASQUES" a sobre era
          etiquetar l'obvi dins d'una targeta que ja va justa d'espai.
        */}
        {(listsExpanded && lists !== undefined && lists.length > 0) || addForm?.open === true ? (
          <div
            className="femho-list-in"
            style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 }}
          >
            {listsExpanded && lists !== undefined
              ? lists.map((list) =>
                  list.name === null || list.name === undefined || list.name === '' ? (
                    <div
                      key={list.id}
                      data-testid="card-list"
                      style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
                    >
                      {list.items.map((item) => (
                        <ChecklistRow
                          key={item.id}
                          text={item.text}
                          done={item.done}
                          toggleLabel={item.toggleLabel}
                          onToggle={item.onToggle}
                          style={{ padding: 0 }}
                        />
                      ))}
                    </div>
                  ) : (
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
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}>
                          {list.name}
                        </div>
                        {list.pinLabel === undefined ? null : (
                          <CardAction
                            label={list.pinLabel}
                            onClick={list.onPinToggle}
                            testId={`card-list-pin-${list.id}`}
                            // Una llista pinejada ho ensenya sempre: si només es veiés
                            // passant-hi per sobre, no hi hauria manera de saber quines
                            // ho estan sense recórrer-les una per una.
                            revealed={revealed || list.pinned === true}
                            color={
                              list.pinned === true ? 'var(--plou-blue-ink)' : 'var(--ink-faint)'
                            }
                          >
                            <PinIcon filled={list.pinned === true} />
                          </CardAction>
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
                  ),
                )
              : null}

            {/*
              Afegir, amb **un sol camp**.

              `#Llista element` hi posa l'ítem; sense sigil, és una subtasca. És el
              mateix gest que l'afegida ràpida del peu de columna —escriure una línia i
              prémer Enter— i per això el disseny va treure els dos camps i el botó.
            */}
            {addForm !== undefined && addForm.open ? (
              <input
                className="plou-input"
                placeholder={addForm.placeholder}
                value={addForm.text}
                onChange={addForm.onText}
                onKeyDown={addForm.onKeyDown}
                data-testid="card-add-item"
                autoFocus
                style={{ fontSize: 12, padding: '7px 10px' }}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {/*
        La barra de la dreta, de 28px i tota l'alçada de la targeta.

        **A les dues primeres columnes és una fletxa** que mou la targeta una columna
        endavant; a les dues últimes és la casella d'estat. Són el mateix lloc perquè és
        el mateix gest: fer avançar la targeta. Abans hi havia dos botons de destinació
        sota el títol i el cercle d'estat a dalt a l'esquerra; el disseny validat ho ha
        ajuntat tot aquí i la targeta ha quedat molt més neta.

        Quina de les dues surt ho decideix qui munta el tauler, amb `onAdvance`: és qui
        sap a quina columna és la targeta.
      */}
      {onAdvance !== undefined ? (
        <button
          type="button"
          onClick={onAdvance}
          title={advanceLabel}
          aria-label={advanceLabel}
          data-testid="card-advance"
          style={{
            width: 28,
            flexShrink: 0,
            border: 'none',
            background: 'var(--ghost-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ink-soft)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      ) : onToggleDone === undefined ? null : (
        <button
          type="button"
          onClick={onToggleDone}
          aria-pressed={done}
          aria-label={toggleLabel}
          title={toggleLabel}
          data-testid="card-toggle-done"
          style={{
            width: 28,
            flexShrink: 0,
            border: 'none',
            background: done ? 'var(--gradient-brand-2stop)' : 'var(--ghost-bg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {done ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <polyline
                points="20 6 9 17 4 12"
                stroke="var(--on-brand)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ink-soft)"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
