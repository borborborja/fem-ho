# 00 · Visió i glossari

## Per a qui és Fem-ho

Una llar. Una o més persones adultes que ja tenen un servidor a casa i que volen gestionar la feina, la vida personal i la família al mateix lloc, sense que la feina s'assabenti de la família ni al revés.

No és un producte per a equips d'empresa. No hi ha sprints, ni estimacions, ni informes de velocitat, ni permisos granulars per camp. Hi ha persones que comparteixen una casa i, algunes d'elles, també una feina.

## Els cinc principis

**1. D'una mirada.** La pantalla principal ha de respondre "què he de fer" sense clicar res. Si per saber què toca avui cal navegar, el disseny ha fallat.

**2. Afegir ha de ser instantani.** Escriure una tasca no obre cap modal. S'escriu en un camp i s'apreta Enter. La riquesa (deadline, adjunts, instruccions per a la IA) arriba després, editant.

**3. Les dades són de l'usuari.** CalDAV bidireccional, API oberta, exportació completa. Fem-ho pot ser la font principal o un client d'un calendari que ja existeix. L'usuari tria, i pot marxar quan vulgui.

**4. La IA és un col·laborador amb corretja.** Pot llegir el que li deixis llegir, escriure el que li deixis escriure, i cada cosa que faci queda registrada i es pot desfer. Mai és responsable d'una tasca: sempre hi ha una persona al darrere.

**5. Una sola app amb dues formes.** Web i Android són la mateixa cosa adaptada. Un usuari que passi del mòbil a l'ordinador no ha de reaprendre res.

## Glossari

La columna **Codi** és el nom canònic. **Un concepte, un nom, arreu.** Si un dossier de `research/` en fa servir un altre, mana aquesta taula.

### Estructura

| Català (UI) | Codi | Què és |
| --- | --- | --- |
| Àmbit | `scope` | El contenidor de primer nivell. Personal, Feina, Família, o els que l'usuari creï. Una tasca **sempre** té àmbit. Individual o col·lectiu. |
| Projecte | `project` | Subdivisió d'un àmbit. Opcional: una tasca pot tenir àmbit i cap projecte. |
| Espai general | — | El conjunt de tasques d'un àmbit sense projecte. No és una entitat: és un filtre (`project_id IS NULL`). |
| Membre | `scope_member` | Relació entre una persona i un àmbit col·lectiu, amb un rol. |
| Membre extern | `external_member` | Persona d'un àmbit col·lectiu que no és usuari de Fem-ho i hi arriba només per CalDAV. |
| Tasca | `task` | La unitat de treball. |
| Subtasca | `subtask` | Filla d'una tasca. No té àmbit propi: hereta el de la mare. |
| Llista senzilla | `checklist` | Llista de comprovació dins d'una tasca. Els seus ítems són `checklist_item`. |
| Ítem | `checklist_item` | Element d'una llista senzilla. Només té text i fet/no fet. |
| Esdeveniment | `event` | Cita del calendari. **No és una tasca.** Té inici, fi i possiblement assistents. |
| Etiqueta | `label` | Marca lliure sobre una tasca. |
| Usuari | `user` | Persona amb compte. |
| Agent IA | `ai_agent` | Identitat d'IA que pot rebre feina delegada. |
| Convidat | `guest` | Qui entra per un enllaç compartit, sense compte. |

### Estat i ordre

| Català (UI) | Codi | Notes |
| --- | --- | --- |
| Bústia d'entrada | `status = 'inbox'` | Primera columna. |
| Per fer | `status = 'todo'` | |
| Fent | `status = 'doing'` | |
| Fet | `status = 'done'` | |
| — | `position` | Ordre dins d'una columna. Índex fraccional en `TEXT`, calculat al client. |
| — | `completed_at` | Instant en què es va marcar feta. |
| — | `user_settings.done_cleared_at` | Instant de l'última neteja de la columna Fet. Per usuari. |

**El camp es diu `status`, no `column`.** `column` és paraula reservada o conflictiva en pràcticament tot ORM i tota discussió de SQL.

**Els valors són en anglès.** El català apareix només a la traducció de la UI. Un enum en català obliga a mantenir accents i majúscules a la base de dades, a l'API i al MCP alhora, i es trenca sol.

### Mode IA

| Català (UI) | Codi | Què vol dir |
| --- | --- | --- |
| Individual | `ai_mode = 'manual'` | La faig jo. La IA no hi toca. |
| Amb ajuda | `ai_mode = 'assisted'` | La IA pot proposar, comentar, preparar. No la tanca. |
| Delegada | `ai_mode = 'delegated'` | La IA la pot executar sencera, dins dels seus límits. |

