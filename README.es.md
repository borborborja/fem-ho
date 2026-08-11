<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/portada-fosc.svg">
  <img src="docs/img/portada-clar.svg" alt="Fem-ho">
</picture>

<p align="right">
  <a href="README.md">Català</a> ·
  <a href="README.en.md">English</a> ·
  <strong>Castellano</strong>
</p>

# Fem-ho

Un gestor de tareas y calendario **para una casa**, pensado para autoalojarse. Web, app de
Android y un servidor que habla CalDAV y MCP.

En catalán, inglés y castellano.

> El nombre es catalán y quiere decir _«hagámoslo»_.

---

## Para quién es, y para quién no

Para **un hogar**: una o más personas adultas que ya tienen un servidor en casa y quieren
gestionar el trabajo, la vida personal y la familia en el mismo sitio, **sin que el
trabajo se entere de la familia ni al revés**.

No es un producto para equipos de empresa. No hay sprints, ni estimaciones, ni informes de
velocidad, ni permisos granulares por campo. Hay personas que comparten una casa y,
algunas de ellas, también un trabajo.

## Las cinco ideas que lo gobiernan

**1 · De un vistazo.** La pantalla principal tiene que responder «qué tengo que hacer» sin
clicar nada. Si para saber qué toca hoy hay que navegar, el diseño ha fallado.

**2 · Añadir tiene que ser instantáneo.** Escribir una tarea no abre ninguna ventana: se
escribe en un campo y se pulsa Enter. La riqueza —vencimiento, adjuntos, instrucciones
para la IA— llega después, editando.

**3 · Los datos son tuyos.** CalDAV en las dos direcciones, API abierta, exportación
completa. Fem-ho puede ser la fuente principal o un cliente de un calendario que ya
tienes. Eliges tú, y **puedes irte cuando quieras**.

**4 · La IA es un colaborador con correa.** Puede leer lo que le dejes leer y escribir lo
que le dejes escribir, todo lo que hace queda registrado y se puede deshacer, y **nunca es
responsable de una tarea**: siempre hay una persona detrás.

**5 · Una sola app con dos formas.** Web y Android son la misma cosa adaptada. Quien pase
del móvil al ordenador no tiene que reaprender nada.

## Qué lo distingue

- **Ámbitos, no proyectos sueltos.** Personal, trabajo y familia conviven en el mismo
  tablero y se filtran con un clic. Una tarea siempre pertenece a un ámbito; puede no
  tener proyecto.
- **La bandeja es el día entero.** No solo tus tareas: los calendarios suscritos y los
  canales RSS entran al lado, y se navega día a día. De una cita se puede hacer una tarea,
  y mientras esa tarea viva la cita deja de reclamarte nada.
- **CalDAV de verdad**, en ambas direcciones. El calendario del móvil y el del ordenador
  ven lo mismo, y un `.ics` o un RSS externos se pueden poner como fuente.
- **Todo deja rastro.** Ninguna escritura llega a la base sin una entrada en el historial
  dentro de la misma transacción. No es una función: es una invariante que una comprobación
  permanente hace cumplir.

## Cómo se arranca

```bash
curl -O https://raw.githubusercontent.com/borborborja/fem-ho/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/borborborja/fem-ho/main/.env.example
# Pon tu dominio en FEMHO_BASE_URL
docker compose up -d
```

Y en `http://localhost:8080` está `/setup`, que crea el primer administrador y cierra esa
puerta para siempre. Con Postgres en vez de SQLite, `compose.postgres.yaml`.

La imagen es multiarquitectura (`amd64` y `arm64`), así que va igual en un servidor que en
una Raspberry Pi:

```
ghcr.io/borborborja/fem-ho:latest        # o :0.6.0 para fijar la versión
```

### Un contenedor, un volumen

**El volumen es todo lo que hay que guardar**: la base, el secreto de la instancia, los
adjuntos y una copia previa a cada migración. Una copia del volumen es una copia de
seguridad completa.

### Las opciones

En el `.env` de al lado, que Compose lee solo. Las que más se tocan:

| Variable                   | Por defecto               | Qué hace                                                                                          |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `FEMHO_BASE_URL`           | —                         | **Obligatoria en producción.** Sin ella, CalDAV y los enlaces compartidos generan URL incorrectas |
| `FEMHO_INSTANCE_NAME`      | `Fem-ho`                  | El nombre que ve quien se conecta                                                                 |
| `FEMHO_DATABASE_URL`       | `sqlite:///data/femho.db` | SQLite o `postgres://…`                                                                           |
| `FEMHO_ALLOW_REGISTRATION` | `false`                   | Cualquiera puede crearse una cuenta. **La primera será administradora**                           |
| `FEMHO_GRAVATAR`           | `false`                   | Las fotos de perfil salen de Gravatar                                                             |
| `FEMHO_UPDATE_CHECK`       | `true`                    | Preguntar a GitHub si hay una versión más nueva                                                   |
| `FEMHO_SECRET`             | se genera                 | La pimienta de todos los tokens. Entra en la copia de seguridad                                   |

