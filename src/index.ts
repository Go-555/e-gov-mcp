#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

dotenv.config();

const MCP_NAME = process.env.MCP_NAME ?? "e-gov-mcp";
const E_GOV_API_BASE = "https://laws.e-gov.go.jp/api/1";

// e-Gov API helper functions
async function searchLaws(params: {
  keyword?: string;
  lawNum?: string;
  lawType?: string;
  limit?: number;
}): Promise<any> {
  const searchParams = new URLSearchParams();
  
  if (params.keyword) {
    searchParams.append("keyword", params.keyword);
  }
  if (params.lawNum) {
    searchParams.append("lawNum", params.lawNum);
  }
  if (params.lawType) {
    searchParams.append("lawType", params.lawType);
  }
  
  const url = `${E_GOV_API_BASE}/lawlists/1?${searchParams.toString()}`;
  
  console.error(`[${MCP_NAME}] Searching laws: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`e-Gov API error: ${response.status} ${response.statusText}`);
  }
  
  const xmlText = await response.text();
  return parseSearchResults(xmlText, params.limit);
}

async function getLawData(lawId: string): Promise<any> {
  const url = `${E_GOV_API_BASE}/lawdata/${lawId}`;
  
  console.error(`[${MCP_NAME}] Fetching law data: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`e-Gov API error: ${response.status} ${response.statusText}`);
  }
  
  const xmlText = await response.text();
  return parseLawData(xmlText);
}

// Simple XML parser for search results
function parseSearchResults(xmlText: string, limit: number = 10): any {
  const laws: any[] = [];
  
  // Extract LawNameListInfo elements
  const lawRegex = /<LawNameListInfo>(.*?)<\/LawNameListInfo>/gs;
  const matches = xmlText.matchAll(lawRegex);
  
  let count = 0;
  for (const match of matches) {
    if (count >= limit) break;
    
    const lawInfo = match[1];
    const lawId = lawInfo.match(/<LawId>(.*?)<\/LawId>/)?.[1] || "";
    const lawNo = lawInfo.match(/<LawNo>(.*?)<\/LawNo>/)?.[1] || "";
    const lawName = lawInfo.match(/<LawName>(.*?)<\/LawName>/)?.[1] || "";
    const promulgationDate = lawInfo.match(/<PromulgationDate>(.*?)<\/PromulgationDate>/)?.[1] || "";
    
    laws.push({
      lawId,
      lawNo,
      lawName,
      promulgationDate,
    });
    
    count++;
  }
  
  return {
    count: laws.length,
    laws,
  };
}

// Simple XML parser for law data
function parseLawData(xmlText: string): any {
  const lawNum = xmlText.match(/<LawNum>(.*?)<\/LawNum>/)?.[1] || "";
  const lawTitle = xmlText.match(/<LawTitle>(.*?)<\/LawTitle>/)?.[1] || "";
  const lawBody = xmlText.match(/<LawBody>(.*?)<\/LawBody>/s)?.[1] || "";
  
  // Extract articles
  const articles: any[] = [];
  const articleRegex = /<Article[^>]*Num="([^"]*)"[^>]*>(.*?)<\/Article>/gs;
  const articleMatches = lawBody.matchAll(articleRegex);
  
  for (const match of articleMatches) {
    const articleNum = match[1];
    const articleContent = match[2];
    
    // Extract article caption
    const caption = articleContent.match(/<ArticleCaption>(.*?)<\/ArticleCaption>/)?.[1] || "";
    
    // Extract article title
    const title = articleContent.match(/<ArticleTitle>(.*?)<\/ArticleTitle>/)?.[1] || "";
    
    // Extract paragraphs
    const paragraphs: string[] = [];
    const paraRegex = /<Paragraph[^>]*>(.*?)<\/Paragraph>/gs;
    const paraMatches = articleContent.matchAll(paraRegex);
    
    for (const paraMatch of paraMatches) {
      const paraContent = paraMatch[1];
      const sentence = paraContent.match(/<Sentence>(.*?)<\/Sentence>/s)?.[1] || "";
      // Remove XML tags from sentence
      const cleanSentence = sentence.replace(/<[^>]+>/g, '').trim();
      if (cleanSentence) {
        paragraphs.push(cleanSentence);
      }
    }
    
    articles.push({
      articleNum,
      caption,
      title,
      paragraphs,
    });
  }
  
  return {
    lawNum,
    lawTitle,
    articleCount: articles.length,
    articles: articles.slice(0, 20), // Limit to first 20 articles to avoid overwhelming response
    note: articles.length > 20 ? `Showing first 20 of ${articles.length} articles` : undefined,
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
          description: "Law number to search for (e.g., '363AC0000000108' for 消費税法)",
        },
        lawType: {
          type: "string",
          description: "Type of law: '1' for Constitution, '2' for Laws, '3' for Cabinet Orders, '4' for Imperial Ordinances, '5' for Ministerial Ordinances",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default: 10, max: 50)",
          default: 10,
        },
      },
    },
  },
  {
    name: "get_law_data",
    description: "Get the full text and articles of a specific Japanese law by its Law ID. Use this after searching to retrieve detailed content including all articles and provisions. The Law ID can be obtained from search_laws results.",
    inputSchema: {
      type: "object",
      properties: {
        lawId: {
          type: "string",
          description: "The Law ID obtained from search_laws (e.g., '363AC0000000108')",
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
    version: "1.0.0",
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
        const args = request.params.arguments as { lawId: string };
        
        if (!args.lawId) {
          throw new Error("lawId is required");
        }
        
        const lawData = await getLawData(args.lawId);
        
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

