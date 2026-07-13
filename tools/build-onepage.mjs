#!/usr/bin/env node
// 把全部 md 合成一份可直接打印的 ONEPAGE.md + ONEPAGE.html。
// 零依赖。顺序由 tools/onepage.order 决定。
//
// 门禁：仓库里任何内容 md 不在清单里 → 失败并报出文件名，绝不静默漏掉。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIRS = ['流程', '参考', '模板'];
const GENERATED = ['ONEPAGE.md', 'ONEPAGE.html'];

const die = (msg) => { console.error(`\x1b[31m✗ onepage: ${msg}\x1b[0m`); process.exit(1); };

// ── 读清单 ───────────────────────────────────────────────
const orderFile = path.join(ROOT, 'tools/onepage.order');
if (!fs.existsSync(orderFile)) die('缺少 tools/onepage.order');

// 一行一个文件。可选 `文件 | 章节标题` —— 覆盖该文件自己的 H1。
// 源文件不动（README 的 `# nanny-playbook` 在 GitHub 上该留着），
// 只把印出来的那一份换掉：目录和章首都用覆盖的标题。
const entries = fs.readFileSync(orderFile, 'utf8')
  .split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map(l => {
    const [file, title] = l.split('|').map(s => s.trim());
    return { file, title: title || null };
  });
const order = entries.map(e => e.file);
const titleOf = new Map(entries.filter(e => e.title).map(e => [e.file, e.title]));

// ── 门禁 1：清单里的文件都得存在 ──────────────────────────
const missing = order.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) die(`清单里这些文件不存在：\n    ${missing.join('\n    ')}`);

// ── 门禁 2：仓库里的 md 都得在清单里（防止新文件被静默漏掉）──
// 根目录扫全部 md，不写白名单——白名单会让新增文件绕过门禁。
// 工具/元文件放在 .claude/ 和 tools/ 里，不在扫描范围内。
const onDisk = [
  ...fs.readdirSync(ROOT).filter(f => f.endsWith('.md')),
  ...CONTENT_DIRS.flatMap(d => {
    const dir = path.join(ROOT, d);
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => `${d}/${f}`)
      : [];
  }),
].filter(f => !GENERATED.includes(f));

const orphan = onDisk.filter(f => !order.includes(f));
if (orphan.length) {
  die(`这些 md 不在 tools/onepage.order 里，打印版会漏掉它们：\n    ${orphan.join('\n    ')}\n` +
      `  → 把它们加进 tools/onepage.order 的合适位置。`);
}

// ── 文件名 → 锚点，用于把跨文件链接改写成页内锚点 ──────────
const anchorOf = (file) => path.basename(file, '.md');
const linkMap = new Map(order.map(f => [anchorOf(f), slug(anchorOf(f))]));

function slug(s) {
  return s.toLowerCase().replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── 逐个读取、清洗 ────────────────────────────────────────
const chapters = order.map((file) => {
  let md = fs.readFileSync(path.join(ROOT, file), 'utf8');

  // 去掉标了 onepage:skip 的段落（仓库自身的说明，印在纸上是噪音）
  md = md.replace(/<!--\s*onepage:skip-start\s*-->[\s\S]*?<!--\s*onepage:skip-end\s*-->/g, '');

  // 章节标题：onepage.order 里的覆盖优先 → 文件自己的一级标题 → 退回文件名
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  const title = titleOf.get(file) || (h1 ? h1[1] : anchorOf(file));

  // 有覆盖时，正文里那个 H1 也要一起换——否则目录印新名字、章首还印着旧的
  if (titleOf.has(file) && h1) md = md.replace(/^#\s+.+?\s*$/m, () => `# ${title}`);

  // 跨文件链接 → 页内锚点。
  // 标签若是文件路径（"模板/候选人评分表.md"），换成干净的名字——
  // 合订本里满篇路径没法读。链接不到的目标退化成加粗纯文本。
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
    if (/^https?:/.test(href)) return m;
    const label = /\.md$/.test(text) ? path.basename(text, '.md') : text;
    const target = linkMap.get(path.basename(href.split('#')[0], '.md'));
    return target ? `[${label}](#${target})` : `**${label}**`;
  });

  return { file, title, id: slug(anchorOf(file)), md: md.trim() };
});

// ── ONEPAGE.md ───────────────────────────────────────────
const stamp = process.env.SOURCE_DATE || '';
// 给维护者的话只能写在 HTML 注释里——注释不渲染、不进 PDF。
// 正文里的每一个字都会被印出来，而拿着打印稿的人没有仓库、不用 git。
const banner = [
  `<!-- 本文件由 tools/build-onepage.mjs 自动生成（${chapters.length} 个源文件），不要手改。 -->`,
  '<!-- 改内容请改各个源 md，提交时 pre-commit 会自动重建。 -->',
  '',
  '# 育儿嫂招聘与管理 · 打印合订本',
  '',
  stamp ? `> 生成时间：${stamp}` : '',
  '',
  '## 目录',
  '',
  ...chapters.map((c, i) => `${i + 1}. [${c.title}](#${c.id})`),
  '',
].filter(l => l !== undefined).join('\n');