**[La lista entera está en `docs/DEPLOY.md`](docs/DEPLOY.md)** —con lo que cuesta cada
una— y no hay ninguna más: una comprobación permanente compara lo que lee el código con lo
que dicen los documentos y falla en las dos direcciones. Si ves una en un tutorial y no
está ahí, no existe.

## Cómo se desarrolla

```bash
npm ci
npm run build
npm test                 # unitarias, SQLite
npm run test:postgres    # las mismas, contra Postgres
npm run check            # las quince comprobaciones permanentes
npx playwright test      # navegador, contra un servidor real
npm run test:android     # Kotlin puro, sin emulador
```

### Las quince comprobaciones permanentes

No son linters de formato: cada una impide **una manera concreta de romper el producto sin
que nada falle**. Todas se autoprueban, porque una comprobación que dice «verde» sin
comprobar nada es peor que no tenerla.

|                           | Qué impide                                                         |
| ------------------------- | ------------------------------------------------------------------ |
| `openapi-diff`            | Tocar un handler sin actualizar el contrato                        |
| `vocab-lint`              | Que el vocabulario del prototipo se infiltre en el código          |
| `no-hardcoded-colors`     | Un color escrito a mano que no siga el tema ni el acento           |
| `i18n-lint`               | Texto escrito en el código en vez de en el catálogo                |
| `i18n-parity`             | Una clave o un marcador `{x}` que falte en un idioma               |
| `i18n-keys-exist`         | Una errata en `t('...')`, que compila y se enseña cruda a la cara  |
| `no-pinned-from-research` | Una versión de dependencia sin procedencia registrada              |
| `no-ignored-sources`      | Código que `.gitignore` se traga y que quien clone no tendrá       |
| `env-documented`          | Una opción documentada que el código no lee, o al revés            |
| `scope-predicate`         | Una segunda copia de «quién pertenece a un ámbito», que divergiría |
| `contrast-check`          | Contraste por debajo de AA en los ocho temas                       |
| `audit-coverage`          | Un camino de escritura que no deje rastro en el historial          |
| `parser-parity`           | Que el parser de la web y el de Android divergan                   |
| `tokens-parity`           | Que los colores de Compose se atrasen respecto del CSS             |
| `css-classes`             | Una clase que no existe — se ve sin estilo y nada falla            |

## Cómo está hecho

Monorepo con npm workspaces:

```
apps/server      Fastify (/api/v1) · node:http (CalDAV) · MCP · SSE · trabajos programados
apps/web         React + Vite, PWA con cola de salida
apps/android     Kotlin + Compose, Room y UnifiedPush
packages/contracts       openapi.yaml, catálogos de idioma, parser e índice fraccional
packages/design-system   Plou vendorizado + los componentes de Fem-ho
tools/checks     las quince comprobaciones
docs/            quince documentos normativos
```

**Lo que tienen que compartir la web y Android vive en `packages/contracts`** y se compara
con fixtures: el índice fraccional, el parser de añadido rápido, los catálogos y el primer
día de la semana. Si cada uno lo calculara por su cuenta divergirían un día, y ninguno de
los dos daría ningún error.

El estado honesto del producto —qué está probado, qué necesita un dispositivo y qué aún no
está— está en [`docs/ESTAT.md`](docs/ESTAT.md) (en catalán).

## Licencia

**GNU AGPL-3.0-or-later.** Ver [`LICENSE`](LICENSE).

Quiere decir que lo puedes usar, estudiar, modificar y redistribuir, con dos condiciones:

- **Cita el origen.** Los avisos de copyright y de licencia se mantienen, y los cambios se
  marcan como cambios.
- **Lo que salga tiene que ser igual de abierto.** Un derivado se distribuye bajo la misma
  licencia, no bajo una más cerrada.

Y una tercera, que es la razón de elegir la **A**GPL y no la GPL a secas: Fem-ho está hecho
para **servirse por red**. Si publicas una versión modificada y la gente accede a ella por
la red, les tienes que ofrecer el código de esa versión, aunque no les entregues ninguna
copia. Sin eso, cualquiera podría ofrecerlo como servicio de pago sin devolver nunca nada,
que es exactamente lo que «igual de abierto» quiere evitar.

Lo que **no** cubre: el design system **Plou** (`packages/design-system/plou/`) viene de un
proyecto aparte y lleva sus propias condiciones, y la tipografía Roboto es de Google bajo
Apache 2.0. Todo ello, en [`NOTICE`](NOTICE).

> Si algún día quieres publicar el APK en Google Play, vale la pena mirárselo: las
> condiciones de Play han tenido fricciones conocidas con las licencias de la familia GPL.
> F-Droid no tiene ninguna.
