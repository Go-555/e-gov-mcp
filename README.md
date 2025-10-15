# e-Gov MCP

e-Gov法令API（v2）を使用して、日本の法令情報を取得するためのMCPサーバーです。法人税法、消費税法、所得税法などの条文を簡単に検索・取得できます。

## 主な機能

- 🔍 **法令検索** - 法令名での部分一致検索（「法人税法」「消費税法」など）
- ⚡ **高速検索** - 主要10税法は事前マッピングにより検索APIをスキップして高速化
- 📄 **条文取得** - 特定の条・項を指定して取得可能
- 🔄 **JSON形式** - e-Gov API v2を使用し、クリーンなJSON形式でデータを返却
- 🚀 **簡単セットアップ** - npxで即座に利用可能

## インストール

### 前提条件
- Node.js 18以上
- APIキーは不要（e-Gov APIは公開されています）

### ローカルでビルド

```bash
cd /path/to/e-gov-mcp
npm install
npm run build
```

## セットアップ方法

### Claude Code (CLI)

```bash
claude mcp add "e-Gov MCP" -s user -- npx @gonuts555/e-gov-mcp@latest
```

削除する場合：

```bash
claude mcp remove "e-Gov MCP"
```

### Cursor

`.cursor/mcp.json` に以下を追加：

```json
{
  "mcpServers": {
    "e-gov-mcp": {
      "command": "npx",
      "args": ["-y", "@gonuts555/e-gov-mcp@latest"],
      "autoStart": true
    }
  }
}
```

**注意:** このリポジトリには `.cursor/mcp.json` は含まれていません。上記の設定を手動で追加してください。

### その他のクライアント

<details>
<summary>VS Code</summary>

```bash
code --add-mcp '{"name":"e-gov-mcp","command":"npx","args":["-y","@gonuts555/e-gov-mcp@latest"]}'
```

</details>

<details>
<summary>Claude Desktop</summary>

MCPインストールガイドに従って、上記の標準設定を使用してください。

</details>

<details>
<summary>LM Studio</summary>

- Command: `npx`
- Args: `["-y", "@gonuts555/e-gov-mcp@latest"]`
- Enabled: true

</details>

<details>
<summary>Goose</summary>

- Type: STDIO
- Command: `npx`
- Args: `@gonuts555/e-gov-mcp@latest`
- Enabled: true

</details>

<details>
<summary>opencode</summary>

`~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "e-gov-mcp": {
      "type": "local",
      "command": ["npx", "-y", "@gonuts555/e-gov-mcp@latest"],
      "enabled": true
    }
  }
}
```

</details>

<details>
<summary>Qodo Gen</summary>

新しいMCPを追加し、上記の標準JSON設定を使用してください。

</details>

<details>
<summary>Windsurf</summary>

ドキュメントを参照し、上記の標準設定を使用してください。

</details>

## 利用可能なツール

### search_laws

e-Gov法令データベースから法令を検索します。

**入力パラメータ:**
- `keyword` (string, オプション): 法令名または略称（部分一致）
  - 例: `"法人税法"`, `"消費税"`, `"所得税"`
- `lawNum` (string, オプション): 法令番号
  - 例: `"昭和四十年法律第三十四号"`
- `lawType` (string, オプション): 法令種別
  - `"Constitution"` - 憲法
  - `"Act"` - 法律
  - `"CabinetOrder"` - 政令
  - `"ImperialOrder"` - 勅令
  - `"MinisterialOrdinance"` - 省令
- `limit` (number, オプション): 最大取得件数（デフォルト: 10, 最大: 100）

**出力:**
```json
{
  "total_count": 10,
  "count": 3,
  "laws": [
    {
      "law_info": {
        "law_id": "340AC0000000034",
        "law_num": "昭和四十年法律第三十四号",
        ...
      },
      "revision_info": {
        "law_title": "法人税法",
        "law_title_kana": "ほうじんぜいほう",
        "category": "国税",
        ...
      }
    }
  ]
}
```

### get_law_data

Law IDを使用して法令の詳細を取得します。

**入力パラメータ:**
- `lawId` (string, **必須**): search_lawsで取得したLaw ID
  - 例: `"340AC0000000034"` (法人税法)
  - 例: `"363AC0000000108"` (消費税法)
- `articleNum` (string, オプション): 取得する条の番号
  - 例: `"22"` (第22条)
  - 指定しない場合、最初の20条の概要を返します
- `paragraphNum` (string, オプション): 取得する項の番号（articleNumと併用）
  - 例: `"4"` (第4項)
- `itemNum` (string, オプション): 取得する号の番号（articleNumとparagraphNumと併用）
  - 例: `"1"` (第1号)

**出力:**

特定の条・項を指定した場合:
```json
{
  "lawInfo": {...},
  "revisionInfo": {...},
  "article": {
    "tag": "Article",
    "attr": { "Num": "22" },
    "children": [
      {
        "tag": "ArticleTitle",
        "children": ["第二十二条"]
      },
      {
        "tag": "Paragraph",
        "attr": { "Num": "4" },
        "children": [...]
      }
    ]
  },
  "note": "Showing Article 22, Paragraph 4"
}
```

