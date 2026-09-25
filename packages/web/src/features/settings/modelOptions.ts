export interface ModelOption {
  name: string;
  displayName: string;
}

/**
 * モデルの選択肢(GAS版 setSelectOptions_ と同じ)。
 * 現在保存されている値は一覧に無くても必ず先頭に「(現在の設定)」として残す(値が消えないようにするため)。
 * 取得した一覧の重複は除く。
 */
export function buildModelOptions(
  currentValue: string,
  fetchedModels: readonly ModelOption[],
): ModelOption[] {
  const options: ModelOption[] = [];
  const seen = new Set<string>();
  if (currentValue) {
    options.push({ name: currentValue, displayName: '(現在の設定)' });
    seen.add(currentValue);
  }
  for (const model of fetchedModels) {
    if (seen.has(model.name)) continue;
    seen.add(model.name);
    options.push(model);
  }
  return options;
}

/** <option> の表示文字列(GAS版: `${name}${displayName ? ' - ' + displayName : ''}`)。 */
export function modelOptionLabel(option: ModelOption): string {
  return option.displayName ? `${option.name} - ${option.displayName}` : option.name;
}