const mdOut = banner + '\n' + chapters
  .map(c => `\n<a id="${c.id}"></a>\n\n${c.md}\n`)
  .join('\n---\n');

fs.writeFileSync(path.join(ROOT, 'ONEPAGE.md'), mdOut.replace(/\n{4,}/g, '\n\n\n') + '\n');

// ── 极简 markdown → html（够用即可，无外部依赖）──────────
function mdToHtml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 行内：先保护 <br> 和 <a id>，再转义，最后还原 markdown 行内语法
  const inline = (s) => {
    const keep = [];
    s = s.replace(/<br\s*\/?>/gi, () => `\u0000${keep.push('<br>') - 1}\u0000`);
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  };

  const out = [];
  const lines = src.split('\n');
  let i = 0;
  let listStack = []; // {tag, indent}
  let inSection = false;

  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      out.push(`</${listStack.pop().tag}>`);
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // 章节锚点：开一个新 section，先把上一个关掉
    const anchor = line.match(/^<a id="([^"]+)"><\/a>$/);
    if (anchor) {
      closeLists();
      if (inSection) out.push('</section>');
      out.push(`<section id="${anchor[1]}" class="chapter">`);
      inSection = true;
      i++; continue;
    }

    if (!line.trim()) { i++; continue; }

    // HTML 注释：不渲染（否则会被转义成可见正文印在纸上）
    if (/^<!--/.test(line.trim())) {
      while (i < lines.length && !/-->/.test(lines[i])) i++;
      i++; continue;
    }

    // 表格
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
      closeLists();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      out.push('</tbody></table>');
      continue;
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n')).replace(/<\/?section[^>]*>/g, '')}</blockquote>`);
      continue;
    }

    // 分隔线
    if (/^-{3,}$/.test(line.trim())) { closeLists(); out.push('<hr>'); i++; continue; }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // 列表
    const li = raw.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const indent = li[1].length;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) { out.push(`<${tag}>`); listStack.push({ tag, indent }); }
      out.push(`<li>${inline(li[3].replace(/^\[([ x])\]\s*/, (_, c) => c === 'x' ? '☑ ' : '☐ '))}</li>`);
      i++; continue;
    }

    // 段落
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeLists();
  if (inSection) out.push('</section>');
  return out.join('\n');
}

const body = mdToHtml(mdOut);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>育儿嫂招聘与管理 · 打印合订本</title>
<style>
  :root { --line:#d5d5d5; --muted:#666; --accent:#8a1c1c; }
  * { box-sizing: border-box; }
  body {
    font: 10.5pt/1.65 -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color:#111; max-width: 820px; margin: 0 auto; padding: 32px 24px;
  }
  h1 { font-size: 20pt; margin: 0 0 .6em; padding-bottom:.3em; border-bottom: 3px solid var(--accent); }
  h2 { font-size: 14pt; margin: 1.6em 0 .5em; padding-left:.4em; border-left: 4px solid var(--accent); }
  h3 { font-size: 12pt; margin: 1.2em 0 .4em; }
  h4 { font-size: 11pt; margin: 1em 0 .3em; color: var(--muted); }
  p, li { margin: .35em 0; }
  ul, ol { padding-left: 1.6em; margin: .4em 0; }
  code { background:#f2f2f2; padding: .1em .35em; border-radius:3px; font-size: .9em; }
  hr { border:0; border-top:1px solid var(--line); margin: 1.4em 0; }
  a { color: inherit; text-decoration: none; border-bottom: 1px dotted #aaa; }
  blockquote {
    margin: .8em 0; padding: .6em 1em; background:#faf7f2;
    border-left: 3px solid #c9a227; page-break-inside: avoid;
  }
  blockquote > :first-child { margin-top:0; } blockquote > :last-child { margin-bottom:0; }
  table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.5pt; }
  th, td { border: 1px solid var(--line); padding: .45em .6em; text-align: left; vertical-align: top; }
  th { background:#f4f2ef; font-weight: 600; }
  tr { page-break-inside: avoid; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: avoid; }

  /* 左右 20mm 是装订边（订书针 / 打孔），别收窄。左右对称，单双面打印都留得出。 */
  @page { size: A4; margin: 15mm 20mm; }
  @media print {
    body { max-width: none; padding: 0; font-size: 9.5pt; }
    a { border-bottom: 0; }
    h1, h2, h3, h4 { page-break-after: avoid; }
    table, blockquote, ul, ol { page-break-inside: auto; }
    p, li { orphans: 2; widows: 2; }
  }
</style>
</head>
<body>
${body}
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'ONEPAGE.html'), html);

const kb = (f) => (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0);
console.log(`\x1b[32m✓ onepage\x1b[0m  ${chapters.length} 个文件 → ONEPAGE.md (${kb('ONEPAGE.md')} KB) + ONEPAGE.html (${kb('ONEPAGE.html')} KB)`);
