#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { resolveLawIdFromMap, BASIC_TAX_LAWS } from "./tax-law-id-map.js";
import {
  getLookupCache,
  setLookupCache,
  getContentCacheWithFetch,
  getArticleCache,
  setArticleCache,
  getCacheStats,
} from "./lib/cache.js";

dotenv.config();

const MCP_NAME = process.env.MCP_NAME ?? "e-gov-mcp";
const E_GOV_API_BASE = "https://laws.e-gov.go.jp/api/2";

// e-Gov API helper functions
async function searchLaws(params: {
  keyword?: string;
  lawNum?: string;
  lawType?: string;
  limit?: number;
}): Promise<any> {
  // keyword指定時のみ、キャッシュとマップをチェック
  if (params.keyword && !params.lawNum && !params.lawType) {
    const normalizedKeyword = params.keyword.replace(/第[0-9０-９一二三四五六七八九十百千]+条.*$/, "").trim();
    
    // Step 1: 静的マップをチェック（超高速）
    const lawIdFromMap = resolveLawIdFromMap(params.keyword);
    if (lawIdFromMap) {
      console.error(`[map] hit: ${params.keyword} -> ${lawIdFromMap}`);
      // Lookup層キャッシュにも保存（次回のために）
      setLookupCache(normalizedKeyword, lawIdFromMap);
      return {
        total_count: 1,
        count: 1,
        laws: [
          {
            law_info: {
              law_id: lawIdFromMap,
            },
            revision_info: {
              law_title: normalizedKeyword,
            },
          },
        ],
      };
    }
    
    // Step 2: Lookup層キャッシュをチェック（高速）
    const lawIdFromCache = getLookupCache(normalizedKeyword);
    if (lawIdFromCache) {
      return {
        total_count: 1,
        count: 1,
        laws: [
          {
            law_info: {
              law_id: lawIdFromCache,
            },
            revision_info: {
              law_title: normalizedKeyword,
            },
          },
        ],
      };
    }
    
    console.error(`[map] miss: ${params.keyword} (fallback to API)`);
  }

  // 従来通りAPIを叩く
  const searchParams = new URLSearchParams();
  
  // law_title parameter accepts partial match (部分一致)
  if (params.keyword) {
    searchParams.append("law_title", params.keyword);
  }
  if (params.lawNum) {
    searchParams.append("law_num", params.lawNum);
  }
  if (params.lawType) {
    searchParams.append("law_type", params.lawType);
  }
  if (params.limit) {
    searchParams.append("limit", params.limit.toString());
  }
  
  const url = `${E_GOV_API_BASE}/laws?${searchParams.toString()}`;
  
  console.error(`[${MCP_NAME}] Searching laws: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`e-Gov API error: ${response.status} ${response.statusText}`);
  }
  
  const jsonData = await response.json() as any;
  
  // Lookup層キャッシュに保存（keyword指定時のみ）
  if (params.keyword && jsonData.laws && jsonData.laws.length > 0) {
    const firstLaw = jsonData.laws[0];
    const lawTitle = firstLaw.revision_info?.law_title || params.keyword;
    const lawId = firstLaw.law_info?.law_id;
    if (lawId) {
      setLookupCache(lawTitle, lawId);
    }
  }
  
  return jsonData;
}

async function getLawData(lawId: string, articleNum?: string, paragraphNum?: string, itemNum?: string): Promise<any> {
  // Article層キャッシュチェック（特定の条が指定されている場合）
  if (articleNum) {
    const cachedArticle = getArticleCache(lawId, articleNum, paragraphNum, itemNum);
    if (cachedArticle) {
      return cachedArticle;
    }
  }
  
  // Content層キャッシュから全文を取得（なければAPIから取得）
  const lawData = await getContentCacheWithFetch(lawId, async () => {
    // asofパラメータを追加（実行日の日付）
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const params = new URLSearchParams({
      law_full_text_format: 'json',
      asof: today,
    });
    const url = `${E_GOV_API_BASE}/law_data/${lawId}?${params.toString()}`;
    
    console.error(`[${MCP_NAME}] Fetching law data: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`e-Gov API error: ${response.status} ${response.statusText}`);
    }
    
    return await response.json();
  });
  
  // If specific article is requested, extract it
  if (articleNum) {
    const result = extractArticle(lawData, articleNum, paragraphNum, itemNum);
    // Article層キャッシュに保存
    setArticleCache(lawId, articleNum, paragraphNum, itemNum, result);
    return result;
  }
  
  // Otherwise return basic info + article summary
  return {
    lawInfo: lawData.law_info,
    revisionInfo: lawData.revision_info,
    articlesSummary: extractArticlesSummary(lawData.law_full_text),
    note: "This is a summary. Use articleNum parameter to get specific articles."
  };
}

