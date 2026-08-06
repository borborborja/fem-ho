import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Una sola importació, i porta els tokens en l'ordre correcte amb accents.css l'últim
// (docs/04 §1). Si es desordena, les variants d'accent deixen de funcionar sense error.
import '@fem-ho/design-system/styles.css';
// Els tokens propis de Fem-ho van DESPRÉS de Plou: en depenen (docs/04 §2).
import '@fem-ho/design-system/femho.css';

import { App } from './app/App.js';
import { RouterProvider } from './app/router.js';
import { SessionProvider } from './app/session.js';

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
