/**
 * Les **16 tools** d'MCP (docs/08 §3).
 *
 * **Sense prefix, verb primer** (D6): els clients ja fan namespace pel seu compte —a
 * Claude una tool acaba sent `mcp__femho__list_tasks`— i posar-hi un `femho_` a sobre
 * malgasta tokens a cada nom, a cada crida i a cada finestra de context.
 *
 * **Setze i no més.** Una definició de tool ocupa entre 100 i 500 tokens; amb catàlegs
 * de 40, una part gran de la finestra de context se'n va en metadades abans de començar.
 *
 * **Cap tool d'esborrar.** Un agent no esborra res: com a molt marca i comenta.
 *
 * Les anotacions no són decoració: són el que permet que un client aprovi sol les de
 * lectura i sempre demani confirmació per a la resta.
 */

import { z } from 'zod';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
}

/** Les de lectura: aprovables soles pel client. */
const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
/** Les que creen: no destructives, però **no** idempotents. */
const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};
/** Les que modifiquen: repetir-les dona el mateix resultat. */
const MODIFY: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

const scopeId = z.string().describe("Identificador d'àmbit. UUID nu, sense prefix.");
const taskId = z.string().describe('Identificador de tasca. UUID nu, sense prefix.');

/**
 * El catàleg, **ordenat alfabèticament**.
 *
 * Els clients cacheguen la llista de tools, i un ordre estable millora els encerts de la
 * memòria cau de prompts. No és una manida: reordenar-la invalida la memòria cau de tots
 * els clients connectats.
 */
