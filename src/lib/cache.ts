/**
 * 3層LRUキャッシュシステム
 * 
 * - Lookup層: 法令名 → 法令ID の変換結果をキャッシュ
 * - Content層: 法令ID → 法令全文 をキャッシュ
 * - Article層: 法令ID+条/項/号 → 抽出済み条文 をキャッシュ
 */

import { LRUCache } from "lru-cache";

// ============================================================================
// 型定義
// ============================================================================

export interface CacheStats {
  lookup: {
    hits: number;
    misses: number;
    size: number;
    hitRate: string;
  };
  content: {
    hits: number;
    misses: number;
    size: number;
    hitRate: string;
  };
  article: {
    hits: number;
    misses: number;
    size: number;
    hitRate: string;
  };
  inflight: {
    active: number;
  };
}

// ============================================================================
// キャッシュ設定
// ============================================================================

// Lookup層: 法令名 → 法令ID
const lookupCache = new LRUCache<string, string>({
  max: 200,  // 最大200件
  ttl: 6 * 60 * 60 * 1000,  // 6時間（法令名とIDの対応は頻繁に変わらない）
});

// Content層: 法令ID → 法令全文
const contentCache = new LRUCache<string, any>({
  max: 20,  // 最大20件（メモリ節約）
  ttl: 45 * 60 * 1000,  // 45分（適度に更新される可能性）
});

// Article層: 法令ID+条/項/号 → 抽出済み条文
const articleCache = new LRUCache<string, any>({
  max: 200,  // 最大200件
  ttl: 10 * 60 * 1000,  // 10分（頻繁にアクセスされるため短め）
});

// ============================================================================
// 統計情報
// ============================================================================

const stats = {
  lookup: { hits: 0, misses: 0 },
  content: { hits: 0, misses: 0 },
  article: { hits: 0, misses: 0 },
};

// ============================================================================
// インフライト抑止（同一キーの同時リクエストを1つに集約）
// ============================================================================

const inflightRequests = new Map<string, Promise<any>>();

/**
 * インフライト抑止付きの非同期処理実行
 * 同じキーの同時リクエストは1つに集約され、結果を共有します
 * 
 * @param key - キャッシュキー
 * @param fetcher - データ取得関数
 * @returns 取得されたデータ
 */
async function withInflightSuppression<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  // 既にインフライト中のリクエストがあれば、それを待つ
  if (inflightRequests.has(key)) {
    console.error(`[cache] inflight hit: ${key} (waiting for existing request)`);
    return inflightRequests.get(key) as Promise<T>;
  }

  // 新しいリクエストを開始
  const promise = fetcher()
    .finally(() => {
      // 完了したらインフライトマップから削除
      inflightRequests.delete(key);
    });

  inflightRequests.set(key, promise);
  return promise;
}

// ============================================================================
// Lookup層 API
// ============================================================================

/**
 * Lookup層から法令IDを取得（法令名 → 法令ID）
 */
export function getLookupCache(lawName: string): string | undefined {
  const value = lookupCache.get(lawName);
  if (value !== undefined) {
    stats.lookup.hits++;
    console.error(`[cache:lookup] hit: ${lawName} -> ${value}`);
  } else {
    stats.lookup.misses++;
    console.error(`[cache:lookup] miss: ${lawName}`);
  }
  return value;
}

/**
 * Lookup層に法令IDを保存（法令名 → 法令ID）
 */
export function setLookupCache(lawName: string, lawId: string): void {
  lookupCache.set(lawName, lawId);
  console.error(`[cache:lookup] set: ${lawName} -> ${lawId}`);
}

// ============================================================================
// Content層 API
// ============================================================================

/**
 * Content層から法令全文を取得（法令ID → 法令全文）
 */
export function getContentCache(lawId: string): any | undefined {
  const value = contentCache.get(lawId);
  if (value !== undefined) {
    stats.content.hits++;
    console.error(`[cache:content] hit: ${lawId}`);
  } else {
    stats.content.misses++;
    console.error(`[cache:content] miss: ${lawId}`);
  }
  return value;
}

