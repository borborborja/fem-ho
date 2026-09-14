# Auditoria de funcionalitats de Fem-ho

## 1. Diagnosi i abast

**Fem-ho necessita completar els recorreguts d’ús quotidià i convertir la delegació a IA en una experiència comprensible i verificable.** La base funcional és àmplia; afegir moltes opcions abans de resoldre aquests recorreguts augmentaria la complexitat. La proposta és desenvolupar dues àrees coordinades: **gestió de tasques**, que ha de funcionar per si sola, i **IA**, que ha de reduir feina amb un control humà visible.

L’auditoria pren com a públic principal persones que combinen feina, vida personal i organització familiar, incloent-hi autònoms que no necessiten una eina empresarial. És una hipòtesi de segmentació coherent amb la visió del repositori: ús domèstic, dades pròpies, separació entre àmbits i un mateix model a web i Android. Encara cal validar quin d’aquests grups aporta més ús recurrent.[^1]

### Decisions recomanades

| Àrea | Primer | Després | Experiment posterior |
| --- | --- | --- | --- |
| Gestió de tasques | Captura persistent i sincronització comprensible; recordatoris complets | Avui i pròxims dies; paperera; rutines reutilitzables | Durades i blocs de treball; dependències simples |
| IA | Connexió comprovable; context visible i limitat | Propostes revisables; extracció de tasques des de text | Planificació suggerida segons disponibilitat |

La prioritat no és crear un xat genèric dins l’aplicació. La millor oportunitat és facilitar accions concretes: convertir una petició en una tasca clara, preparar-ne els passos i retornar un resultat que l’usuari pugui avaluar. La planificació automàtica queda després, perquè necessita dades i controls que avui són parcials.

### Base de l’anàlisi i límits

La base tècnica correspon al commit `849f3a7bee465ad586df99cf041c4f9d8818bf81` de Fem-ho i a la seva documentació de producte. L’evidència inclou un registre privat d’incidències, recerca publicada, documentació oficial de sis productes i un fil públic de peticions d’usuaris. La data de referència és el **9 de setembre de 2026**; les característiques comercials poden canviar.

L’evidència disponible és documental i de codi: no inclou entrevistes a usuaris de Fem-ho, mesures de retenció ni una nova verificació completa en producció. El registre públic d’incidències de GitHub no aporta casos a la data de referència; això no implica absència de problemes. Les incidències privades provenen d’un únic informant i no tenen representativitat estadística.

Es distingeixen tres nivells: **fet observat**, quan hi ha codi o una font que ho acredita; **interpretació**, quan es relaciona aquest fet amb una necessitat; i **recomanació**, quan es proposa un canvi. «Present al codi» no equival a «validat en tots els dispositius». Quan documentació i implementació divergeixen, s’ha prioritzat el codi i s’ha explicitat el límit.

## 2. Què ofereix realment l’aplicació

La taula evita confondre infraestructura, interfície i resultat utilitzable. Hi ha funcions descrites com a pendents que ja tenen implementació, i altres especificades amb detall que encara no disposen d’un recorregut complet. Les referències fixen la versió auditada perquè aquesta fotografia es pugui revisar més endavant.