export const TOOLS: ToolSpec[] = [
  {
    name: 'add_comment',
    title: 'Comentar una tasca',
    description:
      'Afegeix un comentari a una tasca. **És la via principal perquè un agent reporti** el que ha fet o el que li falta per poder continuar.',
    inputSchema: { task_id: taskId, body: z.string().describe('El text del comentari.') },
    annotations: CREATE,
  },
  {
    name: 'complete_task',
    title: 'Completar una tasca',
    description:
      'Marca una tasca com a feta. Aplica la cascada amunt i genera la instància següent si es repeteix.',
    inputSchema: { task_id: taskId },
    annotations: MODIFY,
  },
  {
    name: 'create_task',
    title: 'Crear una tasca',
    description:
      "Crea una tasca. Sempre ha de tenir àmbit; pot no tenir projecte. Respecta `can_create_tasks` de l'agent.",
    inputSchema: {
      scope_id: scopeId,
      title: z.string().describe('El títol, ja net de sigils.'),
      project_id: z.string().optional(),
      description: z.string().optional(),
      due_date: z.string().optional().describe('Data en format ISO, sense hora.'),
    },
    annotations: CREATE,
  },
  {
    name: 'get_briefing',
    title: 'Resum per a agents',
    description:
      'Àmbits amb les seves instruccions, projectes, què hi ha pendent i què està delegat. **Estalvia sis crides**: és la segona que hauria de cridar un agent, després de `whoami`.',
    inputSchema: { scope_id: z.string().optional() },
    annotations: READ,
  },
  {
    name: 'get_task',
    title: 'Una tasca sencera',
    description: 'Una tasca amb subtasques, llistes, comentaris, adjunts i historial.',
    inputSchema: { task_id: taskId },
    annotations: READ,
  },
  {
    name: 'list_events',
    title: 'Esdeveniments en una finestra',
    description:
      "Esdeveniments entre dues dates. **`from` i `to` són obligatoris**: sense finestra, un calendari amb repeticions no té un nombre finit d'esdeveniments.",
    inputSchema: {
      from: z.string().describe('Inici de la finestra, ISO.'),
      to: z.string().describe('Final de la finestra, ISO.'),
      scope_id: z.string().optional(),
    },
    annotations: READ,
  },
  {
    name: 'list_projects',
    title: 'Projectes',
    description: 'Projectes, filtrables per àmbit.',
    inputSchema: { scope_id: z.string().optional() },
    annotations: READ,
  },
  {
    name: 'list_scopes',
    title: 'Àmbits',
    description:
      'Àmbits accessibles, amb la descripció i les instruccions per a la IA de cadascun.',
    inputSchema: {},
    annotations: READ,
  },
  {
    name: 'list_tasks',
    title: 'Tasques',
    description: 'Tasques amb filtres i paginació.',
    inputSchema: {
      scope_id: z.string().optional(),
      project_id: z.string().optional(),
      status: z.enum(['inbox', 'todo', 'doing', 'done']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    annotations: READ,
  },
  {
    name: 'move_task',
    title: 'Moure una tasca',
    description: "Canvia la columna i la posició d'una tasca.",
    inputSchema: {
      task_id: taskId,
      status: z.enum(['inbox', 'todo', 'doing', 'done']),
      position: z.string().optional().describe("L'índex fraccional. Si no es dona, va al final."),
    },
    annotations: MODIFY,
  },
  {
    name: 'next_task',
    title: 'La següent tasca delegada',
    description:
      'Retorna la següent tasca delegada disponible **i la reserva** durant 30 minuts. És el que evita que dos agents facin la mateixa feina. Crida `release_task` si no la pots fer.',
    inputSchema: { scope_id: z.string().optional() },
    // **No idempotent**: cada crida reserva una tasca diferent.
    annotations: CREATE,
  },
  {
    name: 'release_task',
    title: 'Alliberar una reserva',
    description: "Allibera la reserva d'una tasca, amb un motiu que queda a l'historial.",
    inputSchema: { task_id: taskId, reason: z.string().describe('Per què no la pots fer.') },
    annotations: MODIFY,
  },
  {
    name: 'search_tasks',
    title: 'Cercar tasques',
    description: 'Cerca de text sobre títols i descripcions.',
    inputSchema: { query: z.string(), scope_id: z.string().optional() },
    annotations: READ,
  },
  {
    name: 'update_checklist_item',
    title: "Marcar un ítem d'una llista",
    description:
      "Marca o desmarca un ítem. Si és l'últim que faltava, la cascada amunt pot completar la subtasca i la tasca.",
    inputSchema: { item_id: z.string(), done: z.boolean() },
    annotations: MODIFY,
  },
  {
    name: 'update_task',
    title: 'Modificar una tasca',
    description: "Canvia camps d'una tasca. Només els que es donin.",
    inputSchema: {
      task_id: taskId,
      title: z.string().optional(),
      description: z.string().optional(),
      due_date: z.string().nullable().optional(),
    },
    annotations: MODIFY,
  },
  {
    name: 'whoami',
    title: 'Qui sóc',
    description:
      'Qui és aquest token, què pot fer i **quins àmbits veu**. La primera que hauria de cridar un agent: sense això no sap on pot escriure i acaba provant a cegues.',
    inputSchema: {},
    annotations: READ,
  },
];

/** Comprovació d'invariants del catàleg. Es crida en construir el servidor. */
export function assertCatalogue(tools: ToolSpec[] = TOOLS): void {
  if (tools.length !== 16) {
    throw new Error(
      `El catàleg ha de tenir 16 tools i en té ${String(tools.length)} (docs/08 §3).`,
    );
  }

  const names = tools.map((tool) => tool.name);
  if (names.some((name) => name.startsWith('femho_'))) {
    throw new Error('Cap tool porta prefix: els clients ja fan namespace (D6).');
  }
  if (names.some((name) => /delete|remove|destroy|esborr/iu.test(name))) {
    throw new Error("Fem-ho no exposa cap tool d'esborrar (docs/08 §3).");
  }
  if ([...names].sort().join() !== names.join()) {
    throw new Error("El catàleg ha d'anar alfabètic: els clients cacheguen la llista.");
  }
}