// Extract specific article from law data
function extractArticle(lawData: any, articleNum: string, paragraphNum?: string, itemNum?: string): any {
  const lawFullText = lawData.law_full_text;
  
  // Find the article in the law structure
  const article = findArticleRecursive(lawFullText, articleNum);
  
  if (!article) {
    return {
      lawInfo: lawData.law_info,
      revisionInfo: lawData.revision_info,
      error: `Article ${articleNum} not found`,
    };
  }
  
  // If paragraph number is specified, filter paragraphs
  let filteredArticle = article;
  if (paragraphNum) {
    const targetParagraph = article.children?.find((child: any) => 
      child.tag === "Paragraph" && child.attr?.Num === paragraphNum
    );
    
    if (!targetParagraph) {
      return {
        lawInfo: lawData.law_info,
        revisionInfo: lawData.revision_info,
        error: `Article ${articleNum}, Paragraph ${paragraphNum} not found`,
      };
    }
    
    // If item number is specified, filter items within the paragraph
    let filteredParagraph = targetParagraph;
    if (itemNum) {
      const targetItem = targetParagraph.children?.find((child: any) => 
        child.tag === "Item" && child.attr?.Num === itemNum
      );
      
      if (!targetItem) {
        return {
          lawInfo: lawData.law_info,
          revisionInfo: lawData.revision_info,
          error: `Article ${articleNum}, Paragraph ${paragraphNum}, Item ${itemNum} not found`,
        };
      }
      
      // Keep ParagraphNum, ParagraphSentence (context), and the specific Item
      filteredParagraph = {
        ...targetParagraph,
        children: targetParagraph.children?.filter((child: any) => {
          return child.tag === "ParagraphNum" || 
                 child.tag === "ParagraphSentence" ||
                 (child.tag === "Item" && child.attr?.Num === itemNum);
        }) || []
      };
    }
    
    filteredArticle = {
      ...article,
      children: [
        ...article.children?.filter((child: any) => 
          child.tag === "ArticleTitle" || child.tag === "ArticleCaption"
        ) || [],
        filteredParagraph
      ]
    };
  }
  
  // Build note message
  let note = `Showing Article ${articleNum}`;
  if (paragraphNum) {
    note += `, Paragraph ${paragraphNum}`;
  }
  if (itemNum) {
    note += `, Item ${itemNum}`;
  }
  
  return {
    lawInfo: lawData.law_info,
    revisionInfo: lawData.revision_info,
    article: filteredArticle,
    note: note
  };
}

// Recursively search for an article in the law structure
function findArticleRecursive(node: any, articleNum: string): any {
  if (!node) return null;
  
  // Check if this node is the article we're looking for
  if (node.tag === "Article" && node.attr?.Num === articleNum) {
    return node;
  }
  
  // Recursively search children
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findArticleRecursive(child, articleNum);
      if (found) return found;
    }
  }
  
  return null;
}

// Extract summary of articles (first 20)
function extractArticlesSummary(lawFullText: any): any[] {
  const articles: any[] = [];
  collectArticles(lawFullText, articles);
  
  return articles.slice(0, 20).map(article => ({
    articleNum: article.attr?.Num,
    title: extractTextFromNode(article.children?.find((c: any) => c.tag === "ArticleTitle")),
    caption: extractTextFromNode(article.children?.find((c: any) => c.tag === "ArticleCaption")),
  }));
}

// Recursively collect all articles
function collectArticles(node: any, articles: any[]): void {
  if (!node) return;
  
  if (node.tag === "Article") {
    articles.push(node);
  }
  
  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      collectArticles(child, articles);
    }
  }
}

// Extract text content from a node
function extractTextFromNode(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node.children)) {
    return node.children.map((c: any) => extractTextFromNode(c)).join("");
  }
  return "";
}

// ============================================================================
// Prefetch common laws
// ============================================================================

/**
 * プリフェッチするデフォルトの法令リスト
 */
const DEFAULT_PREFETCH_LAWS = [
  "法人税法",
  "所得税法",
  "消費税法",
  "相続税法",
];

/**
 * 指定された法令を事前にキャッシュに読み込む
 * 
 * @param lawNames - プリフェッチする法令名のリスト（省略時はデフォルト）
 * @returns プリフェッチ結果
 */
