# Informes web

L'entrada **Informes** és visible a la barra principal, al menú del perfil i al cercador
d'ordres. `/informes` ofereix Resum, Dedicació i Registre. Les adreces `/estadistiques`
i `/registre` redirigeixen a les pestanyes corresponents conservant els filtres compatibles.
La interfície d'Android no canvia.

## Què volen dir les xifres

| Indicador | Definició |
| --- | --- |
| Pendents ara | Tasques visibles, no eliminades i amb estat diferent de `done`, inclosa la Inbox. No depèn del període. |
| Endarrerides ara | Pendents amb `due_date` anterior a avui al fus del perfil. No depèn del període; no és un recompte de `deadline`. |
| Creades al període | Tasques no eliminades amb `created_at` dins del període local. |
| Fetes al període | Tasques actualment `done` amb `completed_at` dins del període. Reobrir-les les treu del recompte. |
| Tasques amb dedicació | Tasques diferents amb sessions coincidents, encara que no estiguin acabades. |
| Projectes amb dedicació | Projectes diferents amb sessions coincidents; «Intern» no compta com a projecte. |
| Mitjana per tasca | Minuts totals dividits per tasques amb dedicació. |

Són lectures de l'estat actual, **no instantànies històriques**. Canviar un projecte,
reobrir una tasca o eliminar-la pot canviar un informe anterior. Les tasques eliminades
i les seves sessions queden fora. El resum de tasques funciona sense activar el registre.

Les sessions pertanyen íntegrament al dia local en què comencen, fins i tot si travessen
la mitjanit. Les hores extres mantenen el càlcul segons l'horari de l'àmbit. Les sessions
obertes es compten fins a l'instant de generació indicat al peu, juntament amb el nombre
de sessions obertes. La taula i el cronograma utilitzen el fus del perfil.

## Filtres i navegació

Per defecte: darrers 30 dies i àmbits/projectes actius. Presets: avui, setmana actual
(segons el primer dia configurat), mes actual fins avui, 30 dies, 90 dies, tot i personalitzat.
Les dates del període es guarden a la URL perquè l'enllaç mantingui el mateix rang.
Els límits són dies locals inclusius, també en canvis d'horari d'estiu.

Àmbits, diversos projectes (inclòs «Intern»), tipologia i text són compartits. La persona
**assignada** filtra tasques; la persona que ha **registrat la dedicació** filtra sessions:
són filtres independents. Canviar filtres reinicia la paginació; els projectes aliens als
àmbits seleccionats es retiren. El cronograma consulta el dia seleccionat al seu control.

Les targetes del resum mostren les tasques corresponents; una tasca obre l'editor habitual.
Els desglossaments de dedicació obren el registre amb el filtre corresponent.
La llista mostra fins a 100 files per pàgina. Els totals i subtotals són del conjunt complet,
no de la pàgina visible. El cronograma carrega les sessions de tot el dia seleccionat.
Els gràfics ofereixen també una taula de valors accessible. Els períodes de més de 70 dies
s'agrupen en blocs de set dies, sense truncar el final de la sèrie.

## Accés i exportació

El resum només compta tasques dels àmbits visibles amb `tasks:read`. La dedicació segueix
la política existent: cadascú veu les seves sessions; propietaris i administradors amb
l'acció `reports` veuen les de l'àmbit. Els mateixos permisos s'apliquen al CSV.

CSV exporta totes les coincidències de la mètrica o registre seleccionat, ignorant la
paginació. Les cel·les amb prefix de fórmula s'escapen. Els instants de creació/finalització
del CSV de tasques són ISO UTC; les sessions mantenen el format local del registre.
Resum i Dedicació es poden imprimir o desar com a PDF amb el navegador: es conserven
context, filtres i data de generació, i s'oculten controls i llista paginada de tasques.

## API

- `GET /api/v1/reports/tasks`: recomptes, evolució, projectes i pàgina de tasques.
- `GET /api/v1/reports/tasks/export.csv`: exportació completa de la mètrica seleccionada.
- `GET /api/v1/sessions`: accepta `limit` (1–500) i `cursor`; sense `limit` manté la resposta
  completa per compatibilitat. `next_cursor` indica la pàgina següent.
- Les consultes de sessions admeten `project_ids`; és excloent amb `project_id`.
- Estadístiques i exports inclouen totes les coincidències, també si superen 2.000 sessions.

El contracte detallat és `packages/contracts/openapi.yaml`. No cal migració de base de dades.
