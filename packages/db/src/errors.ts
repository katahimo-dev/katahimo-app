import { conflict, DomainError } from '@katahimo/core/domain';

/** postgres.js のエラー(drizzle は cause に包む)から SQLSTATE と制約名を取り出す。 */
export function pgErrorOf(error: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        ...(typeof candidate.constraint_name === 'string' ? { constraint: candidate.constraint_name } : {}),
      };
    }
    current = candidate.cause;
  }
  return null;
}

export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
export const EXCLUSION_VIOLATION = '23P01';
/** lock_timeout を超えてロックを待った(lock_not_available)。 */
export const LOCK_NOT_AVAILABLE = '55P03';

/**
 * DB の制約・トリガーの拒否を、利用者に見せてよいエラー(DomainError)にする。対象外のエラーはそのまま返す
 * (API は 500 internal にする)。制約はアプリの検証が漏れた場合の最後の守りで、ここの文言が画面に出る。
 */
export function mapDatabaseError(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  const pg = pgErrorOf(error);
  if (!pg) return error;
  switch (pg.code) {
    case 'KH001':
      return new DomainError(
        'locked',
        'この月の勤怠は締め済みのため変更できません。',
        undefined,
        'period_locked',
      );
    case 'KH002':
      return new DomainError('locked', '確定済みの記録は変更できません。', undefined, 'record_locked');
    case EXCLUSION_VIOLATION:
      return conflict('期間が他の登録と重なっています。', undefined, pg.constraint);
    case UNIQUE_VIOLATION:
      if (pg.constraint === 'staff_login_emails_pkey') {
        return conflict('このメールアドレスは他のスタッフが使用しています', undefined, pg.constraint);
      }
      if (pg.constraint && /^report_[a-z_]+_tenant_id_[a-z_]+_key$/.test(pg.constraint)) {
        // 日報AIのマスターの自然キー(アーカイブした行も含む)。アプリの確かめの後に同時に保存された場合等
        return conflict(
          '同じキーの行が既にあります(アーカイブした行も含みます)。画面を開きなおしてください。',
          undefined,
          'duplicate_key',
        );
      }
      if (pg.constraint?.startsWith('ai_prompts_') || pg.constraint?.startsWith('ai_prompt_revisions_')) {
        return conflict(
          '他の管理者が同時にプロンプトを保存しました。画面を開きなおしてから保存してください。',
          undefined,
          pg.constraint,
        );
      }
      return error;
    default:
      return error;
  }
}
