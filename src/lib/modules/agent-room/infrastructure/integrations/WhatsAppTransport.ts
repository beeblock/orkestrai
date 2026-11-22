import type { WASocket } from '@whiskeysockets/baileys';

/** Operations the channel needs; both transports retain identical routing/gates. */
export type WhatsAppTransport = Pick<WASocket, 'user' | 'end' | 'sendMessage' | 'groupFetchAllParticipating'> & {
  ev: Pick<WASocket['ev'], 'on'>;
};
