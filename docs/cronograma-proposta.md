# Cronograma més llegible · proposta de 2026-09-14

Estat: proposta pendent d'implementació. Basada en les captures d'ús i en
`apps/web/src/screens/Cronograma.tsx` i els seus estils.

## Què dificulta la lectura

Ja hi ha files per projecte, filtre de persona, zoom, arrossegament, ajust dels
extrems, blocs simultanis apilats i un formulari accessible per editar les hores.
Cal fer que aquesta informació es pugui llegir millor:

- Els blocs tenen un fons molt semblant al llenç i destaquen sobretot les vores.
- Un bloc de pocs minuts no té espai per mostrar-ne el nom: es veuen ratlles i
  fragments de paraules. L'amplada mínima actual de 18 px també pot exagerar-ne
  visualment la durada.
- «Ajusta» continua incloent com a mínim les 08–18 h encara que la feina ocupi
  només una part del dia. Ampliar obliga a desplaçar-se horitzontalment.
- La zona horària es repeteix a cada marca. Els noms de projecte es desplacen
  amb el contingut, cosa que fa perdre el context.

## Disseny proposat

**Una agenda horitzontal de feina real, agrupada per projecte.** Cada capçalera
de projecte queda fixa a l'esquerra i mostra el nom, el total dedicat i el nombre
de trams. Exemple: «Noel one · 1 h 24 min · 3 trams».

1. **Blocs amb fons de color suau i text contrastat.** Mantenir el color de
   tipologia quan n'hi ha i usar el de l'àmbit com a alternativa. El nom i la
   durada es mostren quan hi caben; els tiradors apareixen en passar-hi per sobre,
   seleccionar o enfocar amb teclat. Mantenir el formulari d'hores per al mòbil.
2. **Ajustar a la feina del dia.** El botó existent ha d'enquadrar el primer i
   l'últim tram amb un marge de 30 minuts. Una opció «Jornada» recupera l'horari
   habitual. Hora actual amb línia vertical; zona horària una sola vegada a la
   capçalera, excepte quan cal distingir el canvi d'hora.
3. **Trams curts identificables.** Dibuixar-los a escala amb un marcador mínim i
   una àrea de selecció més gran. Si n'hi ha massa junts per seleccionar-los,
   mostrar una agrupació «3 trams» que obri la llista exacta. No fusionar-los a
   les dades ni convertir minuts en barres que aparentin hores.
4. **Detall al costat en seleccionar.** Nom complet, projecte, inici, final,
   durada i accions «Ajusta les hores» / «Obre la tasca». En passar-hi per sobre
   o enfocar, mostrar aquesta informació resumida. Al mòbil, el detall apareix
   sota el cronograma.
5. **Desplegar un projecte per tasques.** En desplegar-lo, una fila per tasca,
   amb tots els seus trams i el total al costat. Això permet veure de seguida
   que una tasca s'ha reprès diverses vegades, sense afegir una pestanya.

## Ordre i cost relatiu

| Fase | Canvis | Cost relatiu |
| --- | --- | --- |
| 1 | Fons dels blocs, contrast, capçalera fixa, totals, zona horària única i ajust al rang ocupat | Baix |
| 2 | Detall en seleccionar, agrupació visual de trams curts i interacció tàctil | Mitjà |
| 3 | Desplegar projectes per tasca i recordar la preferència de visualització | Mitjà |

La primera fase aporta el guany més immediat. Les dades necessàries ja arriben
al client: no cal una migració per començar. Cal conservar els trams originals
i les regles actuals de permisos, sessions obertes i ajust a cinc minuts.

## Com validar-ho

Provar dies buits, sessions d'un minut, diversos trams de la mateixa tasca,
simultaneïtat, sessions obertes, tasques sense projecte, títols llargs, sessions
que travessen mitjanit i canvis d'hora. Mirar-ho en clar, fosc, pantalla estreta
i zoom del navegador al 200 %. Els totals han de coincidir amb el registre,
i la selecció, l'arrossegament i l'edició per teclat han de continuar funcionant.
