#!/usr/bin/env node
// 检查「对话残留」：指南引用了读者看不见的东西。
//
// 规则见 .claude/CLAUDE.md。一句话：这份文档的读者手上只有这份文档——
// 他没参与过讨论、没看过草稿、没读过被拿来对照的外部材料、没问过问题。
// 所以只做正面陈述，不反驳没提过的主张，不假设读者背景，不搬答复。
//
// 引号内的内容会先剥掉再匹配——里面是别人说的话（"我觉得他今天不太对"），不是叙述。
// .claude/ 不扫（规则文件本身列举了这些反面词）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['ONEPAGE.md']); // 生成物

const RULES = [
  { re: /OKR/i,                                   why: '企业绩效框架。读者不一定用——把结论正面写出来，别引用这个词' },
  { re: /如果你在公司|很自然地想|你可能会想|你大概会/, why: '假设读者的职业背景或心理活动' },
  { re: /上一版|我原来|之前写的|原来那版/,           why: '引用读者看不见的草稿' },
  { re: /你发我的|你给我的|你说的那个|你问的/,        why: '引用对话里的东西' },
  { re: /先扔掉|别用.{0,8}那套/,                    why: '反驳一个指南从未提出的主张——读者没见过它' },
  { re: /我建议|我不建议|我觉得|我认为|我的答案/,      why: '指南没有叙述者「我」' },
];

// 剥掉引语和行内代码：里面是别人说的话 / 字面量，不是指南的叙述
const strip = (s) => s
  .replace(/`[^`]*`/g, '')
  .replace(/"[^"]*"/g, '')
  .replace(/'[^']*'/g, '')
  .replace(/[“][^”]*[”]/g, '')
  .replace(/[‘][^’]*[’]/g, '')
  .replace(/「[^」]*」/g, '');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .filter((e) => !['.git', 'node_modules', 'tools', '.claude', '本地', 'local'].includes(e.name))
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

const hits = [];
for (const file of walk(ROOT).filter((f) => f.endsWith('.md'))) {
  const rel = path.relative(ROOT, file);
  if (SKIP.has(rel)) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const bare = strip(line);
    for (const { re, why } of RULES) {
      const m = bare.match(re);
      if (m) hits.push({ rel, ln: i + 1, hit: m[0], why, line: line.trim().slice(0, 70) });
    }
  });
}

if (!hits.length) {
  console.log('\x1b[32m✓ lint-docs\x1b[0m  无对话残留');
  process.exit(0);
}

console.error(`\x1b[31m✗ lint-docs: ${hits.length} 处对话残留\x1b[0m`);
console.error('  指南不能引用读者看不见的东西——他手上只有这份文档。规则见 .claude/CLAUDE.md。\n');
for (const h of hits) {
  console.error(`  \x1b[33m${h.rel}:${h.ln}\x1b[0m  「${h.hit}」— ${h.why}`);
  console.error(`      ${h.line}\n`);
}
console.error('  改法：把结论正面写出来，而不是写成「对某个不在场的东西的反驳」。');
process.exit(1);
