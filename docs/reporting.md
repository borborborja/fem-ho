# Informes web

L'entrada **Informes** és configurable a Ajustos → General. Amb `show_reports=true`
(per defecte) és a la barra principal; si es desactiva, queda només al menú del perfil.
El cercador d'ordres i l'adreça directa continuen disponibles. La preferència és personal
i es desa al servidor. `/informes` ofereix Resum i Registre de temps. Les adreces `/estadistiques`
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

El contracte detallat és `packages/contracts/openapi.yaml`. La migració 021 afegeix
`user_settings.show_reports`, amb valor inicial cert per conservar la navegació existent.

## Edició del cronograma

A **Informes → Registre → Cronograma**, arrossegar el cos mou el bloc i conserva la durada;
les vores ajusten l'inici o el final. Els gestos avancen en passos de cinc minuts, amb una
durada mínima de cinc minuts i previsualització de les hores. Els segons dels registres
automàtics es conserven quan es desplacen. Una sessió en curs permet moure l'inici i segueix
oberta: només sortir de Fent la tanca. La durada visible s'actualitza cada minut.

Dibuixar en una fila buida proposa un interval; clicar-hi proposa trenta minuts. El formulari
permet associar-lo a una tasca existent (sense canviar-ne l'estat) o crear una tasca feta,
amb una única sessió manual i `completed_at` igual al final registrat. Tasca, sessió i
historial s'escriuen en una transacció. Els identificadors del client eviten duplicats en
reintentar el mateix desament.

Moure un bloc a una altra fila demana confirmar el canvi de projecte de **tota la tasca**,
inclosos els altres blocs. Només s'admeten projectes del mateix àmbit i «Intern». Es poden
afegir files de projectes sense dedicació prèvia. Els noms queden fixos durant el desplaçament
horitzontal, i els solapaments ocupen subfiles. Zoom i Ajusta canvien l'escala. El control del
dia substitueix el selector general de període en aquesta vista.

Clicar el bloc o activar-lo amb el teclat obre el formulari equivalent als gestos. El botó
«+» de cada fila permet crear temps sense arrossegar. Escape, cancel·lació del punter o
canvi de dia cancel·len el gest. Un error de xarxa restaura el bloc i mostra un avís; un
conflicte d'edició recarrega les dades sense sobreescriure el canvi remot.

Col·laboradors amb `tasks:write` editen el temps propi; propietaris i administradors també
el d'altres membres. Observadors només llegeixen. El servidor i `can_edit` comparteixen
la mateixa política. `expected_version` retorna 409 si el bloc ha canviat. Els instants
es calculen en UTC i es mostren al fus del perfil, incloses les hores repetides o inexistents
als canvis d'horari. Els blocs que travessen mitjanit continuen al dia d'inici.

L'API amplia `POST /sessions` amb `id` i l'alternativa `new_task`, i `PATCH /sessions/{id}`
amb `project_id` i `expected_version`. Ometre `ended_at` conserva també un final obert.
L'edició del cronograma no requereix migració ni canvia pantalles d'Android. L'edició del registre necessita connexió;
no s'encuen gestos per reproduir-los més tard sobre dades potencialment diferents.

## Simplificació del 10 de setembre

El Resum reuneix els recomptes de tasques i la dedicació en una sola vista. Les quatre
xifres de tasques obren el detall corresponent; les taules i els desglossaments de temps
queden plegats inicialment. L'evolució de tasques utilitza barres amb escala numèrica.
L'antiga adreça `tab=time` porta al resum unificat conservant els filtres.

El Registre de temps conserva la taula i el cronograma amb els mateixos gestos. La capçalera
mostra un total compacte i explica que **tasques fetes i temps registrat són mesures diferents**.
L'enllaç «Veure les tasques fetes» obre el detall de completades amb el període vigent;
des del cronograma, utilitza el seu dia. No s'inventa dedicació per completar una tasca.
Les sessions automàtiques es conserven també quan duren menys d'un minut. Els filtres
d'àmbit, projecte, data i permisos poden reduir el registre visible.

Només el període o el dia són visibles inicialment. Persona, tipologia, text i projectes
queden a Filtres, amb un recompte dels filtres actius i una acció per netejar-los. Les dates
manuals només apareixen en el període personalitzat. «Exporta o imprimeix» reuneix les
sortides: al resum es pot triar entre el CSV de la mètrica de tasques i el del temps.
Els filtres de persona assignada i de persona que registra temps continuen sent independents.

Prova de diagnòstic: sis tasques completades i dues amb sessions produeixen sis completades
al resum i dues tasques amb temps al registre. Això verifica la distinció, però no confirma
el motiu d'una absència concreta en una instància que no s'ha consultat.


## Temps des del tauler · 10 de setembre

Amb Ajustos → Àmbits → Registre de dedicació activat, entrar a Fent (també en crear
la tasca) obre un tram; sortir-ne el tanca. Tornar de Fet a Fent obre un altre tram
sense alterar el primer. Els trams curts es conserven i la taula mostra segons quan
no arriben a un minut. Els totals de l'informe mantenen l'arrodoniment a minuts per tram.

Completar directament una tasca de Per fer o Inbox, des de la fitxa, el botó o arrossegant,
obre un formulari de minuts si l'àmbit té el registre activat. Cancel·lar no canvia l'estat.
Desar anota la durada exacta (sense arrodonir-la a cinc minuts) i completa la tasca en
una sola transacció. Un error manté el formulari; un reintent no duplica el tram.
Un canvi concurrent de la tasca retorna conflicte i cal cancel·lar i tornar-ho a intentar.
Amb el registre desactivat, completar no pregunta la durada.

Ajustos → General → Dedicació a les targetes controla el comptador de Fent i Fet.
El temps de Fent s'actualitza cada segon i suma els trams anteriors; Fet mostra el total.
El text accessible i l'ajuda en passar-hi el ratolí indiquen el nombre de trams.
És una preferència personal persistent (`show_task_time`, migració 022, activa per defecte).
L'agregat del tauler segueix els permisos de l'informe: temps propi per als membres,
temps de l'àmbit per a propietaris i administradors.

`POST /tasks/{id}/move` accepta `time_entry: {id, minutes, ended_at}` i `expected_version`.
La durada admet enters d'1 a 10.080 minuts. Els clients existents continuen podent completar
sense aquest camp; el formulari i l'ajust de visibilitat estan implementats a la web.
Les pantalles natives d'Android no incorporen encara aquests controls. El comportament
automàtic del servidor sí que és compartit amb Android i les integracions.
