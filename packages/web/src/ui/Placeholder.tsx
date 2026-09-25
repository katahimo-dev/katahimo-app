/**
 * まだ作っていない画面の仮置き。各機能の担当が本物の画面に置きかえたら使わなくなる。
 * (全部置きかわったらこのファイルごと消すこと)
 */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-2">🚧</div>
      <div className="text-base text-gray-700">{title}</div>
      <div className="text-sm text-gray-600 mt-1">この画面は準備中です</div>
    </div>
  );
}
