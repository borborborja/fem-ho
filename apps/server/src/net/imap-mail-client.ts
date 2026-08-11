/**
 * `MailClient` sobre `imapflow`. **L'únic fitxer que llegeix correu de debò.**
 *
 * Tot el que el cicle sap d'IMAP passa per aquí. Si algun dia `imapflow` deixa d'anar —són
 * dues dependències del mateix proveïdor, i això és còmode i també vol dir que una mala
 * setmana d'un mantenidor són dues dependències teves—, el canvi costa aquest fitxer.
 *
 * **RES MARCA CAP CORREU COM A LLEGIT**
 * -------------------------------------
 * `mailboxOpen(..., { readOnly: true })`, que en IMAP és `EXAMINE` i no `SELECT`: el
 * servidor **no pot** posar `\Seen` encara que alguna cosa ho demanés. No és una promesa
 * del nostre codi, és una propietat del protocol, que és molt millor.
 *
 * **NO ES BAIXA EL QUE NO CAL**
 * -----------------------------
 * `fetchHeaders` demana sobre, mida i estructura, i **cap byte de cos**. El cos es demana
 * a part i d'un missatge cada cop, després que la porta de mida hagi dit que sí. El que
 * tothom escriu primer —baixar-ho tot i analitzar-ho— són tres còpies de 20 MB a memòria,
 * i en un ordinador de casa l'OOM s'endú l'API i el planificador amb ell.
 */

import { ImapFlow, type MessageStructureObject } from 'imapflow';
import { imapOptions, resolveImapHost, type ImapConnectOptions } from './imap-connect.js';
import type {
  MailAttachmentMeta,
  MailBody,
  MailClient,
  MailFolder,
  MailHeader,
  MailboxStatus,
} from './mail-client.js';

export interface ImapAccount {
  host: string;
  port: number;
  security: string;
  username: string;
  /** Ja oberta per qui té el secret de la instància. No es desxifra res aquí. */
  password: string;
}

const DEFAULT_TIMEOUT = 30_000;

/** Recorre l'arbre de parts i en treu el text, l'HTML i els adjunts. */
function walk(
  node: MessageStructureObject | undefined,
  found: { text: string | null; html: string | null; attachments: MailAttachmentMeta[] },
): void {
  if (node === undefined) return;

  if (node.childNodes !== undefined && node.childNodes.length > 0) {
    for (const child of node.childNodes) walk(child, found);
    return;
  }

  const type = (node.type ?? '').toLowerCase();
  const disposition = (node.disposition ?? '').toLowerCase();
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? null;

  if (disposition !== 'attachment' && type === 'text/plain' && found.text === null) {
    found.text = node.part ?? '1';
    return;
  }
  if (disposition !== 'attachment' && type === 'text/html' && found.html === null) {
    found.html = node.part ?? '1';
    return;
  }
  if (node.part === undefined) return;

  found.attachments.push({
    filename,
    contentType: node.type ?? null,
    size: node.size ?? 0,
    /**
     * `inline` **amb `Content-ID`**, no només per la disposició: el que s'ha de saltar és
     * la imatge referenciada des del cos, i si es mirés només `disposition: inline` es
     * perdrien adjunts de veritat que arriben mal etiquetats.
     */
    inline: disposition === 'inline' && node.id !== undefined,
    part: node.part,
  });
}

