import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Una sola importació, i porta els tokens en l'ordre correcte amb accents.css l'últim
// (docs/04 §1). Si es desordena, les variants d'accent deixen de funcionar sense error.
import '@fem-ho/design-system/styles.css';
// Els tokens propis de Fem-ho van DESPRÉS de Plou: en depenen (docs/04 §2).
import '@fem-ho/design-system/femho.css';

import { BoardProof } from './BoardProof.js';
import { TokenProof } from './TokenProof.js';

const root = document.getElementById('root');
if (root === null) throw new Error('Falta #root');

// Mentre no hi ha encaminament (M5 el porta sencer a la fita següent), la pàgina es
// tria per la ruta: així les proves de navegador poden apuntar a cadascuna.
const page = window.location.pathname.startsWith('/board') ? <BoardProof /> : <TokenProof />;

createRoot(root).render(<StrictMode>{page}</StrictMode>);
