import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Una sola importació, i porta els tokens en l'ordre correcte amb accents.css l'últim
// (docs/04 §1). Si es desordena, les variants d'accent deixen de funcionar sense error.
import '@fem-ho/design-system/styles.css';

import { TokenProof } from './TokenProof.js';

const root = document.getElementById('root');
if (root === null) throw new Error('Falta #root');

createRoot(root).render(
  <StrictMode>
    <TokenProof />
  </StrictMode>,
);