| Capacitat | Estat observat | Implicació per al producte |
| --- | --- | --- |
| Àmbits, projectes, etiquetes, kanban i cerca | Presents, amb controls de visibilitat i compartició | Millorar-ne la comprensió; no reconstruir l’organització bàsica.[^1][^2] |
| Captura ràpida i dreceres | Presents; l’error d’Intro ja està corregit | Mesurar rapidesa i recuperació davant fallades, especialment al mòbil.[^2][^3] |
| Subtasques, llistes, comentaris i adjunts de tasques | Presents a web; Android també té interfície d’adjunts | No proposar «afegir adjunts a Android» com una novetat absent.[^2][^4] |
| Recurrència i dates | Recurrència simple per calendari o compleció; data, hora i `deadline` separats | Falta un editor de regles més expressives; no falta la recurrència bàsica.[^2] |
| Calendari i fonts externes | Vistes i connexions; fitxa bàsica d’esdeveniment a la vista diària | La fitxa ja existeix. Es pot completar amb descripció, adjunts i accés coherent des de totes les vistes.[^5] |
| Correu a tasca | Connexió IMAP, encaminament i conversió amb procedència | És una base per a captura assistida; no és extracció semàntica per IA.[^6] |
| Funcionament sense connexió | Cua web i pantalla de prova; pantalles habituals amb crides directes a l’API. Android conserva conflictes i rebutjos | Completar la persistència web i la resolució visible de conflictes. No anunciar equivalència offline entre clients.[^7] |
| Recordatoris | Taula, servei push i planificador presents | No s’ha localitzat un editor ordinari de recordatoris ni el seu contracte HTTP complet. El motor, tot sol, no resol «avisa’m demà».[^8] |
| Silenci, resum diari i altres canals | Preferències al model; el planificador revisat processa recordatoris push | No s’ha localitzat execució del resum diari ni aplicació de les hores de silenci; tampoc un circuit complet de recordatoris SMTP/webhook.[^8] |
| Desfer i recuperació | Historial i reversió de determinats canvis autònoms d’IA; esborrat lògic de tasques | No s’ha localitzat paperera ni restauració general accessible a l’usuari.[^9] |
| Temps dedicat | Sessions i seguiment de temps ja implementats, opcionals per àmbit | Diferenciar el temps registrat de la durada estimada per planificar.[^10] |
| Agents externs | MCP, credencials, delegació, preguntes, represa, reclamació humana i historial | Millorar l’activació i la supervisió sobre aquest sistema existent.[^11] |
| IA integrada al servidor | Estat de configuració; el mateix endpoint adverteix que les credencials encara no s’utilitzen | Una clau configurada no produeix tasques ni resums automàticament.[^12] |
| Context d’adjunts per a IA | Camp `is_ai_context` i opció en la pujada; sense selector ordinari a la UI revisada | Cal concretar selecció, revocació i aplicació efectiva de la política; el camp no acredita tot el circuit.[^13] |
| Android: projectes, compartir i reclamació humana | Creació de projectes, recepció d’`ACTION_SEND` i acció de recuperar una tasca presents | La paritat necessita proves, però aquestes funcions no són noves absències.[^4] |

**Conclusió de l’inventari:** la mancança principal és el tancament dels fluxos. Un recordatori necessita creació, confirmació i entrega; una captura necessita sobreviure a un tall; una delegació necessita acabar en un resultat comprensible. La documentació d’estat també necessita reconciliar-se amb el codi abans de servir com a llista de pendents.

## 3. Necessitats de les persones i força de l’evidència

### Capturar i recuperar sense haver de pensar en l’eina

Les incidències d’Intro, del selector d’àmbits i de l’avís persistent mostren fricció en accions freqüents. Estan corregides i no es compten com a deute pendent en aquesta auditoria.[^3] La interpretació és que la rapidesa percebuda depèn tant de la resposta correcta i estable com del nombre de funcions. La hipòtesi a validar és que una captura persistent i una recuperació fàcil generen més confiança que ampliar els camps del formulari.

### Decidir què toca, sense convertir-ho tot en urgent

En el fil públic de peticions de Todoist apareixen demandes de durades sense data, ajornament de visibilitat, context de subtasques i agrupació de petites tasques en blocs. També hi ha participants que prefereixen introduir text en lloc de parlar en una oficina.[^14] Són exemples autoseleccionats: ajuden a descobrir situacions, però no indiquen quina proporció del mercat les necessita ni quines segueixen sense resoldre’s avui. Per a Fem-ho suggereixen validar una vista diària tranquil·la, estimacions opcionals i captura de text abans d’un assistent centrat en veu.

### Compartir també la responsabilitat de recordar

Daminger va estudiar la feina cognitiva domèstica mitjançant 70 entrevistes a membres de 35 parelles. Distingeix anticipar necessitats, identificar opcions, decidir i supervisar; el treball no es limita a executar una acció física.[^15] És recerca qualitativa de 2019, no una prova que una aplicació reparteixi millor la càrrega. La inferència de producte és provar rutines amb responsable i propera revisió, de manera que compartir una tasca no mantingui tota la feina de seguiment en qui la crea.

### Rebre menys interrupcions i conservar les importants

WorkLab documenta fragmentació en treballadors del coneixement, però cal llegir-ne la metodologia. La xifra molt difosa d’interrupcions cada dos minuts es calcula sobre el 20% amb més avisos, i la telemetria exclou els entorns de la UE i educació.[^16] No és una descripció de totes les famílies ni de tots els usuaris catalans. Juntament amb la queixa local sobre el banner, reforça una direcció a validar: confirmacions breus, errors recuperables al seu lloc i recordatoris que l’usuari hagi decidit rebre.

### Delegar sense haver de vigilar constantment

