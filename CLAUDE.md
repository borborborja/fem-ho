# CLAUDE.md

**Llegeix [`AGENTS.md`](AGENTS.md) abans de fer res en aquest repositori.** Hi ha les
directrius de treball, el mapa dels mòduls, els paranys coneguts i la doctrina de
verificació. Aquest fitxer no en repeteix el contingut: només hi apunta, perquè n'hi hagi
un de sol i no dos que divergeixin.

L'ordre de precedència, de més fort a menys:

1. **`instruccions.md`** — les onze regles no negociables del producte.
2. **`AGENTS.md`** — com es treballa aquí sense trencar-ho.
3. **`docs/`** — l'especificació. `docs/ESTAT.md` diu què està realment provat.

Tres coses que val la pena tenir al cap des del primer minut, i que `AGENTS.md` explica
amb els casos reals que les van ensenyar:

- **«Compila» no vol dir «arrenca».** Aquest projecte va tenir vuit fites amb una app
  d'Android que no engegava, i tot era verd. Arrenca-ho, mira-ho i digues què no has pogut
  comprovar.
- **Els fitxers amb la capçalera `GENERAT` no s'editen.** Es regenera la font i es
  compromet el resultat.
- **Si arregles un defecte que cap de les disset comprovacions permanents hauria vist,
  afegeix-ne una.** És el criteri que les ha fet créixer de vuit a disset.
