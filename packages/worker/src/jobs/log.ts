/** Cloud Logging が構造化ログとして解釈できる1行JSONを標準出力/標準エラーに書く。 */
export function logJson(severity: 'INFO' | 'WARNING' | 'ERROR', message: string, fields: object = {}): void {
  const line = JSON.stringify({ severity, message, ...fields });
  if (severity === 'ERROR') console.error(line);
  else console.log(line);
}