L’estudi CHI 2025 de Lee i col·laboradors recull 936 exemples de 319 treballadors. Hi associa més confiança en IA amb menys esforç crític declarat, i descriu un desplaçament de feina cap a verificar i integrar resultats.[^17] No demostra deteriorament causal ni quantifica l’estalvi que obtindria Fem-ho. La proposta derivada és facilitar l’avaluació: objectiu, fonts, canvis i punts pendents, amb acceptació explícita quan el flux ho requereixi.

El Work Trend Index 2026, basat en una enquesta a 20.000 treballadors que utilitzen IA de deu països, també situa la revisió de qualitat i el pensament crític entre les habilitats destacades pels participants.[^18] És recerca d’un proveïdor amb interès comercial i públic professional. Serveix de senyal complementari, no de justificació per automatitzar tota l’aplicació.

| Necessitat hipotètica | Senyal disponible | Confiança inicial | Com validar-la a Fem-ho |
| --- | --- | --- | --- |
| Captura fiable | Incidències pròpies i buit offline al codi | Alta per al problema local | Capturar amb tall de xarxa i reprendre al segon dispositiu |
| Priorització diària | Peticions públiques i alternatives de mercat | Mitjana | Observar com es trien les tres pròximes accions |
| Rutines amb responsabilitat | Recerca domèstica i ús compartit previst | Mitjana | Prova de dues setmanes amb llars |
| Avisos controlables | Queixa pròpia i flux parcial | Alta per al buit; demanda general no mesurada | Crear un recordatori real i comprovar-ne l’entrega |
| Revisió de la IA | Recerca i sistema d’agents existent | Mitjana | Comparar esforç total manual i assistit |

## 4. Comparativa funcional i posicionament

S’han seleccionat sis referents per cobrir tasques personals, organització familiar, programari amb dades pròpies i assistència amb IA. La taula recull funcionalitats anunciades en documentació oficial; no és un assaig pràctic de cada producte ni un rànquing. Una característica comercial mostra una resposta de disseny possible, no una necessitat demostrada.

| Referent | Què acredita la font oficial | Aprenentatge per a Fem-ho |
| --- | --- | --- |
| Todoist | Separa data de treball i límit; incorpora durades. Assist ofereix veu, extracció de correus, suggeriment de passos i filtres en llenguatge natural.[^19][^20][^21] | Fer visibles les dates que Fem-ho ja té i provar assistència en moments concrets |
| TickTick | Captura ràpida, filtres, recordatoris, recurrència flexible, calendari, durades i eines de concentració.[^22] | El llindar competitiu és un recorregut diari complet; no cal copiar totes les eines de concentració |
| Vikunja | Projectes compartits, filtres desats, relacions, importació i opció d’autoallotjament.[^23] | Les dades pròpies per si soles no diferencien Fem-ho; importa com s’utilitzen |
| Tasks.org | Ús offline, protocols i opcions de sincronització oberts, filtres i subtasques.[^24] | La fiabilitat al mòbil és una expectativa rellevant en aquest segment |
| Cozi | Calendari familiar i llistes compartides per a tasques i compres.[^25] | Validar situacions familiars senzilles, sense convertir-les en administració de projectes |
| Reclaim | Planificació de tasques, hàbits, espais de concentració i assistència sobre el calendari.[^26] | Explorar suggeriments segons capacitat; cal comprovar-ne l’acceptació i el cost de corregir-los |

**Posicionament proposat:** «Organitzar feina i vida personal amb dades pròpies, àmbits clars i ajuda d’IA que es pot revisar». És una proposta estratègica, no un posicionament validat amb clients. La combinació aprofita conceptes presents al producte i evita competir només pel nombre de funcions.

La diferenciació potencial té tres components: separar contextos privats amb claredat, coordinar responsabilitats quotidianes i delegar feina concreta sense perdre’n el fil. El primer ja forma part del model; els altres necessiten observació i proves d’ús. La IA ha de continuar sent opcional, perquè el valor bàsic no pot dependre de connectar un proveïdor.

La comparativa també limita què val la pena fer. Un Gantt empresarial, sprints, puntuacions de productivitat familiar o un xat generalista no resolen directament els problemes millor acreditats. Es proposa ajornar-los fins que hi hagi una demanda concreta i coherent amb la visió.

## 5. Àrea de gestió de tasques: cartera prioritzada

Les prioritats següents són un judici de producte. **P0** completa una promesa essencial; **P1** millora el recorregut principal; **P2** requereix validació abans d’invertir-hi. L’esforç és relatiu: **S** afecta una superfície acotada, **M** diversos components i **L** sincronització, contractes o clients. No són estimacions de dies.

