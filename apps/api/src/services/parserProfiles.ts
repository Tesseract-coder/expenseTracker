import { and, desc, eq } from 'drizzle-orm';
import {
  columnMappingSchema,
  type ParserProfileDto,
  parserProfileCreateSchema,
} from '@kharcha/shared';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { runBatch } from '../db/batch';
import { accounts, parserProfiles } from '../db/schema';
import { newId } from '../lib/ids';
import { getAccount } from './accounts';

export async function listParserProfiles(db: Db, userId: string): Promise<ParserProfileDto[]> {
  const rows = await db
    .select()
    .from(parserProfiles)
    .where(eq(parserProfiles.userId, userId))
    .orderBy(desc(parserProfiles.updatedAt));
  // A stored mapping that no longer validates is skipped, never a 500 for the import screen.
  return rows.flatMap((r) => {
    let raw: unknown;
    try {
      raw = JSON.parse(r.mapping);
    } catch {
      return [];
    }
    const mapping = columnMappingSchema.safeParse(raw);
    return mapping.success ? [{ id: r.id, name: r.name, mapping: mapping.data }] : [];
  });
}

export async function createParserProfile(
  db: Db,
  userId: string,
  input: z.input<typeof parserProfileCreateSchema>,
): Promise<ParserProfileDto> {
  const data = parserProfileCreateSchema.parse(input);
  if (data.accountId) await getAccount(db, userId, data.accountId);
  const id = newId();
  await runBatch(db, [
    db
      .insert(parserProfiles)
      .values({ id, userId, name: data.name, mapping: JSON.stringify(data.mapping) }),
    ...(data.accountId
      ? [
          db
            .update(accounts)
            .set({ parserProfileId: id })
            .where(and(eq(accounts.userId, userId), eq(accounts.id, data.accountId))),
        ]
      : []),
  ]);
  return { id, name: data.name, mapping: data.mapping };
}
