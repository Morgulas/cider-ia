// Vérifie les traductions (lancé par la CI) :
//  - chaque clé écrite en toutes lettres dans le code (translate.instant('…'), 'clé' | translate…)
//    existe en français et en anglais ;
//  - le français et l'anglais ont les mêmes clés.
// Les clés construites (« 'export.' + type ») ne peuvent pas être vérifiées ici.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const flat = (object, prefix = '', out = {}) => {
  for (const [key, value] of Object.entries(object)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flat(value, `${prefix}${key}.`, out);
    } else {
      out[`${prefix}${key}`] = value;
    }
  }
  return out;
};
const load = lang => flat(JSON.parse(readFileSync(path.join(root, 'src/assets/i18n', `${lang}.json`), 'utf8')));
const languages = { fr: load('fr'), en: load('en') };

// préfixes des clés existantes : une clé qui désigne un groupe (tableau de textes, objet) est valide
const groups = new Set();
for (const keys of Object.values(languages)) {
  for (const key of Object.keys(keys)) {
    const parts = key.split('.');
    for (let i = 1; i < parts.length; i++) {
      groups.add(parts.slice(0, i).join('.'));
    }
  }
}

const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      walk(file);
    } else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts')) {
      files.push(file);
    }
  }
};
walk(path.join(root, 'src/app'));

const patterns = [
  /instant\(\s*'([a-z0-9][\w.-]*[\w-])'/g,
  /(?:get|stream)\(\s*'([a-z0-9][\w-]*\.[\w.-]*[\w-])'/g,
  /'([a-z0-9][\w-]*\.[\w.-]*[\w-])'\s*\|\s*translate/g,
  /"([a-z0-9][\w-]*\.[\w.-]*[\w-])"\s*\|\s*translate/g,
];
const problems = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (groups.has(key)) {
        continue;
      }
      for (const [lang, keys] of Object.entries(languages)) {
        if (!(key in keys)) {
          problems.push(`${path.relative(root, file)} : « ${key} » absente de ${lang}.json`);
        }
      }
    }
  }
}
for (const [lang, other] of [['fr', 'en'], ['en', 'fr']]) {
  for (const key of Object.keys(languages[lang])) {
    if (!(key in languages[other])) {
      problems.push(`« ${key} » est dans ${lang}.json mais pas dans ${other}.json`);
    }
  }
}

if (problems.length) {
  console.error([...new Set(problems)].join('\n'));
  console.error(`\n${problems.length} problème(s) de traduction`);
  process.exit(1);
}
console.info(`Traductions : ${Object.keys(languages.fr).length} clés, toutes présentes en français et en anglais.`);