| ID | Proposta i mínim útil | Tipus | Prioritat / esforç |
| --- | --- | --- | --- |
| T1 | **Captura persistent i sincronització visible.** Desar la intenció local; indicar pendent, sincronitzat o necessitat de revisió; resoldre conflictes | Completar | P0 / L |
| T2 | **Recordatoris utilitzables.** Crear, editar i cancel·lar des de la tasca; prova de recepció i estat real dels canals | Completar | P0 / L |
| T3 | **Avui, pròxims dies i filtres desats.** Reunir tasques pròpies, límits propers i elements a revisar amb context d’àmbit/projecte | Ampliar | P1 / M |
| T4 | **Paperera i recuperació.** Recuperar un esborrat i informar amb precisió de què es restaura | Nova sobre esborrat lògic | P1 / M |
| T5 | **Rutines i plantilles.** Reutilitzar tasques amb llistes, responsables i dates relatives; ampliar l’editor de recurrència | Ampliar | P1 / M |
| T6 | **Calendari amb context complet.** Fitxa accessible des de totes les vistes, descripció, adjunts i enllaç a l’origen | Completar | P1 / M |
| T7 | **Durada prevista i blocs de treball.** Estimar sense obligar a posar data; reservar una franja vinculada a tasques | Nova | P2 / L |
| T8 | **Esperes i dependències simples.** Indicar «pendent de resposta» i relació bloquejant sense afegir columnes obligatòries | Nova | P2 / M |
| T9 | **Entrada i sortida de dades guiada.** Exposar exportació i preparar una importació amb previsualització de camps i duplicats | Ampliar | P2 / M |

T1 i T2 responen a buits observats.[^7][^8] T3 reaprofita cerca, dates i projectes, sense presentar-los com a inexistents.[^2] T4 parteix del model d’esborrat i no substitueix les còpies de seguretat.[^9] T5–T9 són propostes de disseny: les fonts competitives aporten referents, però la seva prioritat final dependrà de l’ús real.

### Criteris d’acceptació dels primers increments

**T1 — Captura.** Crear una tasca sense connexió, tancar l’aplicació i tornar-la a obrir ha de conservar el text i el context. En reconnectar, la tasca apareix una sola vegada a l’altre dispositiu. Si els permisos han canviat o hi ha edicions incompatibles, la intenció es conserva i s’ofereix una acció entenedora; un toast temporal no és suficient per resoldre aquest estat.

**T2 — Recordatoris.** L’usuari crea un avís per una tasca real i entén en quin dispositiu o canal el rebrà. La prova inclou permís denegat, reinici del servidor, fallada de lliurament i canvi de zona horària. Abans d’oferir hores de silenci o resum diari, cal connectar-los al processament i provar-los; es desplega primer un canal complet, després els altres.

**T3 — Vista diària.** «Avui» diferencia allò previst per avui dels límits que s’apropen. Permet veure projecte i àmbit, ocultar una espera fins a la revisió acordada i recuperar filtres personals. No introdueix una nova data que dupliqui `due_date` i `deadline` sense haver resolt abans el vocabulari amb usuaris.

**T4 — Recuperació.** Restaurar una tasca conserva les relacions que segueixin sent vàlides i explica les que no es puguin recuperar. Els permisos s’avaluen en el moment de restaurar. L’esdeveniment extern vinculat continua independent; el llenguatge de «definitivament» s’ha de reservar a una purga real si s’introdueix paperera.

**T5 — Rutines.** Una llar configura «preparar la setmana» amb passos i responsable, sense haver de recrear-los. L’editor mostra les pròximes ocurrències per comprovar-ne el significat, incloent dies laborables i recurrència a partir de completar. La prova verifica què passa amb llistes, terminis i tasques omeses abans d’afegir moltes variants.

T7 necessita una decisió de model pròpia: **temps estimat**, **temps reservat** i **temps registrat** són conceptes diferents. Una franja acabada no completa automàticament la tasca. La publicació d’aquests blocs a calendaris externs s’hauria d’abordar com una integració posterior, amb les seves capacitats d’escriptura verificades.

## 6. Àrea d’IA: assistència concreta i supervisable

Fem-ho ja té un model d’agents externs, amb delegació, credencials i operacions auditades. També hi ha configuració de proveïdor que encara no executa models.[^11][^12] Es recomana començar sobre la via externa existent; incorporar un motor al servidor exigeix revisar explícitament la decisió P10, els costos operatius i els límits de dades. La detecció de dates naturals, ajornada a D12, tampoc s’hauria de reintroduir accidentalment.[^27]

