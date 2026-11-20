import { useRef } from 'react';

export function useTitleHold(onEdit) {
  const press = useRef(null);
  const suppressClick = useRef(false);
  const cancel = () => {
    press.current = null;
  };
  const moved = (event, start) => Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6;

  return {
    suppressClick,
    titleProps: {
      onPointerDown(event) {
        suppressClick.current = false;
        press.current =
          onEdit && event.button === 0 && event.isPrimary
            ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() }
            : null;
      },
      onPointerMove(event) {
        if (press.current && event.pointerId === press.current.id && moved(event, press.current))
          cancel();
      },
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu(event) {
        if (onEdit) event.preventDefault();
      },
      onPointerUp(event) {
        const start = press.current;
        cancel();
        // En deixar anar el botó, el sensor del tauler ja pot acabar el seu gest.
        if (
          onEdit &&
          start &&
          event.pointerId === start.id &&
          performance.now() - start.at >= 550 &&
          !moved(event, start)
        ) {
          event.preventDefault();
          suppressClick.current = true;
          onEdit();
        }
      },
    },
  };
}
