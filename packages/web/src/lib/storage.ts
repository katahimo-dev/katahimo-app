/**
 * ブラウザのlocalStorageに保存する値のキー一覧。
 *
 * GAS版と同じ意味の「使う人の好み」は、GAS版と同じキー名にしている(GAS版の挙動・保存値の
 * 形をそのまま引き継ぐため)。新しく値を保存するときは、ここにキーを足してから使うこと
 * (機能ごとにキー名が散らばると、衝突や消し忘れに気づけないため)。
 *
 * GAS版にあってこちらで使わないもの:
 * - `GAS_AUTH_TOKEN` / `GAS_STAFF_ADMIN`: ログインはhttpOnly Cookieになったため不要。
 *   役割は GET /api/auth/me の応答(role)で判断する(isAdminRole / canActForOthers)。
 * - `GAS_CUSTOMER_DATA_V2` / 各種2時間キャッシュ: サーバー側・TanStack Queryのキャッシュで代替する。
 */
export const STORAGE_KEYS = {
  /** 文字の大きさ('normal' | 'large' | 'xlarge')。GAS版と同じキー。 */
  textSize: 'app_text_size',
  /** 最後にログインできた法人ID。新アプリ固有(GAS版は単一法人だったため無い)。 */
  lastTenantSlug: 'katahimo_last_tenant_slug',
  /**
   * ログインしていた印。GAS版は保存済みトークンの有無で「期限切れ」と「初めて」を見分け、
   * 期限切れのときだけ「しばらく使っていなかったので…」を出していた。Cookieはスクリプトから
   * 読めないため、代わりにこの印で見分ける。値は '1'。
   */
  sessionHint: 'katahimo_session_hint',
  /** 出勤簿タブの週の表示('list' | 'grid')。GAS版と同じキー(出勤簿タブ担当が使う)。 */
  calWeekViewMode: 'cal_week_view_mode',
  /** 最近開いたお客様。GAS版と同じキー名 + 使う人(userStorageKey)。 */
  recentCustomers: 'recent_customers',
  /** 書きかけの日報の退避。GAS版と同じキー名 + 使う人(userStorageKey)。 */
  pendingReportDraft: 'pending_report_draft',
  /** 日報の開始時刻(時)の前回値。GAS版と同じキー名 + 使う人(userStorageKey)。 */
  lastStartHour: 'last_start_hour',
  /** 日報の開始時刻(分)の前回値。GAS版と同じキー名 + 使う人(userStorageKey)。 */
  lastStartMinute: 'last_start_minute',
  /** 事故報告の発生時刻の前回値。GAS版と同じキー名 + 使う人(userStorageKey)。 */
  lastAccidentTime: 'last_acc_time',
  /** 領収書の重複登録チェック用(接頭辞。後ろにスタッフ単位の識別子が付く)。GAS版と同じ。 */
  receiptLocalKeyPrefix: 'GAS_RECEIPT_KEYS_V1_',
  /**
   * 予定タブのルートつき予定の前回の結果(24時間。接頭辞。後ろに `<スタッフID>_<YYYY-MM-DD>`)。
   * 開いたときにすぐ出すためだけに使い、必ずサーバーへ最新を取りに行く(features/schedule/routeCache.ts)。
   * GAS版 GAS_SCHEDULE_ROUTE_V2_<スタッフ名>_<日付> に当たるが、スタッフを名前ではなくIDで
   * 区別するため別のキー名にしている(予定・お客様の担当が使う)。
   */
  scheduleRouteCachePrefix: 'katahimo_schedule_route_v1_',
  /**
   * この端末で通知(Web Push)をオンにしたときの購読の endpoint。新アプリ固有 + 使う人(userStorageKey)。
   * 同じ端末で別の人がログインしたとき、その人の通知がオンかどうかを見分けるために持つ。
   */
  pushEndpoint: 'katahimo_push_endpoint',
  /** 出勤簿タブの週間予定の2時間キャッシュ(接頭辞。後ろに `<スタッフ>_<週の日曜>`)。GAS版と同じ(出勤簿タブ担当が使う)。 */
  pastScheduleWeekCachePrefix: 'pastSchedWeek_',
  /** 今月のまとめの2時間キャッシュ(接頭辞。後ろに `<スタッフ>_<YYYY-MM>`)。GAS版と同じ(出勤簿タブ担当が使う)。 */
  attendanceMonthlyCachePrefix: 'attendanceMonthly_',
} as const;