| ID | Proposta i mínim útil | Base i dependència | Prioritat / esforç |
| --- | --- | --- | --- |
| I1 | **Agent comprovable.** Prova guiada de connexió i tasca de mostra; distingir configurat, connectat, treballant i aturat | Ampliar configuració, tokens i historial existents | P0 dins IA / M |
| I2 | **Context visible.** Veure instruccions, tasques i adjunts que s’inclouran; seleccionar i revocar fitxers | Completar metadades i política d’accés efectiva | P0 dins IA / M |
| I3 | **Propostes i resultats revisables.** Pla curt, canvis previstos, resultat i punts pendents; acceptar, corregir o rebutjar | Reutilitzar assistència, preguntes i historial; contracte estructurat | P1 / M |
| I4 | **Text o correu a tasques proposades.** Extreure accions amb procedència i dades dubtoses visibles | I2 + I3; IMAP ja existeix. Adaptador extern inicial | P1 / M |
| I5 | **Desglossar una tasca.** Proposar passos editables i un criteri de finalització, sense crear-los de cop | I3; llistes/subtasques actuals | P1 / S–M |
| I6 | **Preparar el dia.** Proposar una selecció assumible i explicar què no hi cap | T3 i T7; disponibilitat i límits revisats | P2 / L |
| I7 | **Temps, cost i errors de l’agent.** Última activitat útil, motiu d’aturada, consum declarat i límits | I1; cooperació de l’executor extern | P1 / M |
| I8 | **Consulta en llenguatge natural.** Respondre sobre tasques accessibles amb enllaços i filtres inspeccionables | T3 + I2; consulta amb permisos | P2 / M |

«P0 dins IA» significa necessari abans d’ampliar l’assistència, no que s’hagi d’activar IA a tots els usuaris. I1 i I7 han de reutilitzar l’activitat i l’ús de tokens que ja es registren: no cal un segon historial. Un agent sense activitat recent pot estar esperant feina; el sistema ha de distingir aquesta situació d’una fallada sense inventar un percentatge de progrés.

### Primer cas d’ús: convertir una petició en feina clara

L’usuari enganxa un correu i demana preparar les tasques. La proposta mostra cada acció, l’extracte que la sustenta, les dates explícites i allò que falta confirmar. Si «divendres» és ambigu, s’ensenya la interpretació amb data i zona horària; si no hi ha responsable, no se n’inventa cap. La confirmació crea només les files seleccionades, conserva l’origen i evita duplicats si es repeteix la petició.

El pilot començaria amb text en català, castellà i anglès. La veu vindria després d’haver demostrat l’estalvi en aquest recorregut; el dictat del dispositiu pot servir per explorar-la sense construir primer tota una plataforma d’àudio. Les plantilles del correu actual són útils per convertir formats previsibles, mentre que l’extracció semàntica s’ha de presentar com una proposta revisable.

### Segon cas d’ús: delegar i revisar un resultat

Abans d’executar, la tasca indica l’objectiu, els materials i què es considerarà acabat. L’agent retorna un resultat, les fonts o fitxers utilitzats i les decisions que requereixen resposta. En mode assistit, la persona confirma el tancament; en mode delegat s’apliquen les regles actuals i es pot revisar l’activitat o recuperar el control. Aquesta experiència amplia el sistema existent de preguntes i represa, en lloc de duplicar-lo amb un xat paral·lel.

### Condicions per considerar fiable el pilot

La selecció de context s’ha de fer efectiva al servidor i a l’executor, no només amb una casella visual. Les proves inclouran adjunts exclosos, text que intenta donar instruccions fora de l’objectiu, permisos retirats durant l’execució, repetició d’una operació i canvis simultanis d’una persona. Qualsevol suggeriment ha de conservar els límits entre àmbits i no revelar dades d’un altre usuari.

L’indicador de cost ha de mostrar «desconegut» quan l’executor no en proporcioni dades. Un límit de pressupost només es pot anunciar com a efectiu si el component que factura o executa el respecta. La mètrica decisiva serà l’esforç total, incloent preparació, espera activa, revisió i correcció; generar més tasques no implica ajudar més.

## 7. Full de ruta i decisions de seqüència

Es proposa un **horitzó de dotze setmanes per orientar decisions**, no un compromís de lliurament. L’auditoria no disposa d’estimacions de capacitat de l’equip. Si hi ha una sola persona desenvolupant, les dues àrees comparteixen capacitat i el volum es retalla; no es pressuposen equips en paral·lel.

