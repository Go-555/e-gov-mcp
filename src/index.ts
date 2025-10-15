#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { resolveLawIdFromMap } from "./tax-law-id-map.js";

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
  // 🆕 マップチェック: keyword指定時、lawNumやlawTypeがない場合のみ
  if (params.keyword && !params.lawNum && !params.lawType) {
    const lawId = resolveLawIdFromMap(params.keyword);
    if (lawId) {
      console.error(`[map] hit: ${params.keyword} -> ${lawId}`);
      // マップから結果を構築（API呼び出しをスキップ）
      return {
        total_count: 1,
        count: 1,
        laws: [
          {
            law_info: {
              law_id: lawId,
            },
            revision_info: {
              law_title: params.keyword.replace(/第[0-9０-９一二三四五六七八九十百千]+条.*$/, "").trim(),
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
  return jsonData;
}

async function getLawData(lawId: string, articleNum?: string, paragraphNum?: string): Promise<any> {
  const url = `${E_GOV_API_BASE}/law_data/${lawId}`;
  
  console.error(`[${MCP_NAME}] Fetching law data: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`e-Gov API error: ${response.status} ${response.statusText}`);
  }
  
  const jsonData = await response.json() as any;
  
  // If specific article is requested, extract it
  if (articleNum) {
    return extractArticle(jsonData, articleNum, paragraphNum);
  }
  
  // Otherwise return basic info + article summary
  return {
    lawInfo: jsonData.law_info,
    revisionInfo: jsonData.revision_info,
    articlesSummary: extractArticlesSummary(jsonData.law_full_text),
    note: "This is a summary. Use articleNum parameter to get specific articles."
  };
}

// Extract specific article from law data
function extractArticle(lawData: any, articleNum: string, paragraphNum?: string): any {
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
    filteredArticle = {
      ...article,
      children: article.children?.filter((child: any) => {
        return child.tag === "Paragraph" && child.attr?.Num === paragraphNum ||
               child.tag === "ArticleTitle" || child.tag === "ArticleCaption";
      }) || []
    };
  }
  
  return {
    lawInfo: lawData.law_info,
    revisionInfo: lawData.revision_info,
    article: filteredArticle,
    note: paragraphNum 
      ? `Showing Article ${articleNum}, Paragraph ${paragraphNum}` 
      : `Showing Article ${articleNum}`
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
    description: "Get Japanese law content by Law ID. Can retrieve the entire law (summary of first 20 articles) or a specific article/paragraph. Use articleNum to get a specific article (e.g., '22' for Article 22). Use paragraphNum with articleNum to get a specific paragraph (e.g., articleNum='22', paragraphNum='1' for Article 22, Paragraph 1). The response is in JSON format with structured data.",
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
      },
      required: ["lawId"],
    },
  },
];

// Create server
const server = new Server(
  {
    name: MCP_NAME,
    version: "1.0.4",
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
        };
        
        if (!args.lawId) {
          throw new Error("lawId is required");
        }
        
        const lawData = await getLawData(args.lawId, args.articleNum, args.paragraphNum);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(lawData, null, 2),
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
