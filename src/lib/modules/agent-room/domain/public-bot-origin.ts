/** Issued from persisted channel metadata, never parsed from a customer's text. */
export type PublicBotOrigin = {
  type: 'external';
  bindingId: string | null;
  channelMessageId: string | null;
};