/**
 * ログインしている人ごとに分けて持つ値(ほかの人が同じ端末でログインしても見えないように)。
 * 実際のキーは `userStorageKey(key, scope)` = `<キー名>@<法人ID>/<スタッフID>`。
 * GAS版(1人1端末が前提)は分けていなかった。分ける前の(誰のものか分からない)値は読まずに消す。
 */
export const USER_SCOPED_KEYS = [
  STORAGE_KEYS.recentCustomers,
  STORAGE_KEYS.pendingReportDraft,
  STORAGE_KEYS.lastStartHour,
  STORAGE_KEYS.lastStartMinute,
  STORAGE_KEYS.lastAccidentTime,
  STORAGE_KEYS.pushEndpoint,
] as const;
export type UserScopedKey = (typeof USER_SCOPED_KEYS)[number];

/** 誰の値か(ログイン中の法人・スタッフ。useSession().storageScope) */
export interface UserStorageScope {
  tenantId: string;
  staffId: string;
}

export function userStorageKey(key: UserScopedKey, scope: UserStorageScope): string {
  return `${key}@${scope.tenantId}/${scope.staffId}`;
}

/** getItem/setItem/removeItem だけを使う最小のStorage(テストで差し替えられるように)。 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * localStorageを返す。プライベートブラウズ等で使えない環境では null。
 * GAS版はlocalStorageが使える前提で書かれていたが、例外で画面全体が止まらないようにしておく。
 */
export function getBrowserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readStorage(
  key: string,
  storage: KeyValueStorage | null = getBrowserStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(
  key: string,
  value: string,
  storage: KeyValueStorage | null = getBrowserStorage(),
) {
  try {
    storage?.setItem(key, value);
  } catch {
    // 容量超過・使用不可のときは保存しないだけにする(画面の動作は続ける)
  }
}

export function removeStorage(key: string, storage: KeyValueStorage | null = getBrowserStorage()) {
  try {
    storage?.removeItem(key);
  } catch {
    // 使用不可のときは何もしない
  }
}

/** 接頭辞で始まるキーをまとめて消す(GAS版 invalidatePastScheduleWeekCache_ 等のキャッシュ破棄)。 */
export function removeStorageByPrefix(
  prefix: string,
  storage: (KeyValueStorage & Pick<Storage, 'key' | 'length'>) | null = getBrowserStorage() as Storage | null,
) {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // 使用不可のときは何もしない
  }
}

/** その人の値(USER_SCOPED_KEYS)をすべて消す(ログアウトしたとき) */
export function removeUserScopedData(
  scope: UserStorageScope,
  storage: KeyValueStorage | null = getBrowserStorage(),
) {
  for (const key of USER_SCOPED_KEYS) removeStorage(userStorageKey(key, scope), storage);
}

/** 人ごとに分ける前の(誰のものか分からない)値を消す(ログインしたとき) */
export function removeUnscopedUserData(storage: KeyValueStorage | null = getBrowserStorage()) {
  for (const key of USER_SCOPED_KEYS) removeStorage(key, storage);
}

/**
 * この端末に置いている、画面の表示用のキャッシュ(予定のルート・出勤簿の週間予定・今月のまとめ)を
 * すべて消す(ログアウト・セッション切れのとき。次にログインした人に前の人の予定が見えないように)。
 * 領収書の重複チェック用のキー(GAS_RECEIPT_KEYS_V1_<スタッフ名>)はスタッフごとに分かれていて、
 * 重複の登録を防ぐためのものなので消さない。
 */
export function clearDeviceCaches() {
  removeStorageByPrefix(STORAGE_KEYS.scheduleRouteCachePrefix);
  removeStorageByPrefix(STORAGE_KEYS.pastScheduleWeekCachePrefix);
  removeStorageByPrefix(STORAGE_KEYS.attendanceMonthlyCachePrefix);
}
