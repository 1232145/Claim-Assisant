/** Recognizes natural requests for a broad list or overview of claims. */
export function isClaimOverviewMessage(message: string): boolean {
  return /\b(?:what|which)\s+(?:(?:are|is)\s+)?(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)(?:\s+(?:do\s+i\s+have|i\s+have))?\b(?!\s+about)|\b(?:what|which)\s+(?:do|can)\s+i\s+have\b|\b(?:list|show|explain)\s+(?:all\s+)?(?:the\s+)?(?:my\s+)?(?:current\s+)?(?:claims?|cases?)\b|\b(?:can\s+you\s+)?tell\s+me\s+about\s+(?:(?:all\s+(?:of\s+)?)|(?:my|the|current)\s+)*(?:claims|cases)\b|\b(?:talk\s+about|explain|summari[sz]e)\s+(?:all\s+of\s+them|every(?:thing|\s+(?:claim|case))|each\s+(?:claim|case)|all\s+(?:of\s+)?(?:them|my\s+claims?|my\s+cases?))\b/i.test(message);
}
