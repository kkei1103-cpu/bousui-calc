# きょうのニュース SEO強化版 — セットアップ手順

## SEO設計の4軸

### 1. 技術的SEO
- Core Web Vitals対応（軽量HTML、Googleフォント最適化）
- サイトマップ自動生成＋Googleへの更新通知（ping）
- robots.txt設定
- canonical URL設定
- RSS フィード（購読者獲得・被リンク獲得）

### 2. コンテンツSEO
- 記事ごとに個別URL（`/articles/記事スラッグ.html`）
- ロングテールキーワードを各記事のmeta keywordsに設定
- 12時間ごとの更新でGoogleに「新鮮なサイト」と認識させる
- FAQコンテンツで「People Also Ask」枠を狙う

### 3. 構造化データ（リッチスニペット）
- `NewsArticle` schema → ニュース検索に表示される
- `FAQPage` schema → 検索結果にQ&Aが展開表示される
- `WebSite` schema → サイトリンク検索ボックス獲得
- `ItemList` schema → 記事一覧を検索エンジンに伝達
- `BreadcrumbList` schema → パンくずリストが検索結果に表示

### 4. SNS拡散・被リンク獲得
- OGP設定（X/LINE/Facebookでシェア時に綺麗に表示）
- Xシェアボタン・LINEシェアボタン
- RSS購読ボタン（ブログ・教育サイトからの被リンク誘導）

---

## GitHub Secretsに追加が必要な変数

| 変数名 | 値 |
|--------|-----|
| `ANTHROPIC_API_KEY` | AnthropicのAPIキー |
| `NETLIFY_AUTH_TOKEN` | Netlifyの認証トークン |
| `NETLIFY_SITE_ID` | NetlifyのサイトID |
| `SITE_URL` | 実際のサイトURL（例: `https://kids-news.netlify.app`） |

---

## 狙うキーワード戦略

### スモールキーワード（最初の1〜2ヶ月で狙う）
- 「子ども向けニュース 今日」
- 「小学生 ニュース わかりやすい」
- 「きょうの出来事 子ども」

### ミドルキーワード（3〜4ヶ月目）
- 「子どもニュース」
- 「こどもニュース」
- 「小学生ニュース」

### ビッグキーワード（6ヶ月以降）
- 「子ども ニュース」
- 「ニュース わかりやすい」

---

## 月間コスト目安
| 項目 | 費用 |
|------|------|
| GitHub Actions | 無料 |
| Netlify | 無料 |
| Claude API（12時間×30日=60回） | 約$1〜3/月 |
| **合計** | **約$1〜3/月** |
