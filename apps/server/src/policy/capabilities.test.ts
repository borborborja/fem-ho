/**
 * Els predefinits de capacitats.
 *
 * Hi ha una sola cosa a provar aquí, i és la que es trencaria sola: **els predefinits es
 * deriven filtrant pel sufix**. Qualsevol capacitat nova acabada en `:read` hi entra sense
 * que ningú ho decideixi, i el dia que es va afegir `mail:read` això volia dir que el
 * predefinit «només lectura» —el que es tria sense llegir— donava **la bústia sencera de
 * qui emetia el token**.
 *
 * Cap comprovació permanent ho hauria vist: no és una cadena prohibida ni un color, és una
 * conseqüència d'una derivació correcta sobre una llista que ha crescut.
 */

import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CAPABILITY_PRESETS, capabilitiesForRole } from './capabilities.js';

describe('els predefinits de tokens', () => {
  it('cap dels dos dona accés al correu', () => {
    for (const [nom, capacitats] of Object.entries(CAPABILITY_PRESETS)) {
      expect(capacitats, `el predefinit "${nom}" no pot portar correu`).not.toContain('mail:read');
      expect(capacitats, `el predefinit "${nom}" no pot portar correu`).not.toContain('mail:write');
    }
  });

  it("i segueixen donant el que sí que han de donar, o l'exclusió se n'hauria endut més", () => {
    expect(CAPABILITY_PRESETS.read_only).toContain('tasks:read');
    expect(CAPABILITY_PRESETS.read_only).not.toContain('tasks:write');
    expect(CAPABILITY_PRESETS.read_write).toContain('tasks:write');
    // `:delete` i `:manage` no són ni lectura ni escriptura.
    expect(CAPABILITY_PRESETS.read_write).not.toContain('tasks:delete');
    expect(CAPABILITY_PRESETS.read_write).not.toContain('users:manage');
  });

  it('una sessió humana sí que hi arriba: el que es limita són els tokens', () => {
    // Qui ha entrat amb la seva contrasenya pot llegir el seu propi correu. El que
    // s'acota amb capacitats són les integracions, que és on viu el risc (regla 9).
    expect(capabilitiesForRole('member')).toContain('mail:read');
    expect(capabilitiesForRole('admin')).toContain('mail:write');
  });

  it('i el vocabulari no té duplicats', () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });
});
