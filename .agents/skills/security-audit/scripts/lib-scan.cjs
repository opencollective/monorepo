#!/usr/bin/env node
'use strict';

/**
 * Shared heuristic scanner for Open Collective GraphQL V2 sources.
 *
 * Limitations (not a TypeScript parser):
 * - Uses regex / brace matching with string+comment awareness.
 * - Computed keys, macros, and runtime field factories may be missed.
 * - Spread fields (`...AccountFields`) are recorded on the defining type, not
 *   expanded onto every implementing object type.
 * - Dynamic `fields()` that build maps at runtime are not executed.
 * - Type-only syntax is skipped best-effort; unusual TS may confuse bounds.
 */

const fs = require('fs');
const path = require('path');

const FIELD_CONFIG_KEYS = new Set([
  'type',
  'args',
  'resolve',
  'description',
  'deprecationReason',
  'subscribe',
  'extensions',
  'astNode',
  'name',
  'isDeprecated',
  'defaultValue',
]);

const SCOPE_HELPERS = [
  'checkRemoteUserCanUseKYC',
  'checkRemoteUserCanUseVirtualCards',
  'checkRemoteUserCanUseAccount',
  'checkRemoteUserCanUseExportRequests',
  'checkRemoteUserCanUseHost',
  'checkRemoteUserCanUseTransactions',
  'checkRemoteUserCanUseOrders',
  'checkRemoteUserCanUseApplications',
  'checkRemoteUserCanUseConversations',
  'checkRemoteUserCanUseExpenses',
  'checkRemoteUserCanUseUpdates',
  'checkRemoteUserCanUseConnectedAccounts',
  'checkRemoteUserCanUseWebhooks',
  'checkRemoteUserCanUseComment',
  'checkRemoteUserCanRoot',
  'checkScope',
  'enforceScope',
  'rejectOAuthAndPersonalTokenAuth',
  'checkScopeForExportRequest',
];

const HELPER_TO_SCOPES = {
  checkRemoteUserCanUseKYC: ['kyc'],
  checkRemoteUserCanUseVirtualCards: ['virtualCards'],
  checkRemoteUserCanUseAccount: ['account'],
  checkRemoteUserCanUseExportRequests: ['exportRequests'],
  checkRemoteUserCanUseHost: ['host'],
  checkRemoteUserCanUseTransactions: ['transactions'],
  checkRemoteUserCanUseOrders: ['orders'],
  checkRemoteUserCanUseApplications: ['applications'],
  checkRemoteUserCanUseConversations: ['conversations'],
  checkRemoteUserCanUseExpenses: ['expenses'],
  checkRemoteUserCanUseUpdates: ['updates'],
  checkRemoteUserCanUseConnectedAccounts: ['connectedAccounts'],
  checkRemoteUserCanUseWebhooks: ['webhooks'],
  checkRemoteUserCanRoot: ['root'],
  rejectOAuthAndPersonalTokenAuth: ['session_only'],
};

function parseArgs(argv = process.argv.slice(2)) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--root') {
      opts.root = argv[++i];
    } else if (arg === '--out') {
      opts.out = argv[++i];
    } else if (arg.startsWith('--root=')) {
      opts.root = arg.slice('--root='.length);
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

function printHelp(usage) {
  process.stdout.write(`${usage}\n`);
}

function resolveApiRoot(opts = {}) {
  const candidates = [];
  if (opts.root) {
    candidates.push(path.resolve(opts.root));
  }
  if (process.env.OC_API_ROOT) {
    candidates.push(path.resolve(process.env.OC_API_ROOT));
  }
  candidates.push(path.resolve(process.cwd(), 'opencollective-api'));
  candidates.push('/workspace/opencollective-api');

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const mutationDir = path.join(candidate, 'server/graphql/v2/mutation');
    if (fs.existsSync(mutationDir) && fs.statSync(mutationDir).isDirectory()) {
      return candidate;
    }
  }
  throw new Error(
    'Cannot resolve opencollective-api root. Pass --root, set OC_API_ROOT, or run from a workspace that contains ./opencollective-api.',
  );
}

function walkFiles(dir, extensions = ['.js', '.ts']) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function relFromApi(apiRoot, filePath) {
  return path.relative(apiRoot, filePath).split(path.sep).join('/');
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') {
      line++;
    }
  }
  return line;
}

function isIdentStart(ch) {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '$';
}

function isIdentPart(ch) {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

/**
 * Advance `i` past strings, comments, regex-like literals, and nested pairs.
 * Returns the index of the matching closer for `{`, `[`, `(`, or `<` (best-effort).
 */
function matchPair(src, openIndex) {
  const open = src[openIndex];
  const close = { '{': '}', '[': ']', '(': ')', '<': '>' }[open];
  if (!close) {
    throw new Error(`matchPair: not an opener at ${openIndex}`);
  }
  let depth = 0;
  let i = openIndex;
  let inString = null;
  let inTemplate = false;
  let templateExprDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  let regexCharClass = false;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inRegex) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '[' && !regexCharClass) {
        regexCharClass = true;
      } else if (ch === ']' && regexCharClass) {
        regexCharClass = false;
      } else if (ch === '/' && !regexCharClass) {
        inRegex = false;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`' && templateExprDepth === 0) {
        inTemplate = false;
        i++;
        continue;
      }
      if (ch === '$' && next === '{' && templateExprDepth === 0) {
        templateExprDepth = 1;
        i += 2;
        continue;
      }
      if (templateExprDepth > 0) {
        if (ch === '{') {
          templateExprDepth++;
        } else if (ch === '}') {
          templateExprDepth--;
        } else if (ch === "'" || ch === '"') {
          inString = ch;
        } else if (ch === '`') {
          // nested template inside ${}
          inTemplate = true;
        } else if (ch === '/' && next === '/') {
          inLineComment = true;
          i += 2;
          continue;
        } else if (ch === '/' && next === '*') {
          inBlockComment = true;
          i += 2;
          continue;
        }
      }
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i++;
      continue;
    }

    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}

function skipWsAndComments(src, i) {
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function readIdent(src, i) {
  if (!isIdentStart(src[i])) {
    return null;
  }
  let j = i + 1;
  while (j < src.length && isIdentPart(src[j])) {
    j++;
  }
  return { name: src.slice(i, j), start: i, end: j };
}

function readString(src, i) {
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return null;
  }
  if (quote === '`') {
    const end = matchTemplateEnd(src, i);
    if (end < 0) {
      return null;
    }
    return { value: src.slice(i + 1, end), raw: src.slice(i, end + 1), start: i, end: end + 1 };
  }
  let j = i + 1;
  let out = '';
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') {
      out += src[j + 1] || '';
      j += 2;
      continue;
    }
    if (ch === quote) {
      return { value: out, raw: src.slice(i, j + 1), start: i, end: j + 1 };
    }
    if (ch === '\n') {
      return null;
    }
    out += ch;
    j++;
  }
  return null;
}