| Finestra orientativa | Gestió de tasques | IA | Condició per avançar |
| --- | --- | --- | --- |
| Setmanes 1–2 | Reconciliar inventari; observar captura i recordatoris; prototip d’Avui | Observar connexió i revisió d’una delegació existent | Mostra d’usuaris i mesures inicials; abast tècnic estimat |
| Setmanes 3–5 | Un recorregut complet de T1 i un de T2, amb abast reduït si cal | I1 i I2 en pilot | Cap pèrdua ni duplicació en escenaris crítics; prova d’accés al context |
| Setmanes 6–8 | T3 i primera restauració de T4 | I3 i un únic cas d’I4 o I5 | Ús repetit de la vista diària i estalvi net en tasques comparables |
| Setmanes 9–12 | T5 o T6 segons observacions; prototip T7 si hi ha demanda | I7; prototip I6 només amb dades suficients | Benefici sostingut; manteniment assumible; cap regressió entre àmbits |

L’ordre de dependències és rellevant. La captura estructurada amb IA necessita context i revisió abans de crear tasques automàticament. La planificació necessita que la persona entengui les dates i pugui estimar o reservar temps. La paperera necessita definir permisos, restauració de relacions i retenció, no només afegir un botó.

**Primer lliurament recomanat:** un usuari pot capturar una tasca, recuperar-la després d’un tall, posar-hi un recordatori i veure-la en un lloc coherent. **Primer lliurament d’IA:** pot connectar un agent, comprovar què rep i revisar una proposta acotada. Són objectius verificables i més útils que publicar un conjunt de pantalles a mig connectar.

### Què podria canviar la prioritat

Si les entrevistes mostren que el problema dominant és coordinar rutines familiars, T5 passa davant de la planificació temporal. Si l’ús és majoritàriament individual i de feina, T3 i T7 guanyen pes. Si l’agent no redueix l’esforç total després de diverses proves, I4–I6 s’ajornen i es milloren plantilles i automatismes deterministes.

Un altre possible fre és l’entrada al producte. El públic previst pot incloure una persona que administra el servidor i altres membres que només volen gestionar tasques. Si aquests membres no aconsegueixen començar sense ajuda, la incorporació i les invitacions han de precedir funcions més avançades; el pilot ha de provar aquesta diferència de rols.

### Funcions que no es recomana iniciar ara

No hi ha prou evidència per prioritzar gestió empresarial de sprints, dependències complexes, rànquings familiars, un CRM, un editor documental o automatització autònoma de missatges externs. Tampoc es proposa una nova arquitectura multiagent com a requisit. Aquestes ampliacions s’avaluarien només davant d’un cas d’ús concret, benefici observat i compatibilitat amb la privacitat del producte.

## 8. Validació amb usuaris i criteris de decisió

La següent passa és convertir hipòtesis en observacions. Es proposa reclutar **8–12 participants**, amb representació de llars, ús individual de feina i persones que administren una instància; sempre que sigui possible, combinar perfils dins de la mateixa llar. És una mostra de descoberta qualitativa, insuficient per estimar demanda de mercat. El reclutament i les sessions proposades estan pendents.

### Observació inicial

Cada sessió partiria d’una situació recent: una tasca que es va oblidar, una que va requerir seguiment o una delegació que va exigir correccions. Es demanaria reconstruir el procés actual abans d’ensenyar noves idees. Després, la persona provaria captura, selecció del dia, recordatori i recuperació; qui utilitzi IA faria també una delegació comparable. S’anotarien dubtes, passos, temps i resultat sense registrar contingut personal innecessari.

Les preguntes principals serien: què va haver de recordar fora de l’app, què li va fer repetir una acció, qui va assumir el seguiment i com va saber que estava acabat. Per a IA: què va revisar, què va corregir i què no voldria compartir amb l’agent. No es preguntaria només «t’agradaria aquesta funció», perquè una preferència declarada no demostra ús recurrent.

### Pilot de dues setmanes

| Resultat | Mesura proposada | Criteri inicial de decisió |
| --- | --- | --- |
| Confiança en captura | Pèrdues, duplicats i intents necessaris; temps fins a desat persistent | Zero pèrdues i duplicats als escenaris controlats; investigar qualsevol cas real |
| Recordatori útil | Avís creat, recepció confirmada pel participant i utilitat percebuda | No confondre acceptació pel servei push amb recepció al dispositiu |
| Claredat del dia | Temps per triar la pròxima acció i ús espontani repetit | Comparació amb el procés inicial de cada persona |
| Recuperació | Proporció d’errors recuperats sense ajuda i temps de recuperació | Tots els casos de prova previstos recuperables o explicats |
| Coordinació | Recordatoris manuals entre persones i tasques sense seguiment clar | Buscar reducció sostinguda, sense comparar persones amb un rànquing |
| Utilitat d’IA | Temps total, correccions i qualitat del resultat en tasques comparables | Continuar si hi ha estalvi net repetit i qualitat equivalent o millor |
| Control de context | Casos d’accés fora d’abast i comprensió del material compartit | Zero accessos fora d’abast als casos verificats |

