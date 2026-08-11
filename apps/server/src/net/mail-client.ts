/**
 * El que la ingesta necessita d'un servidor IMAP, i **res més**.
 *
 * PER QUÈ HI HA UNA INTERFÍCIE AL MIG
 * -----------------------------------
 * Dues raons, i totes dues es paguen soles:
 *
 * 1. **`imapflow` només toca dos fitxers.** Són dues dependències del mateix proveïdor
 *    (`imapflow` i `mailparser`, totes dues de Zone.eu), i això és còmode i també vol dir
 *    que una mala setmana d'un mantenidor són dues dependències teves. Amb la interfície,
 *    canviar-les costa un fitxer i no la meitat del servidor.
 * 2. **El cicle es pot provar sense xarxa.** Una prova contra `fetch` mocat prova el mock;
 *    una prova contra un `MailClient` fals prova el cicle. I el que ha de ser cert —que la
 *    primera lectura d'una carpeta gran no ingereixi res, que la segona passada no faci
 *    res, que un missatge de 30 MB se salti de manera visible— no necessita cap servidor.
 *
 * LA FORMA DE LA INTERFÍCIE ÉS LA DEFENSA CONTRA LA MEMÒRIA
 * ---------------------------------------------------------
 * El que tothom escriu primer és `simpleParser(await client.download(uid))`, i amb 20 MB
 * d'adjunts són tres còpies a memòria. En un ordinador de casa l'OOM s'endú l'API, el
 * CalDAV i el planificador amb ell.
 *
 * Per això `fetchHeaders` **no baixa el cos**: torna sobre, mida i estructura, i amb això
 * ja es decideix si val la pena baixar res. El cos es demana a part i **d'un missatge cada
 * cop**. La porta de mida es tanca abans de demanar-lo, no després.
 */

/** Un missatge, tal com el veu la ingesta abans de baixar-ne res. */
export interface MailHeader {
  uid: string;
  /** El `Message-ID` cru, tal com ve. Normalitzar-lo és feina d'`identity.ts`. */
  messageId: string | null;
  inReplyTo: string | null;
  /** Els `References`, en ordre. El primer és l'arrel de la conversa. */
  references: string[];
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  toAddresses: string[];
  /** La posa el servidor que el va rebre. No la pot falsejar el remitent. */
  internalDate: string | null;
  /** La posa el remitent i **pot mentir**. Es desa, però no ordena res. */
  sentAt: string | null;
  /** Bytes. **La porta que evita baixar 30 MB per res.** */
  size: number;
  hasHtml: boolean;
}

/** L'estat d'una carpeta en obrir-la. */
export interface MailboxStatus {
  /**
   * Canvia quan el servidor reindexa, i llavors **tots els UID que teníem no valen**.
   * És el senyal de rescanejar; els duplicats els atura la clau única del `Message-ID`.
   */
  uidValidity: string;
  /** L'UID que rebrà el pròxim missatge. El cursor inicial n'és aquest menys u. */
  uidNext: string;
  exists: number;
}

export interface MailFolder {
  path: string;
  delimiter: string;
}

export interface MailClient {
  /** Les carpetes, per poder-les triar sense escriure-les a mà. */
  listFolders: () => Promise<MailFolder[]>;
  /** Obre una carpeta **en només lectura**: res del que fem marca cap correu. */
  openFolder: (path: string) => Promise<MailboxStatus>;
  /**
   * Els sobres dels missatges amb UID **més gran** que el cursor.
   *
   * Sense cos. Amb `limit`, perquè una carpeta que ha crescut molt entre dues lectures no
   * es pugui menjar un tic sencer.
   */
  fetchHeaders: (path: string, sinceUid: string, limit: number) => Promise<MailHeader[]>;
  /**
   * El cos d'un missatge, **d'un en un**.
   *
   * Torna el text pla si n'hi ha, l'HTML si no, i els adjunts com a metadades: baixar-los
   * és una altra crida i només si la regla els vol.
   */
  fetchBody: (path: string, uid: string) => Promise<MailBody>;
  close: () => Promise<void>;
}

export interface MailBody {
  text: string | null;
  html: string | null;
  attachments: MailAttachmentMeta[];
}

export interface MailAttachmentMeta {
  filename: string | null;
  /** El que **declara** el correu. Els bytes manen; això és una pista. */
  contentType: string | null;
  size: number;
  /**
   * Una imatge referenciada des del cos amb `cid:`. **Se salten**: si no, cada signatura
   * corporativa deixa un logotip adjunt a una tasca.
   */
  inline: boolean;
  /** Com demanar-ne els bytes, quan i si es volen. */
  part: string;
}