function matchTemplateEnd(src, start) {
  let i = start + 1;
  let expr = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`' && expr === 0) {
      return i;
    }
    if (ch === '$' && src[i + 1] === '{' && expr === 0) {
      const close = matchPair(src, i + 1);
      if (close < 0) {
        return -1;
      }
      i = close + 1;
      continue;
    }
    i++;
  }
  return -1;
}

function skipValue(src, i) {
  i = skipWsAndComments(src, i);
  if (i >= src.length) {
    return i;
  }
  const ch = src[i];
  if (ch === '{' || ch === '[' || ch === '(') {
    const end = matchPair(src, i);
    let j = end < 0 ? src.length : end + 1;
    if (ch === '(') {
      j = skipWsAndComments(src, j);
      if (src[j] === ':') {
        // return type on arrow param list: (x): T =>
        j = skipValue(src, j + 1);
        j = skipWsAndComments(src, j);
      }
      if (src.slice(j, j + 2) === '=>') {
        return skipValue(src, j + 2);
      }
    }
    return j;
  }
  if (ch === "'" || ch === '"' || ch === '`') {
    const str = readString(src, i);
    return str ? str.end : i + 1;
  }

  // async function / function / class / new Foo(...)
  const ident = readIdent(src, i);
  if (ident) {
    let j = ident.end;
    if (ident.name === 'async') {
      j = skipWsAndComments(src, j);
      const next = readIdent(src, j);
      if (next && (next.name === 'function' || next.name === 'function*')) {
        j = skipFunctionLike(src, next.end);
        return j;
      }
      j = skipWsAndComments(src, j);
      if (src[j] === '(') {
        j = skipFunctionLike(src, j);
        return j;
      }
    }
    if (ident.name === 'function' || ident.name === 'class' || ident.name === 'new') {
      return skipFunctionLike(src, ident.end);
    }
    j = skipWsAndComments(src, ident.end);
    // generic: Foo<Bar>
    if (src[j] === '<' && /[A-Za-z_$]/.test(src[j + 1] || '')) {
      const end = matchPair(src, j);
      if (end >= 0) {
        j = skipWsAndComments(src, end + 1);
      }
    }
    if (src[j] === '(') {
      const end = matchPair(src, j);
      j = end < 0 ? src.length : end + 1;
      j = skipWsAndComments(src, j);
      if (src[j] === '{') {
        const bodyEnd = matchPair(src, j);
        return bodyEnd < 0 ? src.length : bodyEnd + 1;
      }
      if (src.slice(j, j + 2) === '=>') {
        return skipValue(src, j + 2);
      }
      return j;
    }
    if (src.slice(j, j + 2) === '=>') {
      return skipValue(src, j + 2);
    }
    // chained .prop or ?.[
    while (j < src.length) {
      j = skipWsAndComments(src, j);
      if (src[j] === '.' || (src[j] === '?' && src[j + 1] === '.')) {
        j += src[j] === '?' ? 2 : 1;
        j = skipWsAndComments(src, j);
        const part = readIdent(src, j);
        if (part) {
          j = part.end;
          continue;
        }
        if (src[j] === '(' || src[j] === '[' || src[j] === '{') {
          const end = matchPair(src, j);
          j = end < 0 ? src.length : end + 1;
          continue;
        }
      }
      if (src[j] === '(' || src[j] === '[') {
        const end = matchPair(src, j);
        j = end < 0 ? src.length : end + 1;
        continue;
      }
      break;
    }
    return j;
  }

  if (ch === '/' && src[i + 1] !== '/' && src[i + 1] !== '*') {
    // likely regex; skip until unescaped / then flags
    let j = i + 1;
    while (j < src.length && src[j] !== '\n') {
      if (src[j] === '\\') {
        j += 2;
        continue;
      }
      if (src[j] === '/') {
        j++;
        while (j < src.length && /[a-z]/i.test(src[j])) {
          j++;
        }
        return j;
      }
      j++;
    }
  }

  // number / punct
  let j = i + 1;
  while (j < src.length && /[0-9.eE+\-n]/.test(src[j])) {
    j++;
  }
  return j;
}

function skipFunctionLike(src, i) {
  i = skipWsAndComments(src, i);
  const ident = readIdent(src, i);
  if (ident) {
    i = ident.end;
  }
  i = skipWsAndComments(src, i);
  if (src[i] === '<') {
    const end = matchPair(src, i);
    i = end < 0 ? src.length : end + 1;
    i = skipWsAndComments(src, i);
  }
  if (src[i] === '(') {
    const end = matchPair(src, i);
    i = end < 0 ? src.length : end + 1;
  }
  i = skipWsAndComments(src, i);
  // return type `: Foo`
  if (src[i] === ':') {
    i = skipValue(src, i + 1);
    i = skipWsAndComments(src, i);
  }
  if (src.slice(i, i + 2) === '=>') {
    return skipValue(src, i + 2);
  }
  if (src[i] === '{') {
    const end = matchPair(src, i);
    return end < 0 ? src.length : end + 1;
  }
  return i;
}

function extractTopLevelProperties(src, objectStart) {
  if (src[objectStart] !== '{') {
    return [];
  }
  const objectEnd = matchPair(src, objectStart);
  if (objectEnd < 0) {
    return [];
  }
  const props = [];
  let i = objectStart + 1;
  while (i < objectEnd) {
    i = skipWsAndComments(src, i);
    if (i >= objectEnd || src[i] === '}') {
      break;
    }
    if (src[i] === ',') {
      i++;
      continue;
    }
    if (src[i] === '.' && src.slice(i, i + 3) === '...') {
      i += 3;
      i = skipWsAndComments(src, i);
      const spreadStart = i;
      i = skipValue(src, i);
      props.push({
        kind: 'spread',
        key: src.slice(spreadStart, i).trim(),
        start: spreadStart - 3,
        end: i,
        line: lineAt(src, spreadStart - 3),
      });
      continue;
    }

    let asyncPrefix = false;
    let cursor = i;
    const maybeAsync = readIdent(src, cursor);
    if (maybeAsync && maybeAsync.name === 'async') {
      const after = skipWsAndComments(src, maybeAsync.end);
      if (src[after] !== ':') {
        asyncPrefix = true;
        cursor = after;
      }
    }

    let key = null;
    let keyStart = cursor;
    if (src[cursor] === "'" || src[cursor] === '"' || src[cursor] === '`') {
      const str = readString(src, cursor);
      if (!str) {
        break;
      }
      key = str.value;
      cursor = str.end;
    } else if (src[cursor] === '[') {
      const end = matchPair(src, cursor);
      if (end < 0) {
        break;
      }
      key = src.slice(cursor, end + 1);
      cursor = end + 1;
    } else {
      const ident = readIdent(src, cursor);
      if (!ident) {
        i++;
        continue;
      }
      if (ident.name === 'get' || ident.name === 'set') {
        const after = skipWsAndComments(src, ident.end);
        const next = readIdent(src, after);
        if (next) {
          key = next.name;
          cursor = next.end;
        } else {
          key = ident.name;
          cursor = ident.end;
        }
      } else {
        key = ident.name;
        cursor = ident.end;
      }
    }

    cursor = skipWsAndComments(src, cursor);
    let valueStart;
    let valueEnd;
    let valueKind = 'unknown';
    if (src[cursor] === '(') {
      // method shorthand
      valueStart = i;
      valueEnd = skipFunctionLike(src, cursor);
      valueKind = 'method';
    } else if (src[cursor] === ':') {
      valueStart = skipWsAndComments(src, cursor + 1);
      valueEnd = skipValue(src, valueStart);
      const head = src[valueStart];
      if (head === '{') {
        valueKind = 'object';
      } else if (head === '(' || src.slice(valueStart, valueStart + 8).includes('=>') || /^async\b/.test(src.slice(valueStart))) {
        valueKind = 'function';
      } else if (head === "'" || head === '"' || head === '`') {
        valueKind = 'string';
      } else {
        valueKind = 'expr';
      }
    } else if (src[cursor] === ',' || src[cursor] === '}') {
      // shorthand property
      valueStart = keyStart;
      valueEnd = cursor;
      valueKind = 'shorthand';
    } else {
      i++;
      continue;
    }

    props.push({
      kind: 'prop',
      key,
      asyncPrefix,
      valueKind,
      start: keyStart,
      end: valueEnd,
      valueStart,
      valueEnd,
      line: lineAt(src, keyStart),
      text: src.slice(keyStart, valueEnd),
      valueText: src.slice(valueStart, valueEnd),
    });
    i = valueEnd;
    i = skipWsAndComments(src, i);
    if (src[i] === ',') {
      i++;
    }
  }
  return props;
}