async function prefetchCommonLaws(lawNames?: string[]): Promise<any> {
  const targetLaws = lawNames || DEFAULT_PREFETCH_LAWS;
  const results: any[] = [];
  const errors: any[] = [];
  
  console.error(`[${MCP_NAME}] Prefetching ${targetLaws.length} laws...`);
  
  for (const lawName of targetLaws) {
    try {
      // Step 1: 法令名 → ID を解決
      let lawId: string | undefined;
      
      // 静的マップをチェック
      lawId = resolveLawIdFromMap(lawName) ?? undefined;
      
      // マップになければ検索APIで取得
      if (!lawId) {
        const searchResult = await searchLaws({ keyword: lawName, limit: 1 });
        if (searchResult.laws && searchResult.laws.length > 0) {
          lawId = searchResult.laws[0].law_info?.law_id;
        }
      }
      
      if (!lawId) {
        errors.push({ lawName, error: "Law ID not found" });
        continue;
      }
      
      // Step 2: 法令全文を取得してContent層にキャッシュ
      await getLawData(lawId);
      
      results.push({
        lawName,
        lawId,
        status: "cached",
      });
      
      console.error(`[${MCP_NAME}] Prefetched: ${lawName} (${lawId})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push({ lawName, error: errorMessage });
      console.error(`[${MCP_NAME}] Prefetch error for ${lawName}: ${errorMessage}`);
    }
  }
  
  return {
    prefetched: results,
    errors: errors.length > 0 ? errors : undefined,
    summary: {
      total: targetLaws.length,
      success: results.length,
      failed: errors.length,
    },
  };
}

// Define tools
const TOOLS: Tool[] = [
  {
    name: "search_laws",
    description: "Search for Japanese laws in the e-Gov database. You can search by keyword (法令名), law number (法令番号), or law type. Use this when users want to find laws related to specific topics like '消費税法', '法人税法', etc.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "Keyword to search in law names (e.g., '消費税', '法人税', '所得税')",
        },
        lawNum: {
          type: "string",
          description: "Law number to search for (e.g., '昭和二十二年法律第三十四号')",
        },
        lawType: {
          type: "string",
          description: "Type of law: 'Constitution' for Constitution, 'Act' for Laws, 'CabinetOrder' for Cabinet Orders, 'ImperialOrder' for Imperial Ordinances, 'MinisterialOrdinance' for Ministerial Ordinances",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10, max: 100)",
          default: 10,
        },
      },
    },
  },
  {
    name: "get_law_data",
    description: "Get Japanese law content by Law ID. Can retrieve the entire law (summary of first 20 articles) or a specific article/paragraph/item. Use articleNum to get a specific article (e.g., '22' for Article 22). Use paragraphNum with articleNum to get a specific paragraph (e.g., articleNum='22', paragraphNum='1' for Article 22, Paragraph 1). Use itemNum with both articleNum and paragraphNum to get a specific item (e.g., articleNum='22', paragraphNum='3', itemNum='1' for Article 22, Paragraph 3, Item 1). The response is in JSON format with structured data.",
    inputSchema: {
      type: "object",
      properties: {
        lawId: {
          type: "string",
          description: "The Law ID obtained from search_laws (e.g., '363AC0000000108' for 消費税法, '322AC0000000034' for 財政法)",
        },
        articleNum: {
          type: "string",
          description: "Optional: Specific article number to retrieve (e.g., '22' for Article 22, '5' for Article 5). If not specified, returns summary of first 20 articles.",
        },
        paragraphNum: {
          type: "string",
          description: "Optional: Specific paragraph number within the article (e.g., '1' for Paragraph 1, '4' for Paragraph 4). Must be used with articleNum.",
        },
        itemNum: {
          type: "string",
          description: "Optional: Specific item number within the paragraph (e.g., '1' for Item 1, '2' for Item 2). Must be used with both articleNum and paragraphNum.",
        },
      },
      required: ["lawId"],
    },
  },
  {
    name: "prefetch_common_laws",
    description: "Prefetch commonly used tax laws into cache for faster access. This tool loads law data into cache before it's needed, improving response time for subsequent queries. By default, it prefetches 法人税法, 所得税法, 消費税法, and 相続税法.",
    inputSchema: {
      type: "object",
      properties: {
        lawNames: {
          type: "array",
          items: { type: "string" },
          description: "Optional: List of law names to prefetch. If not specified, defaults to [法人税法, 所得税法, 消費税法, 相続税法]",
        },
      },
    },
  },
  {
    name: "get_cache_stats",
    description: "Get cache statistics including hit rates, miss rates, and current cache sizes for all cache layers (Lookup, Content, Article). Useful for monitoring cache performance and understanding which laws are being cached.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Create server
const server = new Server(
  {
    name: MCP_NAME,
    version: "1.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error(`[${MCP_NAME}] Listing tools`);
  return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.error(`[${MCP_NAME}] Tool called: ${request.params.name}`);

  try {
    switch (request.params.name) {
      case "search_laws": {
        const args = request.params.arguments as {
          keyword?: string;
          lawNum?: string;
          lawType?: string;
          limit?: number;
        };
        
        const results = await searchLaws({
          keyword: args.keyword,
          lawNum: args.lawNum,
          lawType: args.lawType,
          limit: args.limit || 10,
        });
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "get_law_data": {
        const args = request.params.arguments as { 
          lawId: string;
          articleNum?: string;
          paragraphNum?: string;
          itemNum?: string;
        };
        
        if (!args.lawId) {
          throw new Error("lawId is required");
        }
        
        const lawData = await getLawData(args.lawId, args.articleNum, args.paragraphNum, args.itemNum);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(lawData, null, 2),
            },
          ],
        };
      }

      case "prefetch_common_laws": {
        const args = request.params.arguments as {
          lawNames?: string[];
        };
        
        const result = await prefetchCommonLaws(args.lawNames);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_cache_stats": {
        const stats = getCacheStats();
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[${MCP_NAME}] Error:`, errorMessage);
    
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  console.error(`[${MCP_NAME}] Starting MCP server...`);
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error(`[${MCP_NAME}] Server running on stdio`);
}

main().catch((error) => {
  console.error(`[${MCP_NAME}] Fatal error:`, error);
  process.exit(1);
});