特定の項・号を指定した場合:
```json
{
  "lawInfo": {...},
  "revisionInfo": {...},
  "article": {
    "tag": "Article",
    "attr": { "Num": "22" },
    "children": [
      {
        "tag": "ArticleTitle",
        "children": ["第二十二条"]
      },
      {
        "tag": "Paragraph",
        "attr": { "Num": "3" },
        "children": [
          {
            "tag": "ParagraphNum",
            "children": ["３"]
          },
          {
            "tag": "ParagraphSentence",
            "children": [...]
          },
          {
            "tag": "Item",
            "attr": { "Num": "1" },
            "children": [...]
          }
        ]
      }
    ]
  },
  "note": "Showing Article 22, Paragraph 3, Item 1"
}
```

## 使用例

### 例1: 法人税法を検索

```json
{
  "name": "search_laws",
  "arguments": {
    "keyword": "法人税法",
    "limit": 3
  }
}
```

### 例2: 法人税法第22条第4項を取得

```json
{
  "name": "get_law_data",
  "arguments": {
    "lawId": "340AC0000000034",
    "articleNum": "22",
    "paragraphNum": "4"
  }
}
```

**取得される内容:**
> 第二項に規定する当該事業年度の収益の額及び前項各号に掲げる額は、別段の定めがあるものを除き、一般に公正妥当と認められる会計処理の基準に従つて計算されるものとする。

### 例3: 法人税法第22条第3項第1号を取得

```json
{
  "name": "get_law_data",
  "arguments": {
    "lawId": "340AC0000000034",
    "articleNum": "22",
    "paragraphNum": "3",
    "itemNum": "1"
  }
}
```

**取得される内容:**
> 当該事業年度の収益に係る売上原価、完成工事原価その他これらに準ずる原価の額

### 例4: 消費税法の納税義務（第5条）を取得

```json
{
  "name": "get_law_data",
  "arguments": {
    "lawId": "363AC0000000108",
    "articleNum": "5"
  }
}
```

### 例5: 所得税法を検索

```json
{
  "name": "search_laws",
  "arguments": {
    "keyword": "所得税",
    "limit": 5
  }
}
```

## よくある質問

### 高速検索について

以下の主要10税法は、検索APIを経由せず即座にLaw IDを解決します：

| 法令名 | Law ID | 高速化 |
|--------|---------|--------|
| 法人税法 | `340AC0000000034` | ✅ |
| 法人税法施行令 | `340CO0000000097` | ✅ |
| 所得税法 | `340AC0000000033` | ✅ |
| 所得税法施行令 | `340CO0000000096` | ✅ |
| 消費税法 | `363AC0000000108` | ✅ |
| 消費税法施行令 | `363CO0000000360` | ✅ |
| 相続税法 | `325AC0000000073` | ✅ |
| 相続税法施行令 | `325CO0000000071` | ✅ |
| 租税特別措置法 | `332AC0000000026` | ✅ |
| 地方税法 | `325AC0000000226` | ✅ |

**使い方のポイント:**
- 「法人税法第22条」のように条文番号付きでも自動認識します
- マップにない法令は従来通り検索APIで取得します
- 完全一致が前提なので、正式名称で検索してください

### 検索できない場合

1. **キーワードを短くする**: 「法人税法施行令」ではなく「法人税」で検索
2. **部分一致を活用**: 「消費税」で検索すると「消費税法」「消費税法施行令」などがヒット
3. **limitを増やす**: デフォルトは10件、必要に応じて増やしてください

### 条文が見つからない場合

- 条番号は文字列で指定: `"22"` (数値の`22`ではない)
- 存在しない条を指定するとエラーメッセージが返ります

## トラブルシューティング

- **ネットワークエラー**: e-Gov APIへのアクセスにインターネット接続が必要です
- **Node 18以上が必要**: `node -v` でバージョンを確認
- **ローカルテスト**: `npx @gonuts555/e-gov-mcp@latest` でサーバーが起動するか確認
- **パッケージ内容の確認**: `npm pack --dry-run` で公開ファイルを確認

## 参考リンク

- [MCP SDK ドキュメント](https://modelcontextprotocol.io/docs/sdks)
- [MCP アーキテクチャ](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP サーバー概念](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [MCP サーバー仕様](https://modelcontextprotocol.io/specification/2025-06-18/server/index)
- [e-Gov 法令API Swagger UI](https://laws.e-gov.go.jp/api/2/swagger-ui)
- [e-Gov 法令API Redoc](https://laws.e-gov.go.jp/api/2/redoc/)

## 技術仕様

### 使用API
- **e-Gov 法令API v2** を使用
- レスポンス形式: JSON
- 認証: 不要（公開API）

### データ形式
- すべてのレスポンスはJSON形式
- XMLパースは不要
- 構造化されたデータで扱いやすい

## ライセンス

MIT

## 開発・貢献

バグ報告や機能要望は [GitHub Issues](https://github.com/Go-555/e-gov-mcp/issues) へお願いします。

---

**パッケージ:** `@gonuts555/e-gov-mcp`  
**バージョン:** 1.1.0  
**npm:** https://www.npmjs.com/package/@gonuts555/e-gov-mcp  
**GitHub:** https://github.com/Go-555/e-gov-mcp