function propertyKeys(props) {
  return props.filter((p) => p.kind === 'prop').map((p) => p.key);
}

function looksLikeFieldConfig(props) {
  const keys = propertyKeys(props);
  if (keys.includes('resolve') || keys.includes('subscribe')) {
    return true;
  }
  if (!keys.includes('type')) {
    return false;
  }
  return keys.includes('args') || keys.includes('description') || keys.includes('deprecationReason');
}

function looksLikeFieldMap(props) {
  const fieldish = props.filter((p) => {
    if (p.kind !== 'prop') {
      return false;
    }
    if (p.valueKind !== 'object') {
      return false;
    }
    if (FIELD_CONFIG_KEYS.has(p.key) && p.key !== 'name') {
      return false;
    }
    const inner = extractTopLevelProperties(p.valueText, 0);
    return looksLikeFieldConfig(inner);
  });
  return fieldish.length > 0;
}

function extractDescriptionFromProps(props) {
  const desc = props.find((p) => p.kind === 'prop' && p.key === 'description');
  if (!desc) {
    return null;
  }
  return stringFromExpr(desc.valueText);
}

function stringFromExpr(expr) {
  if (!expr) {
    return null;
  }
  const parts = [];
  let i = 0;
  const src = expr.trim();
  while (i < src.length) {
    i = skipWsAndComments(src, i);
    if (i >= src.length) {
      break;
    }
    const str = readString(src, i);
    if (str) {
      parts.push(str.value);
      i = str.end;
      i = skipWsAndComments(src, i);
      if (src[i] === '+') {
        i++;
        continue;
      }
      break;
    }
    break;
  }
  if (!parts.length) {
    return null;
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function extractDeclaredScope(description) {
  if (!description) {
    return [];
  }
  const match = description.match(/Scope:\s*(.+?)(?:\.|$)/i);
  if (!match) {
    return [];
  }
  const clause = match[1];
  const scopes = [];
  const re = /"([^"]+)"|'([^']+)'/g;
  let m;
  while ((m = re.exec(clause))) {
    scopes.push(m[1] || m[2]);
  }
  return scopes;
}

function findResolveProp(props) {
  return props.find((p) => p.kind === 'prop' && p.key === 'resolve');
}

function resolveSnippetFromProp(resolveProp, maxLen = 400) {
  if (!resolveProp) {
    return null;
  }
  const snippet = resolveProp.valueText.replace(/\s+/g, ' ').trim();
  if (snippet.length <= maxLen) {
    return snippet;
  }
  return `${snippet.slice(0, maxLen)}...`;
}

function precedingComments(src, index, maxChars = 800) {
  const from = Math.max(0, index - maxChars);
  return src.slice(from, index);
}

function hasEslintScopeDisable(src, resolveIndex) {
  const window = precedingComments(src, resolveIndex);
  return /eslint-disable(?:-next-line)?\s+[^\n]*require-scope-check/.test(window);
}

function parseImportMap(src, filePath) {
  const imports = [];
  const re =
    /import\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:(\*)\s+as\s+(\w+)|\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[6];
    const resolved = resolveImport(filePath, spec);
    const names = [];
    if (m[5]) {
      names.push({ local: m[5], imported: 'default', namespace: false });
    }
    if (m[1]) {
      names.push({ local: m[1], imported: 'default', namespace: false });
    }
    if (m[3]) {
      names.push({ local: m[3], imported: '*', namespace: true });
    }
    if (m[4]) {
      for (const part of m[4].split(',')) {
        const bit = part.trim();
        if (!bit || bit.startsWith('type ')) {
          continue;
        }
        const alias = bit.match(/^(\w+)\s+as\s+(\w+)$/) || bit.match(/^(type\s+)?(\w+)$/);
        if (bit.includes(' as ')) {
          const [imported, local] = bit.split(/\s+as\s+/).map((s) => s.trim().replace(/^type\s+/, ''));
          names.push({ local, imported, namespace: false });
        } else {
          const local = bit.replace(/^type\s+/, '').trim();
          if (local) {
            names.push({ local, imported: local, namespace: false });
          }
        }
      }
    }
    imports.push({ spec, resolved, names });
  }

  const requireRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  while ((m = requireRe.exec(src))) {
    imports.push({
      spec: m[2],
      resolved: resolveImport(filePath, m[2]),
      names: [{ local: m[1], imported: 'default', namespace: false }],
    });
  }
  return imports;
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.js`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return base;
}

function findBinding(src, name) {
  const patterns = [
    new RegExp(`export\\s+default\\s+(?:async\\s+)?function\\s+${name}\\b`),
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`),
    new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${name}\\b`),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=`),
    new RegExp(`(?:export\\s+)?const\\s+${name}\\s*[:=]`),
  ];
  if (name === 'default') {
    const def = src.match(/export\s+default\s+/);
    if (def) {
      return { start: def.index + def[0].length, exportDefault: true };
    }
    return null;
  }
  for (const re of patterns) {
    const m = re.exec(src);
    if (m) {
      return { start: m.index, match: m[0] };
    }
  }
  return null;
}