export async function openImapClient(
  account: ImapAccount,
  options: ImapConnectOptions = {},
): Promise<MailClient> {
  const security = account.security === 'starttls' ? 'starttls' : 'tls';
  const address = await resolveImapHost(account.host, account.port, options);
  const client = new ImapFlow(
    imapOptions(
      { ...account, security, port: account.port },
      address,
      options.timeoutMs ?? DEFAULT_TIMEOUT,
    ),
  );
  await client.connect();

  const llegirPart = async (uid: string, part: string): Promise<string | null> => {
    const { content } = await client.download(uid, part, { uid: true });
    if (content === undefined) return null;
    const trossos: Buffer[] = [];
    for await (const tros of content) trossos.push(Buffer.from(tros as Buffer));
    return Buffer.concat(trossos).toString('utf8');
  };

  return {
    listFolders: async (): Promise<MailFolder[]> =>
      (await client.list()).map((box) => ({ path: box.path, delimiter: box.delimiter })),

    openFolder: async (path: string): Promise<MailboxStatus> => {
      // `readOnly` és `EXAMINE`: el servidor no pot marcar res encara que ho demanéssim.
      const box = await client.mailboxOpen(path, { readOnly: true });
      return {
        uidValidity: box.uidValidity.toString(),
        uidNext: String(box.uidNext),
        exists: box.exists,
      };
    },

    fetchHeaders: async (path: string, sinceUid: string, limit: number): Promise<MailHeader[]> => {
      await client.mailboxOpen(path, { readOnly: true });

      const desde = Number(sinceUid) + 1;
      const messages = await client.fetchAll(
        `${String(desde)}:*`,
        // Sobre, mida i estructura. **Cap byte de cos.**
        { uid: true, envelope: true, size: true, bodyStructure: true, headers: ['references'] },
        { uid: true },
      );

      return messages
        .filter((message) => message.uid >= desde)
        .slice(0, limit)
        .map((message) => {
          const envelope = message.envelope;
          const from = envelope?.from?.[0];
          const parts = { text: null, html: null, attachments: [] as MailAttachmentMeta[] };
          walk(message.bodyStructure, parts);

          /**
           * Els `References` **no són a l'`ENVELOPE` d'IMAP**: el protocol no els hi posa.
           * Per això es demanen com a capçalera i es parteixen aquí. Sense això, un fil
           * només es podria lligar pel pare immediat, i una branca que arriba abans que el
           * seu pare quedaria orfe per sempre.
           */
          const raw = message.headers?.toString('utf8') ?? '';
          const references = (/^references:\s*(.*)$/imu.exec(raw.replace(/\r?\n[ \t]/gu, ' '))?.[1] ?? '')
            .split(/\s+/u)
            .map((r) => r.trim())
            .filter((r) => r !== '');

          const internal = message.internalDate;
          return {
            uid: String(message.uid),
            messageId: envelope?.messageId ?? null,
            inReplyTo: envelope?.inReplyTo ?? null,
            references,
            subject: envelope?.subject ?? null,
            fromName: from?.name ?? null,
            fromAddress: from?.address ?? null,
            toAddresses: (envelope?.to ?? []).map((to) => to.address ?? '').filter((a) => a !== ''),
            internalDate:
              internal === undefined
                ? null
                : internal instanceof Date
                  ? internal.toISOString()
                  : new Date(internal).toISOString(),
            sentAt: envelope?.date === undefined ? null : envelope.date.toISOString(),
            size: message.size ?? 0,
            hasHtml: parts.html !== null,
          };
        });
    },

    fetchBody: async (path: string, uid: string): Promise<MailBody> => {
      await client.mailboxOpen(path, { readOnly: true });
      const message = await client.fetchOne(uid, { uid: true, bodyStructure: true }, { uid: true });
      if (message === false) return { text: null, html: null, attachments: [] };

      const parts = { text: null, html: null, attachments: [] as MailAttachmentMeta[] };
      walk(message.bodyStructure, parts);

      // **Es prefereix sempre el text pla.** L'HTML només si no n'hi ha, i llavors
      // `htmlToText` el converteix: cap marcatge d'un desconegut es desa mai.
      const text = parts.text === null ? null : await llegirPart(uid, parts.text);
      const html = text !== null || parts.html === null ? null : await llegirPart(uid, parts.html);

      return {
        text,
        html,
        // Les imatges en línia se salten, o cada signatura corporativa deixa un logotip.
        attachments: parts.attachments.filter((a) => !a.inline),
      };
    },

    close: async (): Promise<void> => {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
  };
}
