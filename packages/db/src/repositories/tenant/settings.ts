import {
  CUSTOMER_IMPORT_BUSY_MESSAGE,
  CUSTOMER_IMPORT_BUSY_REASON,
  conflict,
  type ImportSource,
  isOutboxTopicEnabled,
  newId,
  type OutboxTopic,
  type OutboxTopicPolicy,
  STALE_PROMPT_MESSAGE,
  type TenantSecretName,
} from '@katahimo/core/domain';
import type {
  AiPromptKindValue,
  AiPromptRecord,
  AiPromptRepository,
  EntityChangeInput,
  EntityChangeWriter,
  ImportRunRecord,
  ImportRunRepository,
  OutboxMessageInput,
  OutboxWriter,
  TenantSecretRecord,
  TenantSecretRepository,
  TenantSettingsRecord,
  TenantSettingsRepository,
} from '@katahimo/core/ports';
import { and, asc, desc, eq, max, ne, type SQL, sql } from 'drizzle-orm';
import { LOCK_NOT_AVAILABLE, pgErrorOf } from '../../errors';
import {
  aiPromptRevisions,
  aiPrompts,
  entityChanges,
  importRuns,
  outboxMessages,
  tenantSecrets,
  tenantSettings,
} from '../../schema';
import { TenantBound } from './base';

export class DrizzleTenantSettingsRepository extends TenantBound implements TenantSettingsRepository {
  async get(): Promise<TenantSettingsRecord> {
    const [row] = await this.tx
      .select({
        careRecordRetentionDays: tenantSettings.careRecordRetentionDays,
        customerDataVersion: tenantSettings.customerDataVersion,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, this.tenantId));
    if (!row)
      throw new Error(
        `テナントの設定がありません(tenantId=${this.tenantId})。provision_tenant で作成してください`,
      );
    return row;
  }

  async bumpCustomerDataVersion(): Promise<number> {
    const [row] = await this.tx
      .update(tenantSettings)
      .set({ customerDataVersion: sql`${tenantSettings.customerDataVersion} + 1` })
      .where(eq(tenantSettings.tenantId, this.tenantId))
      .returning({ version: tenantSettings.customerDataVersion });
    return row?.version ?? 0;
  }
}

export class DrizzleTenantSecretRepository extends TenantBound implements TenantSecretRepository {
  async get(name: TenantSecretName): Promise<TenantSecretRecord | null> {
    const rows = await this.tx
      .select({
        name: tenantSecrets.name,
        sealedValue: tenantSecrets.sealedValue,
        rotatedAt: tenantSecrets.rotatedAt,
      })
      .from(tenantSecrets)
      .where(and(eq(tenantSecrets.tenantId, this.tenantId), eq(tenantSecrets.name, name)));
    return rows[0] ?? null;
  }

  async put(name: TenantSecretName, sealedValue: Uint8Array, updatedBy: string | null): Promise<void> {
    await this.tx
      .insert(tenantSecrets)
      .values({ tenantId: this.tenantId, name, sealedValue, updatedBy })
      .onConflictDoUpdate({
        target: [tenantSecrets.tenantId, tenantSecrets.name],
        set: { sealedValue, updatedBy, rotatedAt: sql`now()` },
      });
  }
}

export class DrizzleAiPromptRepository extends TenantBound implements AiPromptRepository {
  listAll(): Promise<AiPromptRecord[]> {
    return this.tx
      .select({
        key: aiPrompts.key,
        kind: aiPrompts.kind,
        body: aiPrompts.body,
        revision: aiPrompts.revision,
        updatedBy: aiPrompts.updatedBy,
        updatedAt: aiPrompts.updatedAt,
      })
      .from(aiPrompts)
      .where(eq(aiPrompts.tenantId, this.tenantId))
      .orderBy(asc(aiPrompts.key));
  }

  async findByKey(key: string): Promise<AiPromptRecord | null> {
    return (await this.listAll()).find((p) => p.key === key) ?? null;
  }