function skipTypeAnnotation(src, i) {
  i = skipWsAndComments(src, i);
  if (src[i] !== ':') {
    return i;
  }
  i++;
  while (i < src.length) {
    i = skipWsAndComments(src, i);
    if (src[i] === '=' && src[i + 1] !== '>' && src[i + 1] !== '=') {
      break;
    }
    if (src[i] === '{' || src[i] === '(' || src[i] === '[' || src[i] === '<') {
      const end = matchPair(src, i);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (i >= src.length) {
      break;
    }
    i++;
  }
  return i;
}

function extractExportedValue(src, exportName) {
  if (exportName === 'default') {
    const m = /export\s+default\s+/.exec(src);
    if (!m) {
      return null;
    }
    let i = skipWsAndComments(src, m.index + m[0].length);
    if (src[i] === '{') {
      const end = matchPair(src, i);
      return { kind: 'object', start: i, end: end + 1, text: src.slice(i, end + 1) };
    }
    const ident = readIdent(src, i);
    if (ident) {
      if (ident.name === 'async' || ident.name === 'function') {
        const end = skipFunctionLike(src, i);
        return { kind: 'function', start: i, end, text: src.slice(i, end), ident: ident.name };
      }
      const after = skipWsAndComments(src, ident.end);
      if (src[after] === '(' || src.slice(after, after + 2) === '=>') {
        const end = skipValue(src, i);
        return { kind: 'function', start: i, end, text: src.slice(i, end), ident: ident.name };
      }
      return { kind: 'ident', start: ident.start, end: ident.end, text: ident.name, ident: ident.name };
    }
    const end = skipValue(src, i);
    return { kind: 'expr', start: i, end, text: src.slice(i, end) };
  }

  const constRe = new RegExp(`export\\s+const\\s+${exportName}\\b`);
  const m = constRe.exec(src);
  if (m) {
    let i = skipTypeAnnotation(src, m.index + m[0].length);
    i = skipWsAndComments(src, i);
    if (src[i] === '=') {
      i = skipWsAndComments(src, i + 1);
      if (src[i] === '{') {
        const end = matchPair(src, i);
        return { kind: 'object', start: i, end: end + 1, text: src.slice(i, end + 1) };
      }
      const end = skipValue(src, i);
      return {
        kind: src[i] === '(' || /^(?:async\b|function\b)/.test(src.slice(i)) ? 'function' : 'expr',
        start: i,
        end,
        text: src.slice(i, end),
      };
    }
  }

  const fnRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\b`);
  const fn = fnRe.exec(src);
  if (fn) {
    const end = skipFunctionLike(src, fn.index + 'export '.length);
    return { kind: 'function', start: fn.index, end, text: src.slice(fn.index, end) };
  }

  const local = new RegExp(`(?:const|let|var)\\s+${exportName}\\b`).exec(src);
  if (local) {
    let i = skipTypeAnnotation(src, local.index + local[0].length);
    i = skipWsAndComments(src, i);
    if (src[i] === '=') {
      i = skipWsAndComments(src, i + 1);
      if (src[i] === '{') {
        const end = matchPair(src, i);
        return { kind: 'object', start: i, end: end + 1, text: src.slice(i, end + 1) };
      }
      const end = skipValue(src, i);
      return {
        kind: src[i] === '(' || /^(?:async\b|function\b)/.test(src.slice(i)) ? 'function' : 'expr',
        start: i,
        end,
        text: src.slice(i, end),
      };
    }
  }
  return null;
}

function configsFromExport(src, file, exportName, seen = new Set()) {
  const key = `${file}::${exportName}`;
  if (!exportName || seen.has(key)) {
    return [];
  }
  seen.add(key);
  const value = extractExportedValue(src, exportName);
  if (!value) {
    return [];
  }
  if (value.kind === 'object') {
    const asMap = fieldConfigsFromMap(src, value.start, file);
    if (asMap.length) {
      return asMap;
    }
    const single = fieldConfigFromObjectText(src, value.start, file, null);
    return single ? [single] : [];
  }
  if (value.kind === 'ident') {
    return configsFromExport(src, file, value.ident, seen);
  }
  if (value.kind === 'function') {
    const obj = unwrapFunctionReturnObject(src, value.start);
    if (obj) {
      const asMap = fieldConfigsFromMap(src, obj.start, file);
      if (asMap.length) {
        return asMap;
      }
      const single = fieldConfigFromObjectText(src, obj.start, file, null);
      return single ? [single] : [];
    }
  }
  // Factory: buildAccountQuery({ ... })
  const start = skipWsAndComments(src, value.start);
  const ident = readIdent(src, start);
  if (ident) {
    const after = skipWsAndComments(src, ident.end);
    if (src[after] === '(') {
      const local = extractExportedValue(src, ident.name) || extractNamedFunctionText(src, ident.name);
      if (local) {
        const obj = local.kind === 'object' ? local : unwrapFunctionReturnObject(src, local.start);
        if (obj && obj.start != null && src[obj.start] === '{') {
          const asMap = fieldConfigsFromMap(src, obj.start, file);
          if (asMap.length) {
            return asMap;
          }
          const single = fieldConfigFromObjectText(src, obj.start, file, null);
          return single ? [single] : [];
        }
      }
      const imports = parseFileImportsToLocal(src, file);
      const imp = imports.get(ident.name);
      if (imp && imp.resolved && fs.existsSync(imp.resolved)) {
        const other = readSource(imp.resolved);
        const imported = imp.imported === 'default' || imp.imported === '*' ? ident.name : imp.imported;
        const fromImported = configsFromExport(other, imp.resolved, imported, seen);
        if (fromImported.length) {
          return fromImported;
        }
        return configsFromExport(other, imp.resolved, ident.name, seen);
      }
    }
  }
  return [];
}

function unwrapFunctionReturnObject(src, fnStart) {
  const inSrc = typeof fnStart === 'string' ? fnStart : src;
  let i = typeof fnStart === 'string' ? 0 : fnStart;
  i = skipWsAndComments(inSrc, i);
  if (inSrc.slice(i, i + 5) === 'async' && !isIdentPart(inSrc[i + 5] || '')) {
    i = skipWsAndComments(inSrc, i + 5);
  }
  const ident = readIdent(inSrc, i);
  if (ident && ident.name === 'function') {
    i = ident.end;
    i = skipWsAndComments(inSrc, i);
    const name = readIdent(inSrc, i);
    if (name) {
      i = name.end;
    }
  }
  i = skipWsAndComments(inSrc, i);
  if (inSrc[i] === '<') {
    const end = matchPair(inSrc, i);
    i = skipWsAndComments(inSrc, end < 0 ? inSrc.length : end + 1);
  }
  if (inSrc[i] === '(') {
    const end = matchPair(inSrc, i);
    i = skipWsAndComments(inSrc, end < 0 ? inSrc.length : end + 1);
  }
  if (inSrc[i] === ':') {
    i = skipValue(inSrc, i + 1);
    i = skipWsAndComments(inSrc, i);
  }
  if (inSrc.slice(i, i + 2) === '=>') {
    i = skipWsAndComments(inSrc, i + 2);
  }
  // `() => ({ ... })`
  if (inSrc[i] === '(') {
    i = skipWsAndComments(inSrc, i + 1);
  }
  if (inSrc[i] === '{') {
    const blockEnd = matchPair(inSrc, i);
    if (blockEnd < 0) {
      return null;
    }
    let j = skipWsAndComments(inSrc, i + 1);
    if (inSrc.slice(j, j + 6) === 'return' && !isIdentPart(inSrc[j + 6] || '')) {
      j = skipWsAndComments(inSrc, j + 6);
      if (inSrc[j] === '{') {
        const objEnd = matchPair(inSrc, j);
        if (objEnd >= 0) {
          return { start: j, end: objEnd + 1, text: inSrc.slice(j, objEnd + 1) };
        }
      }
    }
    const props = extractTopLevelProperties(inSrc, i);
    if (looksLikeFieldMap(props) || looksLikeFieldConfig(props) || props.some((p) => p.kind === 'spread')) {
      return { start: i, end: blockEnd + 1, text: inSrc.slice(i, blockEnd + 1) };
    }
  }
  return null;
}

function fieldConfigFromObjectText(src, objectStart, file, name, extra = {}) {
  const props = extractTopLevelProperties(src, objectStart);
  if (!looksLikeFieldConfig(props)) {
    return null;
  }
  const resolveProp = findResolveProp(props);
  const description = extractDescriptionFromProps(props);
  const resolveIndex = resolveProp ? resolveProp.start : objectStart;
  return {
    name,
    file,
    line: extra.line || lineAt(src, extra.keyStart != null ? extra.keyStart : objectStart),
    description,
    declaredScope: extractDeclaredScope(description),
    hasEslintScopeDisable: hasEslintScopeDisable(src, resolveIndex),
    resolveSnippet: resolveSnippetFromProp(resolveProp),
    resolveText: resolveProp ? resolveProp.valueText : '',
    resolveStart: resolveProp ? resolveProp.start : null,
    objectStart,
    objectText: src.slice(objectStart, matchPair(src, objectStart) + 1),
    props,
    ...extra,
  };
}

function preferScopeFieldConfig(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.resolveText && !incumbent.resolveText) {
    return true;
  }
  if (incumbent.resolveText && !candidate.resolveText) {
    return false;
  }
  return (candidate.line || 0) >= (incumbent.line || 0);
}

function resolveSpreadFieldConfigs(src, spreadExpr, file) {
  const expr = spreadExpr.trim();
  const callIdent = readIdent(expr, skipWsAndComments(expr, 0));
  if (callIdent) {
    const afterName = skipWsAndComments(expr, callIdent.end);
    const isCall = expr[afterName] === '(';
    const fn = extractNamedFunctionText(src, callIdent.name) || extractExportedValue(src, callIdent.name);
    if (fn && (fn.kind === 'function' || fn.text)) {
      const obj = unwrapFunctionReturnObject(src, fn.start);
      if (obj) {
        return fieldConfigsFromMap(src, obj.start, file);
      }
    }
    if (!isCall) {
      const binding = extractExportedValue(src, callIdent.name);
      if (binding && binding.kind === 'object') {
        return fieldConfigsFromMap(src, binding.start, file);
      }
      const imports = parseFileImportsToLocal(src, file);
      const imp = imports.get(callIdent.name);
      if (imp && imp.resolved && fs.existsSync(imp.resolved)) {
        const other = readSource(imp.resolved);
        const importedName =
          imp.imported === 'default' || imp.imported === '*' ? callIdent.name : imp.imported || callIdent.name;
        const fromOther = extractExportedValue(other, importedName);
        if (fromOther && fromOther.kind === 'object') {
          return fieldConfigsFromMap(other, fromOther.start, imp.resolved);
        }
      }
    }
  }
  return [];
}

function fieldConfigsFromMap(src, objectStart, file) {
  const props = extractTopLevelProperties(src, objectStart);
  if (looksLikeFieldConfig(props) && !looksLikeFieldMap(props)) {
    return [];
  }
  const byName = new Map();
  for (const prop of props) {
    if (prop.kind === 'spread') {
      for (const cfg of resolveSpreadFieldConfigs(src, prop.key, file)) {
        const prev = byName.get(cfg.name);
        if (preferScopeFieldConfig(cfg, prev)) {
          byName.set(cfg.name, cfg);
        }
      }
      continue;
    }
    if (prop.kind !== 'prop') {
      continue;
    }
    if (prop.valueKind === 'object' && prop.valueText[0] === '{') {
      const cfg = fieldConfigFromObjectText(src, prop.valueStart, file, prop.key, {
        line: prop.line,
        keyStart: prop.start,
      });
      if (cfg) {
        byName.set(cfg.name, cfg);
      }
      continue;
    }
    if (prop.valueKind === 'expr' || prop.valueKind === 'shorthand') {
      const ident = readIdent(prop.valueText.trim(), 0);
      if (!ident) {
        continue;
      }
      const local = extractExportedValue(src, ident.name) || extractNamedFunctionText(src, ident.name);
      let objStart = null;
      if (local && local.kind === 'object') {
        objStart = local.start;
      } else if (local && (local.kind === 'function' || local.text)) {
        const obj = unwrapFunctionReturnObject(src, local.start);
        if (obj) {
          objStart = obj.start;
        } else if (src[libSkip(src, local.start)] === '{') {
          objStart = libSkip(src, local.start);
        }
      }
      if (objStart != null && src[objStart] === '{') {
        const cfg = fieldConfigFromObjectText(src, objStart, file, prop.key, {
          line: prop.line,
          keyStart: prop.start,
        });
        if (cfg) {
          byName.set(cfg.name, cfg);
        }
      }
    }
  }
  return [...byName.values()];
}

function libSkip(src, i) {
  return skipWsAndComments(src, i);
}

function findIndexObject(src, varName) {
  const re = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) {
    return null;
  }
  const start = m[0].endsWith('{') ? m.index + m[0].length - 1 : src.indexOf('{', m.index);
  return { start, end: matchPair(src, start) + 1 };
}

function parseIndexEntries(src, varName) {
  const obj = findIndexObject(src, varName);
  if (!obj) {
    return [];
  }
  return extractTopLevelProperties(src, obj.start);
}

function parseFileImportsToLocal(src, filePath) {
  const map = new Map();
  for (const imp of parseImportMap(src, filePath)) {
    for (const name of imp.names) {
      map.set(name.local, { ...name, spec: imp.spec, resolved: imp.resolved });
    }
  }
  return map;
}

function isCommonGraphqlPath(filePath) {
  if (!filePath) {
    return false;
  }
  const norm = filePath.split(path.sep).join('/');
  return /\/server\/graphql\/common\//.test(norm);
}

function calledIdentifiers(text) {
  if (!text) {
    return [];
  }
  const names = new Set();
  const re = /\b([A-Za-z_$][\w$]*)\s*(?:\(|`)/g;
  let m;
  while ((m = re.exec(text))) {
    names.add(m[1]);
  }
  const member = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = member.exec(text))) {
    names.add(`${m[1]}.${m[2]}`);
    names.add(m[2]);
  }
  return [...names];
}

