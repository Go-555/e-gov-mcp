/**
 * 主要な税法の法令名 → Law ID マッピング
 * 
 * 完全一致による静的マップ。検索API呼び出しを省略して高速化するために使用。
 * マップにない法令名は従来通り検索APIにフォールバックする。
 */
export const BASIC_TAX_LAWS: Record<string, string> = {
  "法人税法": "340AC0000000034",
  "法人税法施行令": "340CO0000000097",
  "所得税法": "340AC0000000033",
  "所得税法施行令": "340CO0000000096",
  "消費税法": "363AC0000000108",
  "消費税法施行令": "363CO0000000360",
  "相続税法": "325AC0000000073",
  "相続税法施行令": "325CO0000000071",
  "租税特別措置法": "332AC0000000026",
  "地方税法": "325AC0000000226",
} as const;

/**
 * 法令名から Law ID を解決する
 * 
 * @param lawName - 法令名（例: "法人税法"、"消費税法第5条"）
 * @returns Law ID（マップにない場合は null）
 * 
 * @example
 * resolveLawIdFromMap("法人税法") // => "340AC0000000034"
 * resolveLawIdFromMap("法人税法第22条") // => "340AC0000000034"
 * resolveLawIdFromMap(" 消費税法 ") // => "363AC0000000108"
 * resolveLawIdFromMap("存在しない法律") // => null
 */
export function resolveLawIdFromMap(lawName: string): string | null {
  if (!lawName) {
    return null;
  }

  // 軽微な正規化：前後空白トリム、連続空白を単一化
  let normalized = lawName.trim().replace(/\s+/g, " ");

  // 「第〇〇条」などの条文番号を除去
  // 例: "法人税法第22条" → "法人税法"
  // 例: "消費税法 第5条第1項" → "消費税法"
  normalized = normalized.replace(/第[0-9０-９一二三四五六七八九十百千]+条.*$/, "").trim();

  // マップから検索
  return BASIC_TAX_LAWS[normalized] ?? null;
}