No hi ha valors inicials mesurats per a aquestes mètriques. Els criteris són propostes de decisió i objectius de qualitat, no resultats obtinguts. L’anàlisi del pilot ha de separar qui utilitza IA de qui no, i administradors de membres convidats; una mitjana global podria ocultar un flux difícil per a un dels grups.

### Decisions després del pilot

Una funció passa a desenvolupament ampli quan resol una situació observada, s’utilitza de nou sense insistència i no afegeix més feina de configuració que la que estalvia. S’itera quan el problema és clar però la interfície confon. S’ajorna quan només genera interès en una demostració o quan l’estalvi desapareix en incloure revisió i correccions.

L’entregable del pilot seria una llista curta de problemes amb exemples anonimitzats, el seu impacte i la decisió presa sobre T1–T9 i I1–I8. Això permetria substituir les prioritats inicials d’aquest informe per una cartera basada en ús real, sense convertir les peticions d’un altre producte en especificacions de Fem-ho.

## 9. Fonts i traçabilitat

Les fonts externes acrediten recerca o característiques anunciades, amb les limitacions indicades al text. Els enllaços de codi fixen el commit auditat; les propostes de l’informe no modifiquen les decisions normatives del repositori. Consultes externes i revisió local: 9 de setembre de 2026.

[^1]: Fem-ho. [Visió i glossari](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/docs/00-visio-i-glossari.md) i [regles de producte](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/instruccions.md). Fonts internes normatives.
[^2]: Fem-ho. [TaskModal](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/screens/TaskModal.tsx), [SearchScreen](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/screens/SearchScreen.tsx) i [model de dades implementat](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/db/types.ts). Revisió estàtica.
[^3]: Registre privat d’incidències de Fem-ho, 9 setembre 2026: captura amb Intro, selector d’àmbits i avís persistent; fotografies «Photo 1.jpg» i «Photo 2.jpg». Font no pública, un sol informant. Contrast amb [auditoria tècnica del 9 de setembre](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/docs/auditoria-2026-09-09.md), [PR 33](https://github.com/borborborja/fem-ho/pull/33) i [PR 34](https://github.com/borborborja/fem-ho/pull/34). No s’han reproduït dades de les fotografies a l’informe.
[^4]: Fem-ho, Android. [TaskDetail](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/android/feature-tasks/src/main/kotlin/ho/fem/tasks/TaskDetail.kt), [MainActivity](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/android/app/src/main/kotlin/ho/fem/app/MainActivity.kt) i [SettingsScreen](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/android/feature-settings/src/main/kotlin/ho/fem/settings/SettingsScreen.kt). Presència al codi; no certificació nova de paritat.
[^5]: Fem-ho. [CalendarScreen](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/screens/CalendarScreen.tsx) i [EventSheet](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/screens/EventSheet.tsx). Fitxa bàsica i punts d’accés revisats.
[^6]: Fem-ho. [Conversió de correu](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/services/mail-convert.ts) i [consulta periòdica](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/jobs/mail-poll.ts). No s’ha connectat un compte IMAP real en aquesta auditoria.
[^7]: Fem-ho. [Cua de sortida web](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/sync/outbox.ts), [OfflineProof](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/OfflineProof.tsx), [BoardScreen](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/screens/BoardScreen.tsx) i [Repository d’Android](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/android/core-data/src/main/kotlin/ho/fem/data/Repository.kt). Contrast entre infraestructura i recorregut habitual.
[^8]: Fem-ho. [Servei de notificacions](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/services/notifications.ts), [planificador](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/jobs/scheduler.ts), [preferències](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/services/users.ts), [contracte HTTP](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/packages/contracts/openapi.yaml) i [especificació de notificacions](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/docs/11-notificacions.md). La cerca estàtica no ha localitzat els recorreguts indicats; cal convertir-ho en verificació funcional abans d’una publicació.
[^9]: Fem-ho. [Activitat i reversió](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/services/activity.ts) i [servei de tasques](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/services/tasks.ts). La reversió d’IA no equival a restauració general.
[^10]: Fem-ho. [Migració de seguiment de temps](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/db/migrations/019-time-tracking.ts) i decisió P27 a la font 27.
[^11]: Fem-ho. [Mode IA](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/docs/09-mode-ia.md), [servidor MCP](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/mcp/server.ts) i [configuració web](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/screens/SettingsScreen.tsx). Base existent, no motor propi de models.
[^12]: Fem-ho. [Endpoint d’estat d’IA](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/http/ai-status.ts). Retorna explícitament `configuredButUnused` quan hi ha proveïdor configurat.
[^13]: Fem-ho. [API d’adjunts](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/server/src/http/attachments.ts) i [component web](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/apps/web/src/app/Attachments.tsx). Contrast entre opció d’API i interfície.
[^14]: Comunitat r/todoist. [What would you love to see us ship in 2026?](https://www.reddit.com/r/todoist/comments/1q1v4el/what_would_you_love_to_see_us_ship_in_2026/). Fil públic amb respostes d’usuaris i del responsable del producte. Mostra autoseleccionada; les peticions no acrediten absències actuals ni prevalença.
[^15]: Daminger, Allison (2019). [The Cognitive Dimension of Household Labor](https://inequality.hks.harvard.edu/publications/cognitive-dimension-household-labor). *American Sociological Review*, 84(4), 609–633. Resum institucional de Harvard; estudi qualitatiu de 35 parelles. [DOI](https://doi.org/10.1177/0003122419859007).
[^16]: Microsoft WorkLab (17 juny 2025). [Breaking down the infinite workday](https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday). Telemetria fins al 15 de febrer de 2025 i enquesta; s’ha consultat la metodologia i els límits de mostreig.
[^17]: Lee, H.-P. i col·laboradors (2025). [The Impact of Generative AI on Critical Thinking](https://www.microsoft.com/en-us/research/wp-content/uploads/2025/01/lee_2025_ai_critical_thinking_survey.pdf). *CHI 2025*. Enquesta de 319 treballadors amb 936 exemples; associacions i percepcions declarades. [DOI](https://doi.org/10.1145/3706598.3713778).
[^18]: Microsoft (5 maig 2026; actualització 11 maig). [How Frontier Firms are rebuilding the operating model for the age of AI](https://blogs.microsoft.com/blog/2026/05/05/how-frontier-firms-are-rebuilding-the-operating-model-for-the-age-of-ai/). Síntesi oficial del Work Trend Index 2026; enquesta a usuaris d’IA, amb context comercial.
[^19]: Todoist (actualitzat 1 setembre 2026). [Introduction to deadlines in Todoist](https://www.todoist.com/help/todoist/features/introduction-to-deadlines-in-todoist-uMqbSLM6U). Documentació oficial: distinció de dates i límits.
[^20]: Todoist (actualitzat 1 setembre 2026). [Set a task duration](https://www.todoist.com/help/todoist/features/set-a-task-duration-L1kYkZv8d). Documentació oficial de durades; no prova d’estalvi de temps.
[^21]: Todoist. [Todoist Assist](https://www.todoist.com/todoist-assist). Catàleg oficial de Ramble, Task Assist, Email Assist i Filter Assist, consultat el 9 setembre 2026.
[^22]: TickTick. [Features](https://ticktick.com/features?language=en_US). Catàleg oficial consultat el 9 setembre 2026; les condicions depenen de plataforma i pla.
[^23]: Vikunja. [Features](https://vikunja.io/features/). Catàleg oficial consultat el 9 setembre 2026; es descriuen filtres, relacions, importació i autoallotjament.
[^24]: Tasks.org. [Open-source To-Do Lists & Reminders](https://tasks.org/). Presentació oficial de funcionament offline, protocols i sincronització, consultada el 9 setembre 2026.
[^25]: Cozi. [Features Overview](https://www.cozi.com/feature-overview/). Presentació oficial de calendari i llistes familiars, consultada el 9 setembre 2026.
[^26]: Reclaim. [Producte i funcionalitats](https://reclaim.ai/). Catàleg oficial consultat el 9 setembre 2026. S’ha evitat barrejar límits de plans o guies antigues de la versió 1.0 amb l’oferta actual.
[^27]: Fem-ho. [Decisions de producte i arquitectura](https://github.com/borborborja/fem-ho/blob/849f3a7bee465ad586df99cf041c4f9d8818bf81/docs/14-decisions.md), especialment D12, P10 i P27. L’informe proposa una seqüència; no altera aquestes decisions.