function extractNamedFunctionText(src, name) {
  const patterns = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?(?:function\\b|\\()`),
    new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*async\\s+`),
    new RegExp(`${name}\\s*:\\s*(?:async\\s*)?(?:function\\s*)?\\(`),
  ];
  for (const re of patterns) {
    const m = re.exec(src);
    if (!m) {
      continue;
    }
    let start = m.index;
    const eq = src.indexOf('=', m.index);
    if (eq >= 0 && eq < m.index + m[0].length + 8) {
      start = skipWsAndComments(src, eq + 1);
    }
    const end = skipValue(src, start);
    return { start, end, text: src.slice(start, end), line: lineAt(src, start) };
  }
  return null;
}

function writeJson(data, outPath) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, text);
  } else {
    process.stdout.write(text);
  }
  return text;
}

function generatedAt() {
  return new Date().toISOString();
}

function findGraphQLTypeConfigs(src, file) {
  const results = [];
  const re = /new\s+GraphQL(?:Object|Interface)Type(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const paren = m.index + m[0].length - 1;
    const parenEnd = matchPair(src, paren);
    if (parenEnd < 0) {
      continue;
    }
    const cfgStart = skipWsAndComments(src, paren + 1);
    if (src[cfgStart] !== '{') {
      continue;
    }
    const props = extractTopLevelProperties(src, cfgStart);
    const nameProp = props.find((p) => p.kind === 'prop' && p.key === 'name');
    const typeName = nameProp ? stringFromExpr(nameProp.valueText) : null;
    const fieldsProp = props.find((p) => p.kind === 'prop' && p.key === 'fields');
    results.push({
      file,
      typeName,
      kind: /InterfaceType/.test(m[0]) ? 'interface' : 'object',
      start: cfgStart,
      fieldsProp,
      line: lineAt(src, m.index),
    });
  }
  return results;
}