**Delegar no és assignar.** Una tasca delegada continua tenint una persona assignada, que n'és responsable. `assignee_id` apunta a una persona; `delegate_agent_id` apunta a un agent. Són camps diferents i no es substitueixen.

### Interoperabilitat

| Terme | Codi | Notes |
| --- | --- | --- |
| Calendari d'origen | `calendar_source` | CalDAV o `.ics` extern que Fem-ho llegeix. |
| Col·lecció | `collection` | Una col·lecció CalDAV que Fem-ho publica. |
| Token | `api_token` | Credencial d'abast limitat. |
| Enllaç compartit | `share` | Accés públic a una tasca o llista senzilla. |
| Registre d'activitat | `activity_log` | Historial append-only de tot canvi. |

## Convencions de format

Aquestes són les que ja fa servir el prototip. Mantingues-les.

> **Actualitzat l'agost del 2026.** Quan es va escriure això, Fem-ho tenia un sol idioma
> i aquestes convencions eren constants del codi. Ara en té tres —català, anglès i
> castellà— i **el que depèn de la llengua el dona CLDR**, a través d'`Intl` a la web i
> de `java.time` a Android, que porten la mateixa base i per tant no divergeixen.
> El que no depèn de la llengua es queda escrit aquí.

**Dies de la setmana, abreujats i en minúscula**: en català `dl` `dt` `dc` `dj` `dv` `ds` `dg`. Els noms els dona CLDR; el que hi posa el producte és la minúscula i que no portin punt final, que la capçalera d'una columna de dues lletres no en vol.

**Mesos en minúscula** on la llengua ho faci: en català i castellà sí, en anglès no ("August"). Amb majúscula només si obren frase o etiqueta.

**La setmana comença on digui la llengua**: dilluns en català i castellà, diumenge en anglès. La taula viu a `packages/contracts/src/dates.ts` i **està escrita, no derivada**: ha de donar el mateix a la web i a Android, i si cadascú l'endevinés el calendari es desplaçaria un dia sense donar cap error.

I **es pot canviar a mà** a Ajustos ▸ General, just sota l'idioma. El primer dia de la setmana no és només una convenció lingüística: qui treballa el cap de setmana el vol d'una manera i qui no, d'una altra, i tots dos poden tenir la mateixa llengua.

**Hores en el format de la llengua**: 24 h amb dos punts en català i castellà (`17:30`), 12 h amb AM/PM en anglès (`5:30 PM`).

**El separador és el punt volat `·`**, amb espai a banda i banda: "Feina · Client Salt", "Delegada · fa 5 min". És el que fa servir el design system Plou i no s'ha de substituir per guions ni barres.

**Els botons que afegeixen porten un `+` literal**: "+ Nou projecte", "+ Afegir membre".

**Els placeholders acaben en punts suspensius d'un sol caràcter** `…`, no tres punts: "+ Afegir a Per fer…".

**Frases senceres als estats buits**, mai un guió: "Cap tasca sense dia." "Sense esdeveniments ni tasques aquest dia."

**Sentence case a tot arreu.** Majúscula inicial i prou. Les MAJÚSCULES es reserven als epígrafs petits ("SENSE DIA", "PERSONAL").

**Res d'emoji.** El design system ho prohibeix explícitament i és una regla que Fem-ho hereta.

## Tracte

Tu implícit, imperatiu net. "Afegeix una tasca", no "Podries afegir una tasca?" ni "L'usuari pot afegir…". Res de "nosaltres". Res de personalitat: l'app no fa broma, no felicita i no s'emociona quan acabes una llista.

## Colors d'àmbit

El design system Plou diu que la seva tríada de marca (blau `#6EA8FF`, taronja `#FF9D4D`, rosa `#FF6FA0`) **no s'ha de fer servir mai com a farciment pla**, i que només pot haver-hi un gradient per vista.

**Fem-ho trenca aquesta regla deliberadament**, perquè els àmbits necessiten color categòric i la tríada ja és el llenguatge visual del producte. La regla estesa és a [`04-design-system.md`](04-design-system.md). Els àmbits creats per l'usuari reben color d'una paleta ampliada, no de la tríada.

| Àmbit inicial | Color | Token |
| --- | --- | --- |
| Personal | blau | `--plou-blue` |
| Feina | taronja | `--plou-orange` |
| Família | rosa | `--plou-pink` |

## Noms propis

L'app es diu **Fem-ho**, amb guió i la hac. Mai "Femho", "FemHo" ni "fem-ho" a la interfície. Al codi, el paquet és `fem-ho` i el prefix de variables d'entorn és `FEMHO_`.