/**
 * Content層に法令全文を保存（法令ID → 法令全文）
 */
export function setContentCache(lawId: string, lawData: any): void {
  contentCache.set(lawId, lawData);
  console.error(`[cache:content] set: ${lawId}`);
}

/**
 * Content層からの取得をインフライト抑止付きで実行
 */
export async function getContentCacheWithFetch(
  lawId: string,
  fetcher: () => Promise<any>
): Promise<any> {
  // キャッシュチェック
  const cached = getContentCache(lawId);
  if (cached !== undefined) {
    return cached;
  }

  // インフライト抑止付きで取得
  return withInflightSuppression(`content:${lawId}`, async () => {
    const data = await fetcher();
    setContentCache(lawId, data);
    return data;
  });
}

// ============================================================================
// Article層 API
// ============================================================================

/**
 * Article層のキーを生成
 * 
 * @param lawId - 法令ID
 * @param articleNum - 条番号
 * @param paragraphNum - 項番号（オプション）
 * @param itemNum - 号番号（オプション）
 * @returns キャッシュキー（例: "340AC0000000034#A:22#P:4"）
 */
function buildArticleKey(
  lawId: string,
  articleNum: string,
  paragraphNum?: string,
  itemNum?: string
): string {
  let key = `${lawId}#A:${articleNum}`;
  if (paragraphNum) {
    key += `#P:${paragraphNum}`;
  }
  if (itemNum) {
    key += `#I:${itemNum}`;
  }
  return key;
}

/**
 * Article層から抽出済み条文を取得
 */
export function getArticleCache(
  lawId: string,
  articleNum: string,
  paragraphNum?: string,
  itemNum?: string
): any | undefined {
  const key = buildArticleKey(lawId, articleNum, paragraphNum, itemNum);
  const value = articleCache.get(key);
  if (value !== undefined) {
    stats.article.hits++;
    console.error(`[cache:article] hit: ${key}`);
  } else {
    stats.article.misses++;
    console.error(`[cache:article] miss: ${key}`);
  }
  return value;
}

/**
 * Article層に抽出済み条文を保存
 */
export function setArticleCache(
  lawId: string,
  articleNum: string,
  paragraphNum: string | undefined,
  itemNum: string | undefined,
  articleData: any
): void {
  const key = buildArticleKey(lawId, articleNum, paragraphNum, itemNum);
  articleCache.set(key, articleData);
  console.error(`[cache:article] set: ${key}`);
}

// ============================================================================
// 統計情報 API
// ============================================================================

/**
 * キャッシュ統計情報を取得
 */
export function getCacheStats(): CacheStats {
  const calcHitRate = (hits: number, misses: number): string => {
    const total = hits + misses;
    if (total === 0) return "0%";
    return `${Math.round((hits / total) * 100)}%`;
  };

  return {
    lookup: {
      hits: stats.lookup.hits,
      misses: stats.lookup.misses,
      size: lookupCache.size,
      hitRate: calcHitRate(stats.lookup.hits, stats.lookup.misses),
    },
    content: {
      hits: stats.content.hits,
      misses: stats.content.misses,
      size: contentCache.size,
      hitRate: calcHitRate(stats.content.hits, stats.content.misses),
    },
    article: {
      hits: stats.article.hits,
      misses: stats.article.misses,
      size: articleCache.size,
      hitRate: calcHitRate(stats.article.hits, stats.article.misses),
    },
    inflight: {
      active: inflightRequests.size,
    },
  };
}

/**
 * キャッシュ統計情報をリセット
 */
export function resetCacheStats(): void {
  stats.lookup.hits = 0;
  stats.lookup.misses = 0;
  stats.content.hits = 0;
  stats.content.misses = 0;
  stats.article.hits = 0;
  stats.article.misses = 0;
  console.error(`[cache] stats reset`);
}

/**
 * 全キャッシュをクリア
 */
export function clearAllCaches(): void {
  lookupCache.clear();
  contentCache.clear();
  articleCache.clear();
  resetCacheStats();
  console.error(`[cache] all caches cleared`);
}