  /**
   * 次の版(消した後に保存し直しても版が続くよう、履歴の最大値から数える)。同じキーの保存が同時に来ても同じ版を
   * 数えないよう、先にキーごとのアドバイザリロック(トランザクションの終わりまで)を取る。ai_prompts の行は
   * 未保存・既定値に戻した後には無いため、行ロックでは足りない。
   */
  private async nextRevision(key: string, expectedRevision: number | undefined): Promise<number> {
    await this.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`ai_prompts/${this.tenantId}/${key}`}, 0))`,
    );
    const [row] = await this.tx
      .select({ revision: max(aiPromptRevisions.revision) })
      .from(aiPromptRevisions)
      .where(and(eq(aiPromptRevisions.tenantId, this.tenantId), eq(aiPromptRevisions.key, key)));
    const latest = row?.revision ?? 0;
    if (expectedRevision !== undefined && latest !== expectedRevision) {
      throw conflict(STALE_PROMPT_MESSAGE, undefined, 'stale_revision');
    }
    return latest + 1;
  }

  async latestRevisions(): Promise<Map<string, number>> {
    const rows = await this.tx
      .select({ key: aiPromptRevisions.key, revision: max(aiPromptRevisions.revision) })
      .from(aiPromptRevisions)
      .where(eq(aiPromptRevisions.tenantId, this.tenantId))
      .groupBy(aiPromptRevisions.key);
    return new Map(rows.map((r) => [r.key, r.revision ?? 0]));
  }

  async save({
    expectedRevision,
    ...input
  }: {
    key: string;
    kind: AiPromptKindValue;
    body: string;
    updatedBy: string;
    expectedRevision?: number | undefined;
  }): Promise<void> {
    const revision = await this.nextRevision(input.key, expectedRevision);
    await this.tx
      .insert(aiPrompts)
      .values({ tenantId: this.tenantId, ...input, revision })
      .onConflictDoUpdate({
        target: [aiPrompts.tenantId, aiPrompts.key],
        set: { body: input.body, kind: input.kind, revision, updatedBy: input.updatedBy },
      });
    await this.tx.insert(aiPromptRevisions).values({
      tenantId: this.tenantId,
      key: input.key,
      revision,
      body: input.body,
      createdBy: input.updatedBy,
    });
  }

  async reset(key: string, updatedBy: string, expectedRevision?: number): Promise<void> {
    const revision = await this.nextRevision(key, expectedRevision);
    const deleted = await this.tx
      .delete(aiPrompts)
      .where(and(eq(aiPrompts.tenantId, this.tenantId), eq(aiPrompts.key, key)))
      .returning({ key: aiPrompts.key });
    if (deleted.length === 0) return;
    await this.tx.insert(aiPromptRevisions).values({
      tenantId: this.tenantId,
      key,
      revision,
      body: null,
      createdBy: updatedBy,
    });
  }
}

export class DrizzleImportRunRepository extends TenantBound implements ImportRunRepository {
  async lockTenantCustomerImports(): Promise<void> {
    try {
      await this.tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`customer_import:${this.tenantId}`}, 0))`,
      );
    } catch (error) {
      // 他の取込が lock_timeout(API 5秒・ワーカー 10秒)より長くロックを持っている。送り直せば通るため conflict にする
      if (pgErrorOf(error)?.code === LOCK_NOT_AVAILABLE) {
        throw conflict(CUSTOMER_IMPORT_BUSY_MESSAGE, undefined, CUSTOMER_IMPORT_BUSY_REASON);
      }
      throw error;
    }
  }

  async start(input: {
    id: string;
    source: ImportSource;
    fileName: string | null;
    fileVersion: string | null;
    triggeredBy: string | null;
  }): Promise<void> {
    await this.tx.insert(importRuns).values({ tenantId: this.tenantId, ...input });
  }

  async finish(
    id: string,
    result: {
      status: 'applied' | 'review_required' | 'failed' | 'skipped';
      counts: Record<string, number>;
      message: string | null;
    },
  ): Promise<void> {
    await this.tx
      .update(importRuns)
      .set({ ...result, finishedAt: sql`now()` })
      .where(and(eq(importRuns.tenantId, this.tenantId), eq(importRuns.id, id)));
  }

  async latestApplied(source: ImportSource): Promise<ImportRunRecord | null> {
    return this.latestWhere(source, eq(importRuns.status, 'applied'));
  }

  async latestFinished(source: ImportSource): Promise<ImportRunRecord | null> {
    return this.latestWhere(source, ne(importRuns.status, 'running'));
  }

  private async latestWhere(source: ImportSource, condition: SQL): Promise<ImportRunRecord | null> {
    const rows = await this.tx
      .select({
        id: importRuns.id,
        source: importRuns.source,
        fileName: importRuns.fileName,
        fileVersion: importRuns.fileVersion,
        status: importRuns.status,
        counts: importRuns.counts,
        startedAt: importRuns.startedAt,
        finishedAt: importRuns.finishedAt,
      })
      .from(importRuns)
      .where(and(eq(importRuns.tenantId, this.tenantId), eq(importRuns.source, source), condition))
      .orderBy(desc(importRuns.startedAt))
      .limit(1);
    return rows[0] ?? null;
  }
}

/**
 * outbox への積み込み(UoW のトランザクションの中)。skipTopics(スプレッドシートへのミラーを無効にした環境の
 * ミラーのトピック)は積まない。同じ dedupe_key は何もしない。
 */
export class DrizzleOutboxWriter extends TenantBound implements OutboxWriter {
  constructor(
    tx: ConstructorParameters<typeof TenantBound>[0],
    tenantId: string,
    /** 積むトピックの規則(null なら全て積む)。 */
    private readonly policy: OutboxTopicPolicy | null,
    private readonly tenantSlug: () => Promise<string>,
  ) {
    super(tx, tenantId);
  }

  async enqueue(message: OutboxMessageInput): Promise<boolean> {
    if (this.policy && !(await isOutboxTopicEnabled(this.policy, message.topic, this.tenantSlug)))
      return false;
    const inserted = await this.tx
      .insert(outboxMessages)
      .values({
        tenantId: this.tenantId,
        // UUIDv7(積んだ順に並ぶ。latestPayload が最後に積んだものを選ぶのに使う)
        id: newId(),
        topic: message.topic,
        aggregateType: message.aggregateType,
        aggregateId: message.aggregateId,
        dedupeKey: message.dedupeKey,
        payload: message.payload ?? {},
      })
      .onConflictDoNothing({ target: [outboxMessages.tenantId, outboxMessages.dedupeKey] })
      .returning({ id: outboxMessages.id });
    return inserted.length > 0;
  }

  async latestPayload(topic: OutboxTopic, aggregateId: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.tx
      .select({ payload: outboxMessages.payload })
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.tenantId, this.tenantId),
          eq(outboxMessages.aggregateId, aggregateId),
          eq(outboxMessages.topic, topic),
        ),
      )
      .orderBy(desc(outboxMessages.id))
      .limit(1);
    return row?.payload ?? null;
  }
}

export class DrizzleEntityChangeWriter extends TenantBound implements EntityChangeWriter {
  async append(change: EntityChangeInput): Promise<void> {
    await this.tx.insert(entityChanges).values({ tenantId: this.tenantId, ...change });
  }
}
