import type { DraftMandate } from '@intentlock/shared';
import type { CheckStatus } from '@intentlock/shared';

export type ParsedDraft = DraftMandate & { parser: string };

export interface IntentParser {
  parse(requestText: string): Promise<ParsedDraft>;
  status(): CheckStatus;
}
