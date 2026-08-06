import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Una sola importació, i porta els tokens en l'ordre correcte amb accents.css l'últim
// (docs/04 §1). Si es desordena, les variants d'accent deixen de funcionar sense error.
import '@fem-ho/design-system/styles.css';
// Els tokens propis de Fem-ho van DESPRÉS de Plou: en depenen (docs/04 §2).
import '@fem-ho/design-system/femho.css';
// I l'arrel al final: fa servir els tokens dels dos (docs/02 §1).
import './app.css';

import { negotiate, setLocale } from '@fem-ho/contracts';
import { App } from './app/App.js';
import { RouterProvider } from './app/router.js';
import { SessionProvider } from './app/session.js';

/**
 * L'idioma es tria **abans del primer render**, no en un efecte.
 *
 * `t()` es crida durant el render, i `setLocale` no és estat de React: si es posés a un
 * `useEffect`, la primera pintada sortiria en l'idioma de reserva i no es tornaria a
 * pintar mai. La pantalla d'entrada la veu qui encara no té perfil, o sigui que aquesta
 * primera pintada és l'única que tindrà.
 *
 * Un cop hi ha sessió, el perfil mana i `session.tsx` el torna a posar; allà sí que hi
 * ha un `setState` al darrere que força la repintada.
 */
setLocale(negotiate(navigator.languages));
document.documentElement.lang = negotiate(navigator.languages);

const root = document.getElementById('root');
if (root === null) throw new Error('Falta #root');

createRoot(root).render(
  <StrictMode>
    <RouterProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </RouterProvider>
  </StrictMode>,
);