function resolveFieldsObject(src, fieldsProp, filePath) {
  if (!fieldsProp) {
    return [];
  }
  const text = fieldsProp.valueText.trim();
  if (text.startsWith('{')) {
    return fieldConfigsFromMap(src, fieldsProp.valueStart, filePath);
  }
  // () => ({ ... }) or () => { return { ... } } or named ident
  const unwrapped = unwrapFunctionReturnObject(src, fieldsProp.valueStart);
  if (unwrapped) {
    return fieldConfigsFromMap(src, unwrapped.start, filePath).map((f) => ({
      ...f,
      fieldsObjectStart: unwrapped.start,
    }));
  }
  const ident = readIdent(text, skipWsAndComments(text, 0));
  if (ident) {
    const binding = extractExportedValue(src, ident.name) || (() => {
      const local = extractNamedFunctionText(src, ident.name);
      if (!local) {
        return null;
      }
      if (local.text.includes('{')) {
        const obj = unwrapFunctionReturnObject(src, local.start) || (src[skipWsAndComments(src, local.start)] === '{'
          ? { start: skipWsAndComments(src, local.start), text: local.text }
          : null);
        if (obj) {
          return { kind: 'object', start: obj.start, text: obj.text };
        }
      }
      return null;
    })();
    if (binding && binding.kind === 'object') {
      return fieldConfigsFromMap(src, binding.start, filePath);
    }
    if (binding && binding.kind === 'function') {
      const obj = unwrapFunctionReturnObject(src, binding.start);
      if (obj) {
        return fieldConfigsFromMap(src, obj.start, filePath);
      }
    }
    const fn = extractNamedFunctionText(src, ident.name);
    if (fn) {
      const obj = unwrapFunctionReturnObject(src, fn.start);
      if (obj) {
        return fieldConfigsFromMap(src, obj.start, filePath);
      }
    }
  }
  return [];
}

function extractExportedFieldMaps(src, filePath) {
  const maps = [];
  const re = /export\s+const\s+(\w+Fields)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length - 1;
    const fields = fieldConfigsFromMap(src, start, filePath);
    const parentGuess = m[1].replace(/Fields$/, '');
    maps.push({ name: m[1], parentType: parentGuess, fields, start, line: lineAt(src, m.index) });
  }
  return maps;
}

function loadSourceCached(cache, filePath) {
  if (!filePath) {
    return '';
  }
  if (!cache.has(filePath)) {
    try {
      cache.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
    } catch {
      cache.set(filePath, '');
    }
  }
  return cache.get(filePath);
}

/**
 * Follow resolve text 1-2 hops into same-file helpers and server/graphql/common/*.
 */
function collectHopTexts({ apiRoot, filePath, resolveText, hops = 2, cache = new Map() }) {
  const visited = new Set();
  const texts = [];
  const callees = [];
  const queue = [{ filePath, text: resolveText || '', hop: 0, name: 'resolve' }];

  while (queue.length) {
    const item = queue.shift();
    const key = `${item.filePath}:${item.name}:${item.hop}`;
    if (visited.has(key) || item.hop > hops) {
      continue;
    }
    visited.add(key);
    texts.push(item);
    if (item.hop >= hops) {
      continue;
    }
    const src = loadSourceCached(cache, item.filePath);
    const imports = parseFileImportsToLocal(src, item.filePath);
    const called = calledIdentifiers(item.text);
    for (const ident of called) {
      if (
        [
          'if',
          'return',
          'await',
          'async',
          'new',
          'throw',
          'catch',
          'Promise',
          'Boolean',
          'Number',
          'String',
          'Array',
          'Object',
          'Math',
          'JSON',
          'Error',
          'parseInt',
          'parseFloat',
        ].includes(ident)
      ) {
        continue;
      }
      if (ident.includes('.')) {
        const [ns, method] = ident.split('.');
        const imp = imports.get(ns);
        if (imp && imp.resolved && (isCommonGraphqlPath(imp.resolved) || imp.resolved === item.filePath)) {
          const targetSrc = loadSourceCached(cache, imp.resolved);
          const fn = extractNamedFunctionText(targetSrc, method);
          if (fn) {
            const rel = relFromApi(apiRoot, imp.resolved);
            if (!callees.includes(rel)) {
              callees.push(rel);
            }
            queue.push({ filePath: imp.resolved, text: fn.text, hop: item.hop + 1, name: method });
          }
        }
        continue;
      }
      const imp = imports.get(ident);
      if (imp && imp.resolved && isCommonGraphqlPath(imp.resolved)) {
        const targetSrc = loadSourceCached(cache, imp.resolved);
        const exportName = imp.imported === 'default' || imp.imported === '*' ? ident : imp.imported;
        const fn = extractNamedFunctionText(targetSrc, exportName) || extractNamedFunctionText(targetSrc, ident);
        if (fn) {
          const rel = relFromApi(apiRoot, imp.resolved);
          if (!callees.includes(rel)) {
            callees.push(rel);
          }
          queue.push({ filePath: imp.resolved, text: fn.text, hop: item.hop + 1, name: ident });
        }
        continue;
      }
      if (ident === 'resolve') {
        continue;
      }
      const local = extractNamedFunctionText(src, ident);
      if (local && local.text !== item.text) {
        queue.push({ filePath: item.filePath, text: local.text, hop: item.hop + 1, name: ident });
      }
    }
  }
  return { texts, callees };
}

