'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const name of fs.readdirSync(path.join(root, 'js'))) {
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, 'js', name)], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['--check', path.join(root, 'sw.js')], { stdio: 'inherit' });
for (const name of ['manifest.webmanifest', 'vercel.json', 'package.json']) JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const target = match[1];
  if (/^(?:https?:|data:|#)/.test(target)) continue;
  if (!fs.existsSync(path.join(root, target))) throw new Error('Отсутствует ресурс: ' + target);
}
console.log('Синтаксис JS, JSON и ресурсы index.html проверены.');
