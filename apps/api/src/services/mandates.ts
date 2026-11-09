import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Mandate, MandateFields } from '@intentlock/shared';
import { parseMoneyDecimal } from '../core/money';
import { AppError, notFound, stateConflict } from '../errors';
import type { IntentParser } from '../adapters/intentParser/types';
import type { Db } from '../repo/db';
import { mandates, purchases } from '../repo/schema';
import { canTransitionMandate, transitionMandate } from '../core/stateMachine';
import { appendAudit, lockSession } from '../repo/audit';

export class MandateService {
  constructor(
    private readonly d: {
      db: Db;
      parser: IntentParser;
      now?: () => Date;
    },
  ) {}

  async create(sessionId: string, requestText: string): Promise<Mandate> {
    const text = requestText.trim();
    if (
      text.length < 2 ||
      text.length > 1000 ||
      [...text].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
      })
    ) {
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'Request text must be 2–1000 printable characters.',
      );
    }
    const parsed = await this.d.parser.parse(text);
    const complete =
      parsed.productQuery !== undefined &&
      parsed.quantity !== undefined &&
      parsed.maxTotal !== undefined &&
      parsed.currency === 'USD' &&
      (parsed.allowedMerchantDomains?.length ?? 0) > 0;
    const row = await this.d.db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const [row] = await tx
        .insert(mandates)
        .values({
          id: randomUUID(),
          sessionId,
          version: 1,
          status: complete ? 'DRAFT' : 'NEEDS_CLARIFICATION',
          requestText: text,
          productQuery: parsed.productQuery,
          quantity: parsed.quantity,
          maxTotalMinor: parsed.maxTotal ? parseMoneyDecimal(parsed.maxTotal) : null,
          currency: parsed.currency,
          allowedMerchantDomains: parsed.allowedMerchantDomains ?? [],
          recurringAllowed: parsed.recurringAllowed,
          excludedTerms: parsed.excludedTerms,
          clarificationQuestions: parsed.clarificationQuestions,
          parser: parsed.parser,
        })
        .returning();
      if (!row) throw new Error('mandate insert returned no row');
      await appendAudit(tx, {
        sessionId,
        mandateId: row.id,
        type: 'MANDATE_DRAFTED',
        payload: {
          parser: row.parser,
          fields: toMandate(row),
          clarificationQuestions: row.clarificationQuestions,
        },
      });
      return row;
    });
    return toMandate(row);
  }

  async get(sessionId: string, id: string): Promise<Mandate> {
    const [row] = await this.d.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.sessionId, sessionId), eq(mandates.id, id)));
    if (!row) throw notFound();
    return toMandate(row);
  }

  async confirm(sessionId: string, id: string, fields: MandateFields): Promise<Mandate> {
    const { db } = this.d;
    const [current] = await db
      .select()
      .from(mandates)
      .where(and(eq(mandates.sessionId, sessionId), eq(mandates.id, id)));
    if (!current) throw notFound();

    const maxTotalMinor = parseMoneyDecimal(fields.maxTotal);
    if (maxTotalMinor === null || maxTotalMinor <= 0n) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Maximum total must be a positive USD amount.');
    }
    const values = {
      productQuery: fields.productQuery,
      quantity: fields.quantity,
      maxTotalMinor,
      currency: fields.currency,
      allowedMerchantDomains: fields.allowedMerchantDomains,
      recurringAllowed: fields.recurringAllowed,
      excludedTerms: fields.excludedTerms,
      clarificationQuestions: [],
      confirmedAt: (this.d.now ?? (() => new Date()))(),
    };

    if (current.status === 'CONFIRMED') {
      if (sameFields(current, fields)) return toMandate(current);
      if (!canTransitionMandate('CONFIRMED', 'SUPERSEDED')) {
        throw stateConflict('Confirmed mandate cannot be edited.');
      }
      const newId = randomUUID();
      const version = current.version + 1;
      const updated = await db.transaction(async (tx) => {
        await lockSession(tx, sessionId);
        const [superseded] = await tx
          .update(mandates)
          .set({ status: transitionMandate(current.status, 'SUPERSEDED') })
          .where(
            and(
              eq(mandates.id, current.id),
              eq(mandates.sessionId, sessionId),
              eq(mandates.version, current.version),
              eq(mandates.status, 'CONFIRMED'),
            ),
          )
          .returning();
        if (!superseded) throw stateConflict('Mandate changed while editing.');
        const [created] = await tx
          .insert(mandates)
          .values({
            id: newId,
            sessionId,
            version,
            supersedesId: current.id,
            status: 'CONFIRMED',
            requestText: current.requestText,
            parser: current.parser,
            ...values,
          })
          .returning();
        if (!created) throw new Error('mandate version insert returned no row');
        const cancelled = await tx
          .update(purchases)
          .set({ state: 'CANCELLED', version: sql`${purchases.version} + 1` })
          .where(
            and(
              eq(purchases.mandateId, current.id),
              inArray(purchases.state, ['PENDING_APPROVAL', 'APPROVED']),
            ),
          )
          .returning();
        for (const purchase of cancelled) {
          await appendAudit(tx, {
            sessionId,
            mandateId: current.id,
            purchaseId: purchase.id,
            type: 'PURCHASE_CANCELLED',
            payload: { reason: 'MANDATE_SUPERSEDED' },
          });
        }
        await appendAudit(tx, {
          sessionId,
          mandateId: created.id,
          type: 'MANDATE_CONFIRMED',
          payload: { fields: toMandate(created), version: created.version },
        });
        return created;
      });
      return toMandate(updated);
    }

    if (!['DRAFT', 'NEEDS_CLARIFICATION'].includes(current.status)) {
      throw stateConflict('Mandate cannot be confirmed in its current state.');
    }
    const row = await db.transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const [row] = await tx
        .update(mandates)
        .set({
          ...values,
          status: 'CONFIRMED',
        })
        .where(
          and(
            eq(mandates.id, current.id),
            eq(mandates.sessionId, sessionId),
            eq(mandates.version, current.version),
            inArray(mandates.status, ['DRAFT', 'NEEDS_CLARIFICATION']),
          ),
        )
        .returning();
      if (!row) throw stateConflict('Mandate changed while confirming.');
      await appendAudit(tx, {
        sessionId,
        mandateId: row.id,
        type: 'MANDATE_CONFIRMED',
        payload: { fields: toMandate(row), version: row.version },
      });
      return row;
    });
    return toMandate(row);
  }

  async latest(sessionId: string, mandateId: string) {
    const [row] = await this.d.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.sessionId, sessionId), eq(mandates.id, mandateId)))
      .orderBy(desc(mandates.version));
    if (!row) throw notFound();
    return row;
  }
}