function detectTwoFactor(texts) {
  const joined = texts.map((t) => t.text).join('\n');
  const enforceForAccount = /twoFactorAuthLib\.enforceForAccount\s*\(|TwoFactorAuthLib\.enforceForAccount\s*\(/i.test(
    joined,
  );
  const enforceForAccountsUserIsAdminOf =
    /twoFactorAuthLib\.enforceForAccountsUserIsAdminOf\s*\(|TwoFactorAuthLib\.enforceForAccountsUserIsAdminOf\s*\(/i.test(
      joined,
    );
  const validateRequest = /twoFactorAuthLib\.validateRequest\s*\(|TwoFactorAuthLib\.validateRequest\s*\(/i.test(joined);
  const onlyAskOnLogin = /onlyAskOnLogin\s*:/.test(joined) || /onlyAskOnLogin\b/.test(joined);
  const sessionParams = /TWO_FACTOR_SESSIONS_PARAMS\b/.test(joined) || /preAuthorize2FA\b/.test(joined);
  return {
    enforceForAccount,
    enforceForAccountsUserIsAdminOf,
    validateRequest,
    onlyAskOnLogin,
    sessionParams,
  };
}

function detectScopeHelpers(texts) {
  const joined = texts.map((t) => t.text).join('\n');
  const helpersCalled = SCOPE_HELPERS.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(joined));
  const enforced = new Set();
  const notes = [];
  for (const helper of helpersCalled) {
    if (HELPER_TO_SCOPES[helper]) {
      for (const scope of HELPER_TO_SCOPES[helper]) {
        enforced.add(scope);
      }
    }
  }
  const literalRe = /\b(?:enforceScope|checkScope)\s*\(\s*[^,)]+\s*,\s*['"]([A-Za-z]+)['"]/g;
  let m;
  while ((m = literalRe.exec(joined))) {
    enforced.add(m[1]);
  }
  if (helpersCalled.includes('checkRemoteUserCanUseComment')) {
    const commentScopes = [];
    if (/ConversationId/.test(joined) || /checkRemoteUserCanUseConversations/.test(joined)) {
      commentScopes.push('conversations');
    }
    if (/UpdateId/.test(joined) || /checkRemoteUserCanUseUpdates/.test(joined)) {
      commentScopes.push('updates');
    }
    if (/ExpenseId/.test(joined) || /checkRemoteUserCanUseExpenses/.test(joined)) {
      commentScopes.push('expenses');
    }
    if (/HostApplicationId/.test(joined) || /checkRemoteUserCanUseHostApplications/.test(joined)) {
      commentScopes.push('account');
    }
    if (commentScopes.length) {
      for (const scope of commentScopes) {
        enforced.add(scope);
      }
    } else {
      notes.push(
        'checkRemoteUserCanUseComment is branch-dependent (conversations|updates|expenses|account); branch not detected in scanned hops',
      );
      enforced.add('conversations');
      enforced.add('updates');
      enforced.add('expenses');
      enforced.add('account');
    }
  }
  if (helpersCalled.includes('checkScopeForExportRequest')) {
    if (/TRANSACTIONS/.test(joined) || /ExportRequestTypes\.TRANSACTIONS/.test(joined)) {
      enforced.add('transactions');
    }
    if (
      /HOSTED_COLLECTIVES/.test(joined) ||
      /isHostReport/.test(joined) ||
      /ExportRequestTypes\.HOSTED_COLLECTIVES/.test(joined)
    ) {
      enforced.add('host');
    }
    if (![...enforced].some((s) => s === 'transactions' || s === 'host')) {
      notes.push('checkScopeForExportRequest is type-dependent (transactions and/or host); branch not fully detected');
      enforced.add('transactions');
      enforced.add('host');
    }
  }
  return { helpersCalled, enforcedScopes: [...enforced], notes };
}

/**
 * Heuristic expected OAuth scopes for PII / sensitive GraphQL fields when descriptions
 * omit Scope:. Used by the scope hunter (not a substitute for human review).
 */
function finalizeExpectedScopeGap(expectedSet, detected, notes) {
  const expected = [...expectedSet];
  const enforced = new Set(detected.enforcedScopes || []);
  const missing = expected.filter((scope) => !enforced.has(scope));
  let flag = null;
  if (missing.length && expected.length) {
    const resolveHint = notes.join('\n');
    const roleOrVisibilityOnly =
      !detected.helpersCalled?.length &&
      /isAdmin|hasRole|canComment|canSee|assertOrder|assertCanSee|loaders\./i.test(resolveHint);
    if (roleOrVisibilityOnly) {
      flag = 'wrong';
    } else if (missing.length < expected.length) {
      flag = 'incomplete';
    } else {
      flag = 'missing';
    }
  }
  return {
    expectedScopes: expected,
    missingExpectedScopes: missing,
    sensitiveFlag: flag,
    sensitiveNotes: notes,
  };
}

/**
 * Expected OAuth scopes for nested resources (transactions, orders, expenses) when
 * resolvers return typed GraphQL lists or top-level queries load sensitive models.
 */
function inferResourceExpectedScopes(cfg, detected, joinedResolveText) {
  const expected = new Set();
  const notes = [];
  const objectText = cfg.objectText || '';
  const resolveText = joinedResolveText || cfg.resolveText || '';
  const combined = `${objectText}\n${resolveText}`;
  const fieldName = cfg.name || '';
  const kind = cfg.kind || '';
  const parentType = cfg.parentType || '';

  const returnsTransactionType =
    /GraphQLTransaction/i.test(objectText) ||
    /loaders\.Transaction\.|models\.Transaction/.test(resolveText);

  if (fieldName === 'transactions' && (returnsTransactionType || /Transaction\.byOrderId/.test(resolveText))) {
    if (parentType === 'PaymentIntent') {
      notes.push(
        'scope enforced on Query.paymentIntent / PaymentIntentCollectionResolver — nested field does not re-check',
      );
    } else if (parentType === 'TransactionGroup') {
      notes.push(
        'scope enforced on Query.transactionGroup / TransactionGroupCollectionResolver — nested field does not re-check',
      );
    } else if (/TransactionsCollectionResolver|TransactionsCollectionQuery|accountTransactions/.test(resolveText)) {
      notes.push('delegates to transactions collection resolver — confirm scope on shared collection entrypoint');
    } else {
      expected.add('transactions');
      if (!(detected.enforcedScopes || []).includes('transactions')) {
        notes.push('nested Transaction list without checkRemoteUserCanUseTransactions / enforceScope(transactions)');
      }
    }
  }

  if (kind === 'query' && fieldName === 'order') {
    expected.add('orders');
    if (!(detected.enforcedScopes || []).includes('orders')) {
      notes.push('Query.order uses assertOrderAccessibleForPrivateCollective only; no orders OAuth scope');
    }
  }

  if (parentType === 'Order' && kind === 'object_field') {
    const orderAdminFields = new Set([
      'comments',
      'memo',
      'customData',
      'pendingContributionData',
      'activities',
      'transactionImportRow',
    ]);
    if (
      orderAdminFields.has(fieldName) &&
      /isAdmin|hasRole|canComment|canSeeOrder|OrdersLib/.test(resolveText) &&
      !/\bcheckScope\s*\([^)]*['"]orders['"]/.test(combined)
    ) {
      expected.add('orders');
      notes.push(`Order.${fieldName} gated by host admin / canComment only`);
    }
  }

  if (
    (fieldName === 'orders' || fieldName === 'order') &&
    /GraphQLOrder|OrderCollection|OrdersCollection/.test(objectText)
  ) {
    if (/OrdersCollectionResolver|ExpensesCollectionQueryResolver/.test(resolveText)) {
      notes.push('delegates to orders/expenses collection resolver — confirm scope on shared collection entrypoint');
    } else if (fieldName === 'orders') {
      expected.add('orders');
    }
  }
  if (fieldName === 'expenses' && /GraphQLExpense|ExpenseCollection/.test(objectText)) {
    if (/ExpensesCollectionQueryResolver/.test(resolveText)) {
      notes.push('delegates to expenses collection resolver — confirm scope on shared collection entrypoint');
    } else if (parentType === 'PlatformBilling') {
      expected.add('expenses');
      notes.push(
        'PlatformBilling.expenses loads Expense rows; parent platformBilling only checks checkRemoteUserCanUseAccount',
      );
    } else {
      expected.add('expenses');
    }
  }

  if (
    fieldName === 'hostApplicationRequests' &&
    kind === 'object_field' &&
    !(detected.enforcedScopes || []).includes('host')
  ) {
    expected.add('host');
    notes.push(
      'Account.hostApplicationRequests uses collective isAdmin only; enforce host OAuth scope (not applications scope)',
    );
  }

  if (parentType === 'Host' && kind === 'object_field') {
    const hostScopeFields = new Set([
      'hostApplications',
      'hostTransactionsReports',
      'hostExpensesReport',
      'hostContributionsReport',
      'hostedVirtualCards',
      'hostedVirtualCardCollectives',
      'hostedVirtualCardMerchants',
      'hostedAccountAgreements',
      'hostedAccounts',
    ]);
    if (hostScopeFields.has(fieldName) && !(detected.enforcedScopes || []).includes('host')) {
      expected.add('host');
      notes.push(`Host.${fieldName} uses admin/role or host-wide SQL without checkRemoteUserCanUseHost`);
    }
  }

  return finalizeExpectedScopeGap(expected, detected, notes);
}

function mergeScopeGapInferences(detected, ...parts) {
  const expected = new Set();
  const notes = [];
  const flagRank = { wrong: 3, incomplete: 2, missing: 1 };
  let flag = null;
  for (const part of parts) {
    for (const scope of part.expectedScopes || []) {
      expected.add(scope);
    }
    notes.push(...(part.sensitiveNotes || []));
    if (part.sensitiveFlag && (!flag || flagRank[part.sensitiveFlag] > flagRank[flag])) {
      flag = part.sensitiveFlag;
    }
  }
  const merged = finalizeExpectedScopeGap(expected, detected, notes);
  if (!merged.missingExpectedScopes.length) {
    merged.sensitiveFlag = null;
    return merged;
  }
  merged.sensitiveFlag = flag || merged.sensitiveFlag;
  return merged;
}

function inferSensitiveExpectedScopes(cfg, detected, joinedResolveText) {
  const expected = new Set();
  const notes = [];
  const objectText = cfg.objectText || '';
  const resolveText = joinedResolveText || cfg.resolveText || '';
  const combined = `${objectText}\n${resolveText}`;
  const fieldName = cfg.name || '';

  if (cfg.parentType === 'Mutation' || cfg.parentType === 'Query' || cfg.kind === 'mutation' || cfg.kind === 'query') {
    return inferResourceExpectedScopes(cfg, detected, joinedResolveText);
  }

  if (
    fieldName === 'emailWaitingForValidation' &&
    (detected.helpersCalled || []).includes('checkRemoteUserCanUseAccount')
  ) {
    return { expectedScopes: ['account'], missingExpectedScopes: [], sensitiveFlag: null, sensitiveNotes: [] };
  }

  const outputEmailType =
    (/type:\s*GraphQLEmailAddress/i.test(objectText) ||
      /GraphQLList\([^)]*GraphQLEmailAddress/i.test(objectText)) &&
    !/args:\s*\{[\s\S]*\bemail\b[\s\S]*GraphQLEmailAddress/i.test(objectText);
  const returnsEmail =
    outputEmailType ||
    /adminUserEmailsForCollective/.test(resolveText) ||
    (fieldName === 'email' && /user\?\.email|remoteUser\.email/.test(resolveText)) ||
    (fieldName === 'emails' && /adminUserEmailsForCollective/.test(resolveText));

  if (returnsEmail) {
    expected.add('email');
    if (/canSeePrivateProfileInfo/.test(resolveText) && !/\bcheckScope\s*\([^)]*['"]email['"]/.test(combined)) {
      notes.push('returns email-like data gated by canSeePrivateProfileInfo (or loaders) without checkScope(email)');
    }
    if (
      /\bcheckScope\s*\([^)]*['"]email['"]/.test(combined) &&
      /canSeePrivateProfileInfo/.test(resolveText) &&
      /CollectiveId\s*===|isAdminOfCollective/.test(resolveText)
    ) {
      notes.push('checkScope(email) on one branch only; other branches may return email via canSeePrivateProfileInfo');
    }
  }

  if (/Scope:\s*["']account["']/.test(cfg.description || '') || /legalName|mainProfile/.test(fieldName)) {
    if (/private|legalName|incognito/i.test(cfg.description || fieldName)) {
      expected.add('account');
      if (/incognito/i.test(combined + (cfg.description || ''))) {
        expected.add('incognito');
      }
    }
  }

  const piiGap = finalizeExpectedScopeGap(expected, detected, notes);
  if (
    !piiGap.missingExpectedScopes.length &&
    expected.has('email') &&
    notes.some((n) => /one branch only/.test(n))
  ) {
    piiGap.sensitiveFlag = 'incomplete';
  }
  if (piiGap.missingExpectedScopes.includes('email')) {
    const hasRoleOrLoaderOnly =
      /canSeePrivateProfileInfo|isAdminOfCollective|isAdmin\(/.test(resolveText) && !detected.helpersCalled?.length;
    if (hasRoleOrLoaderOnly) {
      piiGap.sensitiveFlag = 'wrong';
    }
  }
  const resourceGap = inferResourceExpectedScopes(cfg, detected, joinedResolveText);
  return mergeScopeGapInferences(detected, piiGap, resourceGap);
}

module.exports = {
  FIELD_CONFIG_KEYS,
  SCOPE_HELPERS,
  HELPER_TO_SCOPES,
  parseArgs,
  printHelp,
  resolveApiRoot,
  walkFiles,
  readSource,
  relFromApi,
  lineAt,
  matchPair,
  skipWsAndComments,
  skipValue,
  readIdent,
  readString,
  extractTopLevelProperties,
  looksLikeFieldConfig,
  looksLikeFieldMap,
  extractDescriptionFromProps,
  extractDeclaredScope,
  stringFromExpr,
  findResolveProp,
  resolveSnippetFromProp,
  hasEslintScopeDisable,
  parseImportMap,
  parseFileImportsToLocal,
  resolveImport,
  extractExportedValue,
  configsFromExport,
  unwrapFunctionReturnObject,
  fieldConfigFromObjectText,
  fieldConfigsFromMap,
  parseIndexEntries,
  isCommonGraphqlPath,
  calledIdentifiers,
  extractNamedFunctionText,
  writeJson,
  generatedAt,
  findGraphQLTypeConfigs,
  resolveFieldsObject,
  extractExportedFieldMaps,
  precedingComments,
  collectHopTexts,
  detectTwoFactor,
  detectScopeHelpers,
  inferSensitiveExpectedScopes,
  inferResourceExpectedScopes,
  mergeScopeGapInferences,
  finalizeExpectedScopeGap,
  preferScopeFieldConfig,
};

const USAGE = `lib-scan.cjs - shared GraphQL V2 heuristic scanner (library)

Usage:
  node lib-scan.cjs [--root <apiRoot>] [--help]

Resolves the API root and prints { apiRoot }. Other enumerators require this module.

Limitations: regex/brace matching is not a TypeScript parser. Spread fields are not
expanded onto implementing types. Runtime field factories are not executed.
`;

function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.help) {
    printHelp(USAGE);
    return;
  }
  const apiRoot = resolveApiRoot(opts);
  writeJson({ generatedAt: generatedAt(), apiRoot, script: 'lib-scan.cjs' }, opts.out);
}

module.exports.USAGE = USAGE;
module.exports.main = main;

if (require.main === module) {
  main();
}
