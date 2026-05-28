// scripts/generate-news.js  — SEO強化版
// 4軸SEO: 技術的SEO / コンテンツ / 構造化データ / SNS拡散

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY  = process.env.ANTHROPIC_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://your-domain.com';

if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY 未設定'); process.exit(1); }

// ────────── 日付ユーティリティ ──────────────────────────────────
function getJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth() + 1, d = jst.getUTCDate();
  const h = jst.getUTCHours();
  const pad = n => String(n).padStart(2, '0');
  return {
    y, m, d,
    iso: `${y}-${pad(m)}-${pad(d)}`,
    label: `${y}年${m}月${d}日`,
    timeLabel: `${y}年${m}月${d}日 ${pad(h)}:00`,
    slot: h < 12 ? '朝' : '夕方',
  };
}

// ────────── Claude API 呼び出し ─────────────────────────────────
function callAPI(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) reject(new Error(p.error.message));
          else resolve(p);
        } catch (e) { reject(new Error('JSONパースエラー: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// tool_use ループ
async function runWithTools(messages, maxLoops = 8) {
  let data = await callAPI(messages);
  let loop = 0;
  while (data.stop_reason === 'tool_use' && loop < maxLoops) {
    loop++;
    console.log(`  🔍 検索中... (${loop}回目)`);
    messages.push({ role: 'assistant', content: data.content });
    const tr = data.content.filter(b => b.type === 'tool_use').map(b => ({
      type: 'tool_result',
      tool_use_id: b.id,
      content: [{ type: 'text', text: '検索実行済み。' }],
    }));
    messages.push({ role: 'user', content: tr });
    data = await callAPI(messages);
  }
  return { data, messages };
}

// ────────── ニュース取得 ────────────────────────────────────────
async function fetchNews(dt) {
  console.log(`📅 ${dt.label} ${dt.slot}のニュースを取得...`);

  // ① 広範囲検索
  const searchPrompt = `${dt.label}の最新ニュースを以下のソースから幅広く検索してください。
検索対象：NHK・朝日・読売・毎日・日経・BBC・CNN・ロイター・AP通信・Yahoo!ニュース・Google News
「子ども ニュース」「小学生 ニュース」「きょうのニュース」で検索される可能性が高いトピックを重視してください。
世界・科学・スポーツ・テクノロジー・生き物の各カテゴリから幅広く情報を集めてください。`;

  const messages = [{ role: 'user', content: searchPrompt }];
  let { data, messages: msgs } = await runWithTools(messages);

  // ② 子ども向けJSON化
  msgs.push({ role: 'assistant', content: data.content });
  msgs.push({
    role: 'user',
    content: `収集した情報をもとに、今日のニュース6件を選んでください。
SEO観点で「子ども ニュース」「小学生 ニュース 今日」などで検索されやすい内容を優先してください。

JSONのみで回答（バッククォート不要）:
[{
  "title": "20字以内のわかりやすい見出し",
  "slug": "url用の英語スラッグ（例: japan-economy-2026）",
  "category": "世界|科学|スポーツ|テクノロジー|生き物 のどれか",
  "keywords": ["検索キーワード1", "検索キーワード2", "検索キーワード3"],
  "summary": "小学3年生向け2〜3文の説明",
  "explain": "4〜5文の詳しい説明（難しい語はひらがな）",
  "faq_q": "子どもがよく抱く疑問（1文）",
  "faq_a": "その回答（1〜2文）",
  "trivia": ["学校で話したくなる面白い関連雑学1（1〜2文）", "雑学2（1〜2文）", "雑学3（1〜2文）"],
  "source": "出典メディア名（例: NHKニュース、朝日新聞など）"
}]`,
  });

  let { data: finalData } = await runWithTools(msgs, 4);
  const text  = finalData.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('['), end = text.lastIndexOf(']') + 1;
  if (start === -1) throw new Error('JSONなし: ' + text.slice(0, 300));
  const news = JSON.parse(text.slice(start, end));
  console.log(`✅ ${news.length}件取得`);
  return news;
}

// ────────── 記事個別ページ生成（SEO: 記事ごとのURLページ）──────
function generateArticlePage(article, dt, i) {
  const catMap   = { '世界':'world','科学':'science','スポーツ':'sports','テクノロジー':'tech','生き物':'life' };
  const emojiMap = { '世界':'🌍','科学':'🔬','スポーツ':'⚽','テクノロジー':'💻','生き物':'🐾' };
  const slug     = article.slug || `article-${i}`;
  const keywords = (article.keywords || []).join(', ');

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary,
    datePublished: dt.iso,
    dateModified: dt.iso,
    inLanguage: 'ja',
    author: { '@type': 'Organization', name: 'きょうのニュース編集部' },
    publisher: { '@type': 'Organization', name: 'きょうのニュース', url: SITE_URL },
    mainEntityOfPage: `${SITE_URL}/articles/${slug}.html`,
    keywords: keywords,
    articleSection: article.category,
    audience: { '@type': 'Audience', audienceType: '子ども・小学生' },
  });

  const faqSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [{
      '@type': 'Question',
      name: article.faq_q,
      acceptedAnswer: { '@type': 'Answer', text: article.faq_a },
    }],
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${article.title}｜きょうのニュース</title>
  <meta name="description" content="${article.summary}">
  <meta name="keywords" content="${keywords},子ども向けニュース,小学生">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${SITE_URL}/articles/${slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${article.title}｜きょうのニュース">
  <meta property="og:description" content="${article.summary}">
  <meta property="og:url" content="${SITE_URL}/articles/${slug}.html">
  <meta property="article:published_time" content="${dt.iso}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${article.title}">
  <meta name="twitter:description" content="${article.summary}">
  <script type="application/ld+json">${schema}</script>
  <script type="application/ld+json">${faqSchema}</script>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{--accent:#D85A30;--bg:#F7F5F0;--card:#fff;--text:#1a1a1a;--muted:#666;--border:rgba(0,0,0,0.08)}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Nunito',sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
    header{background:#fff;border-bottom:1px solid var(--border);padding:1rem 1.5rem;display:flex;align-items:center;gap:12px}
    .logo{display:flex;align-items:center;gap:8px;text-decoration:none}
    .logo-icon{width:36px;height:36px;background:#FAC775;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px}
    .logo-text{font-size:18px;font-weight:900;color:var(--text)}.logo-text span{color:var(--accent)}
    nav.bread{font-size:13px;color:var(--muted);margin:0 1rem}
    nav.bread a{color:var(--accent);text-decoration:none}
    main{max-width:740px;margin:0 auto;padding:2rem 1rem 4rem}
    .pill{display:inline-block;font-size:11px;font-weight:800;padding:4px 12px;border-radius:20px;margin-bottom:12px}
    .cat-world{background:#ddeeff;color:#0055aa}.cat-science{background:#d4f5e9;color:#006644}
    .cat-sports{background:#fff0cc;color:#885500}.cat-tech{background:#ece8ff;color:#4433aa}.cat-life{background:#ffe8f0;color:#aa3366}
    h1{font-size:24px;font-weight:900;line-height:1.3;margin-bottom:1rem}
    .meta{font-size:13px;color:var(--muted);margin-bottom:1.5rem;display:flex;gap:16px;flex-wrap:wrap}
    .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.5rem;margin-bottom:1.25rem}
    .card h2{font-size:15px;font-weight:800;margin-bottom:10px;color:var(--accent)}
    .card p{font-size:15px;line-height:1.8;color:var(--text)}
    .faq{background:#fff8f0;border-left:3px solid var(--accent);border-radius:0 10px 10px 0;padding:1rem 1.25rem;margin-bottom:1.25rem}
    .faq .q{font-size:14px;font-weight:800;margin-bottom:6px}
    .faq .a{font-size:14px;color:var(--muted);line-height:1.7}
    .share-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:2rem}
    .share-btn{font-family:'Nunito',sans-serif;font-size:13px;font-weight:700;padding:8px 18px;border-radius:10px;border:1px solid var(--border);background:var(--card);cursor:pointer;color:var(--text);transition:background .15s}
    .share-btn:hover{background:var(--bg)}
    .back-link{display:inline-block;font-size:14px;font-weight:700;color:var(--accent);text-decoration:none}
    footer{text-align:center;font-size:13px;color:var(--muted);padding:2rem;border-top:1px solid var(--border);background:#fff}
    footer a{color:var(--accent);text-decoration:none}
    @media(max-width:600px){h1{font-size:20px}main{padding:1.25rem .75rem 3rem}}
  </style>
</head>
<body>
<header>
  <a class="logo" href="/"><div class="logo-icon">📰</div><div class="logo-text">きょうの<span>ニュース</span></div></a>
  <nav class="bread" aria-label="パンくずリスト">
    <a href="/">トップ</a> › <a href="/#${catMap[article.category]||'world'}">${article.category}</a> › ${article.title}
  </nav>
</header>
<main>
  <article itemscope itemtype="https://schema.org/NewsArticle">
    <span class="pill cat-${catMap[article.category]||'world'}">${emojiMap[article.category]||'📌'} ${article.category}</span>
    <h1 itemprop="headline">${article.title}</h1>
    <div class="meta">
      <span>📅 <time itemprop="datePublished" datetime="${dt.iso}">${dt.label}</time> 更新</span>
      <span>👦 小学生向け</span>
    </div>

    <div class="card">
      <h2>📰 かんたんまとめ</h2>
      <p itemprop="description">${article.summary}</p>
    </div>

    <div class="card">
      <h2>📖 もっと詳しく</h2>
      <p>${article.explain}</p>
    </div>

    <div class="faq" itemscope itemtype="https://schema.org/Question">
      <div class="q" itemprop="name">❓ ${article.faq_q}</div>
      <div class="a" itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <span itemprop="text">${article.faq_a}</span>
      </div>
    </div>

    <div class="share-row">
      <button class="share-btn" onclick="shareX()">𝕏 でシェア</button>
      <button class="share-btn" onclick="shareLine()">LINE でシェア</button>
      <button class="share-btn" onclick="copyUrl()">🔗 URLをコピー</button>
    </div>
    <a href="/" class="back-link">← きょうのほかのニュースを見る</a>
  </article>
</main>
<footer>
  <a href="/">トップ</a>　|　<a href="/privacy.html">プライバシーポリシー</a>　|　© ${dt.y} きょうのニュース
</footer>
<script>
const url = location.href;
const title = "${article.title.replace(/"/g,'&quot;')} | きょうのニュース";
function shareX(){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(url),'_blank','noopener')}
function shareLine(){window.open('https://line.me/R/msg/text/?'+encodeURIComponent(title+'\\n'+url),'_blank','noopener')}
function copyUrl(){navigator.clipboard.writeText(url).then(()=>alert('URLをコピーしました！'))}
</script>
</body>
</html>`;
}

// ────────── トップページ生成 ─────────────────────────────────────
function generateIndex(news, dt) {
  const catMap   = { '世界':'world','科学':'science','スポーツ':'sports','テクノロジー':'tech','生き物':'life' };
  const emojiMap = { '世界':'🌍','科学':'🔬','スポーツ':'⚽','テクノロジー':'💻','生き物':'🐾' };

  // BreadcrumbList schema
  const breadSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [{ '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_URL }],
  });

  // WebSite schema（サイトリンク検索ボックス対応）
  const siteSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'きょうのニュース',
    url: SITE_URL,
    description: '小学生でもわかる子ども向けニュースサイト。毎日12時間ごとに更新。',
    inLanguage: 'ja',
    potentialAction: { '@type': 'SearchAction', target: `${SITE_URL}/?q={search_term_string}`, 'query-input': 'required name=search_term_string' },
    audience: { '@type': 'Audience', audienceType: '子ども・小学生' },
  });

  // ItemList schema（記事一覧をGoogleに伝える）
  const listSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${dt.label}のニュース`,
    numberOfItems: news.length,
    itemListElement: news.map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/articles/${a.slug || 'article-' + i}.html`,
      name: a.title,
    })),
  });

  const newsJSON = JSON.stringify(news);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>きょうのニュース｜小学生でもわかる子ども向けニュースサイト</title>
  <meta name="description" content="小学生でもわかりやすい言葉で、${dt.label}の最新ニュースをお届け。世界・科学・スポーツ・テクノロジー・生き物を12時間ごとに更新。">
  <meta name="keywords" content="子どもニュース,子ども向けニュース,小学生ニュース,きょうのニュース,こどもニュース,今日のニュース 小学生,ニュース わかりやすい 子ども">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${SITE_URL}/">
  <meta property="og:type" content="website">
  <meta property="og:title" content="きょうのニュース｜小学生でもわかる子ども向けニュースサイト">
  <meta property="og:description" content="${dt.label}の最新ニュースをわかりやすくお届け。12時間ごとに更新！">
  <meta property="og:url" content="${SITE_URL}/">
  <meta property="og:site_name" content="きょうのニュース">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="きょうのニュース｜子ども向けニュースサイト">
  <meta name="twitter:description" content="${dt.label}の最新ニュースをわかりやすくお届け。">
  <script type="application/ld+json">${siteSchema}</script>
  <script type="application/ld+json">${breadSchema}</script>
  <script type="application/ld+json">${listSchema}</script>
  <link rel="alternate" type="application/rss+xml" title="きょうのニュース RSS" href="${SITE_URL}/feed.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{--accent:#D85A30;--accent-light:#FAC775;--bg:#F7F5F0;--card:#fff;--text:#1a1a1a;--muted:#666;--border:rgba(0,0,0,0.08);--r:14px}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Nunito',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
    header{background:#fff;border-bottom:1px solid var(--border);padding:1rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
    .logo{display:flex;align-items:center;gap:10px;text-decoration:none}
    .logo-icon{width:44px;height:44px;background:var(--accent-light);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px}
    .logo-text{font-size:20px;font-weight:900;color:var(--text)}.logo-text span{color:var(--accent)}
    .date-badge{font-size:13px;font-weight:700;color:var(--muted);background:var(--bg);border:1px solid var(--border);border-radius:20px;padding:5px 14px}
    main{max-width:800px;margin:0 auto;padding:1.5rem 1rem 4rem}
    .hero{background:#fff8f0;border:1px solid var(--border);border-radius:var(--r);padding:1.5rem;margin-bottom:1.5rem;text-align:center}
    .hero h1{font-size:18px;font-weight:900;margin-bottom:6px}
    .hero p{font-size:14px;color:var(--muted)}
    .update-banner{background:#fff;border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-size:13px;color:var(--muted);margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
    .tabs{display:flex;gap:8px;margin-bottom:1.25rem;flex-wrap:wrap}
    .tab{font-family:'Nunito',sans-serif;font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;border:1px solid var(--border);background:#fff;color:var(--muted);cursor:pointer;transition:all .15s}
    .tab:hover{border-color:var(--accent);color:var(--accent)}.tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
    .grid{display:flex;flex-direction:column;gap:1rem}
    .card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:1.25rem;transition:box-shadow .2s,transform .1s}
    .card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08);transform:translateY(-1px)}
    .card-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
    .emoji{font-size:32px;flex-shrink:0;line-height:1;margin-top:2px}
    .pill{display:inline-block;font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;margin-bottom:6px}
    .cat-world{background:#ddeeff;color:#0055aa}.cat-science{background:#d4f5e9;color:#006644}
    .cat-sports{background:#fff0cc;color:#885500}.cat-tech{background:#ece8ff;color:#4433aa}.cat-life{background:#ffe8f0;color:#aa3366}
    h2.title{font-size:17px;font-weight:800;line-height:1.35;margin-bottom:6px}
    .summary{font-size:14px;color:var(--muted);line-height:1.65;margin-bottom:10px}
    .detail{background:var(--bg);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.7;display:none;margin-bottom:10px}
    .detail.open{display:block}
    .trivia-box{background:#fffbeb;border:1px dashed #f59e0b;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.8;display:none;margin-bottom:10px}
    .trivia-box.open{display:block}
    .trivia-label{font-weight:800;font-size:12px;color:#b45309;margin-bottom:8px}
    .trivia-item{margin-bottom:5px;padding-left:20px;position:relative;color:#78350f}
    .trivia-item::before{content:'⭐';position:absolute;left:0;font-size:11px}
    .source-line{font-size:11px;color:#bbb;margin-top:8px;padding-top:6px;border-top:0.5px solid var(--border)}
    .card-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px}
    .more-btn{font-size:13px;font-weight:700;color:var(--accent);background:none;border:none;cursor:pointer;font-family:'Nunito',sans-serif;padding:0}
    .trivia-btn{font-family:'Nunito',sans-serif;font-size:12px;font-weight:700;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:5px 11px;cursor:pointer;color:#b45309;transition:all .15s}
    .trivia-btn:hover{background:#fef3c7}
    .btn-row{display:flex;gap:8px;margin-left:auto}
    .share-btn,.detail-link{font-family:'Nunito',sans-serif;font-size:12px;font-weight:700;background:none;border:1px solid var(--border);border-radius:8px;padding:5px 10px;cursor:pointer;color:var(--muted);transition:all .15s;text-decoration:none;display:inline-block}
    .share-btn:hover,.detail-link:hover{background:var(--bg);color:var(--text)}
    footer{background:#fff;border-top:1px solid var(--border);padding:2rem 1.5rem;text-align:center;font-size:13px;color:var(--muted)}
    footer a{color:var(--accent);text-decoration:none}
    footer .links{display:flex;justify-content:center;gap:20px;margin-bottom:12px;flex-wrap:wrap}
    @media(max-width:600px){header{padding:.75rem 1rem}.logo-text{font-size:17px}.date-badge{display:none}h2.title{font-size:15px}main{padding:1rem .75rem 3rem}}
  </style>
</head>
<body>
<header>
  <a class="logo" href="/" aria-label="きょうのニュース トップ">
    <div class="logo-icon" aria-hidden="true">📰</div>
    <div class="logo-text">きょうの<span>ニュース</span></div>
  </a>
  <div class="date-badge">${dt.label}</div>
</header>
<main>
  <section class="hero" aria-label="サイト紹介">
    <h1>📖 小学生でもわかる！今日のニュース</h1>
    <p>むずかしいニュースを、やさしい言葉でお届けします。12時間ごとに更新！</p>
  </section>
  <div class="update-banner">
    <span>🕐 最終更新：${dt.timeLabel}</span>
    <a href="${SITE_URL}/feed.xml" style="font-size:12px;color:var(--accent);text-decoration:none">📡 RSSで購読する</a>
  </div>
  <nav class="tabs" aria-label="カテゴリで絞り込む">
    <button class="tab active" onclick="setTab(this,'すべて')" aria-pressed="true">すべて</button>
    <button class="tab" onclick="setTab(this,'世界')" aria-pressed="false">🌍 世界</button>
    <button class="tab" onclick="setTab(this,'科学')" aria-pressed="false">🔬 科学</button>
    <button class="tab" onclick="setTab(this,'スポーツ')" aria-pressed="false">⚽ スポーツ</button>
    <button class="tab" onclick="setTab(this,'テクノロジー')" aria-pressed="false">💻 テクノロジー</button>
    <button class="tab" onclick="setTab(this,'生き物')" aria-pressed="false">🐾 生き物</button>
  </nav>
  <section class="grid" id="grid" aria-label="ニュース一覧"></section>
</main>
<footer>
  <div class="links">
    <a href="/about.html">このサイトについて</a>
    <a href="/privacy.html">プライバシーポリシー</a>
    <a href="/feed.xml">RSS</a>
    <a href="/contact.html">お問い合わせ</a>
  </div>
  <p>© ${dt.y} きょうのニュース　|　小学生のためのニュースサイト</p>
  <p style="margin-top:6px;font-size:12px">毎日朝6時・夕18時に自動更新</p>
</footer>
<script>
const NEWS=${newsJSON};
const catMap={世界:'world',科学:'science',スポーツ:'sports',テクノロジー:'tech',生き物:'life'};
const emojiMap={世界:'🌍',科学:'🔬',スポーツ:'⚽',テクノロジー:'💻',生き物:'🐾'};
let tab='すべて';
function setTab(el,t){
  document.querySelectorAll('.tab').forEach(x=>{x.classList.remove('active');x.setAttribute('aria-pressed','false')});
  el.classList.add('active');el.setAttribute('aria-pressed','true');tab=t;render();
}
function render(){
  const grid=document.getElementById('grid');
  const items=tab==='すべて'?NEWS:NEWS.filter(c=>c.category===tab);
  if(!items.length){grid.innerHTML='<p style="text-align:center;padding:2rem;color:#888">このカテゴリのニュースはありません 😢</p>';return}
  grid.innerHTML=items.map((c,i)=>{
    const triviaHtml=(c.trivia||[]).map(t=>\`<p class="trivia-item">\${t}</p>\`).join('');
    const sourceHtml=c.source?\`<div class="source-line">📎 出典：\${c.source}</div>\`:'';
    return \`<article class="card" itemscope itemtype="https://schema.org/NewsArticle">
    <div class="card-top">
      <div class="emoji" aria-hidden="true">\${emojiMap[c.category]||'📌'}</div>
      <div><span class="pill cat-\${catMap[c.category]||'world'}">\${c.category}</span>
      <h2 class="title" itemprop="headline">\${c.title}</h2></div>
    </div>
    <p class="summary" itemprop="description">\${c.summary}</p>
    <div class="detail" id="d\${i}">\${c.explain}</div>
    <div class="trivia-box" id="t\${i}">
      <div class="trivia-label">⭐ 学校で話したくなる雑学コーナー</div>
      \${triviaHtml}
    </div>
    <div class="card-footer">
      <button class="more-btn" onclick="toggle(\${i},this)" aria-expanded="false">もっと詳しく ▼</button>
      \${triviaHtml?\`<button class="trivia-btn" onclick="toggleTrivia(\${i},this)">⭐ 雑学</button>\`:''}
      <div class="btn-row">
        <a class="detail-link" href="/articles/\${c.slug||'article-'+i}.html">📄 記事ページ</a>
        <button class="share-btn" onclick="share('\${(c.title||'').replace(/'/g,\\"\\\\'\\")}',' \${(c.slug||'article-'+i)}')">📤 シェア</button>
      </div>
    </div>
    \${sourceHtml}
  </article>\`;
  }).join('');
}
function toggle(i,btn){const el=document.getElementById('d'+i);const open=el.classList.toggle('open');btn.textContent=open?'閉じる ▲':'もっと詳しく ▼';btn.setAttribute('aria-expanded',open)}
function toggleTrivia(i,btn){const el=document.getElementById('t'+i);const open=el.classList.toggle('open');btn.textContent=open?'⭐ 閉じる':'⭐ 雑学'}
function share(title,slug){
  const url='${SITE_URL}/articles/'+slug+'.html';
  const text='「'+title+'」\\nきょうのニュースで読んだよ！';
  if(navigator.share)navigator.share({title,text,url}).catch(()=>{});
  else window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent(text)+'&url='+encodeURIComponent(url),'_blank','noopener');
}
render();
</script>
</body>
</html>`;
}

// ────────── RSS フィード生成 ─────────────────────────────────────
function generateRSS(news, dt) {
  const items = news.map(a => `
  <item>
    <title><![CDATA[${a.title}]]></title>
    <link>${SITE_URL}/articles/${a.slug || 'article-0'}.html</link>
    <description><![CDATA[${a.summary}]]></description>
    <pubDate>${new Date(dt.iso).toUTCString()}</pubDate>
    <category>${a.category}</category>
    <guid>${SITE_URL}/articles/${a.slug || 'article-0'}.html</guid>
  </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>きょうのニュース</title>
    <link>${SITE_URL}</link>
    <description>小学生でもわかる子ども向けニュースサイト。毎日12時間ごとに更新。</description>
    <language>ja</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    ${items}
  </channel>
</rss>`;
}

// ────────── サイトマップ生成 ─────────────────────────────────────
function generateSitemap(news, dt) {
  const articles = news.map(a => `
  <url>
    <loc>${SITE_URL}/articles/${a.slug || 'article-0'}.html</loc>
    <lastmod>${dt.iso}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${dt.iso}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>${articles}
  <url>
    <loc>${SITE_URL}/privacy.html</loc>
    <lastmod>${dt.iso}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>`;
}

// ────────── エントリポイント ─────────────────────────────────────
(async () => {
  try {
    const dt   = getJST();
    const news = await fetchNews(dt);
    const pub  = path.join(__dirname, '..', 'public');
    const art  = path.join(pub, 'articles');
    if (!fs.existsSync(art)) fs.mkdirSync(art, { recursive: true });

    // トップページ
    fs.writeFileSync(path.join(pub, 'index.html'), generateIndex(news, dt), 'utf8');
    console.log('✅ index.html');

    // 記事個別ページ
    news.forEach((a, i) => {
      const slug = a.slug || `article-${i}`;
      fs.writeFileSync(path.join(art, `${slug}.html`), generateArticlePage(a, dt, i), 'utf8');
    });
    console.log(`✅ articles/ (${news.length}件)`);

    // RSS・サイトマップ
    fs.writeFileSync(path.join(pub, 'feed.xml'),    generateRSS(news, dt),     'utf8');
    fs.writeFileSync(path.join(pub, 'sitemap.xml'), generateSitemap(news, dt), 'utf8');
    console.log('✅ feed.xml / sitemap.xml');

    console.log('🎉 全ファイル生成完了');
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
})();