export function toMandate(row: typeof mandates.$inferSelect): Mandate {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    requestText: row.requestText,
    productQuery: row.productQuery ?? undefined,
    quantity: row.quantity ?? undefined,
    maxTotal:
      row.maxTotalMinor === null
        ? undefined
        : `${row.maxTotalMinor / 100n}.${(row.maxTotalMinor % 100n).toString().padStart(2, '0')}`,
    currency: row.currency === 'USD' ? 'USD' : undefined,
    allowedMerchantDomains: row.allowedMerchantDomains,
    recurringAllowed: row.recurringAllowed,
    excludedTerms: row.excludedTerms,
    clarificationQuestions: row.clarificationQuestions,
    parser: row.parser,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString(),
  };
}

function sameFields(row: typeof mandates.$inferSelect, fields: MandateFields): boolean {
  return (
    row.productQuery === fields.productQuery &&
    row.quantity === fields.quantity &&
    row.maxTotalMinor === parseMoneyDecimal(fields.maxTotal) &&
    row.currency === fields.currency &&
    JSON.stringify(row.allowedMerchantDomains) === JSON.stringify(fields.allowedMerchantDomains) &&
    row.recurringAllowed === fields.recurringAllowed &&
    JSON.stringify(row.excludedTerms) === JSON.stringify(fields.excludedTerms)
  );
}
