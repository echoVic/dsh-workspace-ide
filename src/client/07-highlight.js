/**
 * dsh-workspace-ide — client half, syntax highlighting engine.
 *
 * A small, dependency-free tokenizer that turns source text into per-line
 * segment arrays for the code viewer's overlay layer. It never produces HTML:
 * the caller maps a segment `kind` to a CSS custom property and renders the text
 * itself, so no string is ever interpreted as markup.
 *
 * Output contract: `highlightLines(code, language)` returns one entry per line
 * (the same split `code.split('\n')` gives — an empty source returns `[]`).
 * Each entry is an array of `[kind, text]` pairs. The invariant the editor
 * overlay depends on is exact: `segments.map(s => s[1]).join('')` equals the
 * original line, including whitespace-only and empty lines. Adjacent segments
 * of the same kind are merged.
 *
 * Performance guard: sources above `MAX_HIGHLIGHT_CHARS` (300 KB) and the
 * `text` language degrade to plain lines without any scanning, so a huge file
 * still opens immediately. The scanner is stateful per line, which keeps block
 * comments / multi-line strings / markdown fences correct across lines without
 * ever re-reading the whole source.
 *
 * The file is concatenated into the shared factory body by
 * `scripts/build-client.mjs`: plain script, no import/export, everything hangs
 * off the shared `S` object.
 */

/** Above this many UTF-16 units the line scanner is skipped entirely. */
const MAX_HIGHLIGHT_CHARS = 300 * 1024;

/** The only segment kinds the renderer understands. */
const HIGHLIGHT_KINDS = Object.freeze(
  'keyword string comment number constant function type variable operator punctuation tag attr property regexp meta plain'
    .split(' '),
);

/** Aliases the Host language chip may carry -> canonical language id. */
const HIGHLIGHT_LANGUAGES = Object.freeze({
  javascript: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  typescript: 'typescript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  vue: 'vue',
  svelte: 'svelte',
  python: 'python',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  kotlin: 'kotlin',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  csharp: 'csharp',
  cs: 'csharp',
  ruby: 'ruby',
  rb: 'ruby',
  php: 'php',
  shell: 'shell',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  powershell: 'powershell',
  ps1: 'powershell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
});

// ─── character helpers ──────────────────────────────────────────────────────

/** @param {number} code - UTF-16 code unit. @returns {boolean} ASCII digit. */
function isDigitCode(code) {
  return code >= 48 && code <= 57;
}

/** @param {number} code - UTF-16 code unit. @returns {boolean} hex digit. */
function isHexCode(code) {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** Identifier start: ASCII letters, `_`, `$` and any non-ASCII character. */
function isIdentStartCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36 || code > 127;
}

/** Identifier continuation: identifier start plus digits. */
function isIdentPartCode(code) {
  return isIdentStartCode(code) || isDigitCode(code);
}

/** Attribute name continuation inside a markup tag. */
function isAttrPartCode(code) {
  return isIdentPartCode(code) || code === 45 || code === 58 || code === 46 || code === 64;
}

/**
 * @param {string} line - source line.
 * @param {number} index - start position.
 * @returns {number} index of the first non-space/tab character at/after index.
 */
function skipSpaces(line, index) {
  let cursor = index;
  while (cursor < line.length) {
    const code = line.charCodeAt(cursor);
    if (code !== 32 && code !== 9) break;
    cursor = cursor + 1;
  }
  return cursor;
}

/**
 * Build a word lookup table from a whitespace-separated literal.
 * @param {string} literal - words separated by spaces.
 * @returns {object} `word -> true`.
 */
function words(literal) {
  const table = {};
  const parts = literal.split(' ');
  for (let index = 0; index < parts.length; index = index + 1) {
    if (parts[index].length > 0) table[parts[index]] = true;
  }
  return table;
}

/** The empty lookup table shared by configs that do not need a word class. */
const NO_WORDS = Object.freeze({});

// ─── language configuration ─────────────────────────────────────────────────

/** Default operator spellings, longest first so `===` wins over `==` and `=`. */
const CODE_OPERATORS = Object.freeze([
  '>>>=', '**=', '<<=', '>>=', '===', '!==', '>>>', '...', '=>', '==', '!=', '<=', '>=',
  '&&', '||', '??', '?.', '::', '->', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
  '<<', '>>', '++', '--', '**', ':=', '..',
]);
const CODE_PUNCTUATION = '(){}[];,';
const CODE_OPERATOR_CHARS = '+-*/%=!<>&|^~?:.@#$';

/** Shorthand for one block-comment pair. */
function block(open, close) {
  return Object.freeze({ open: open, close: close });
}

/** Shorthand for one string literal flavour. */
function literal(open, close, escape, multiline, kind) {
  return Object.freeze({
    open: open,
    close: close,
    escape: escape === true,
    multiline: multiline === true,
    kind: typeof kind === 'string' ? kind : 'string',
  });
}

const STRINGS_C = Object.freeze([
  literal('"', '"', true, false),
  literal("'", "'", true, false),
]);
const STRINGS_C_MULTILINE = Object.freeze([literal('"', '"', true, true), literal("'", "'", true, true)]);
const STRINGS_JS = Object.freeze([
  literal('`', '`', true, true),
  literal('"', '"', true, false),
  literal("'", "'", true, false),
]);
const STRINGS_PY = Object.freeze([
  literal('"""', '"""', true, true),
  literal("'''", "'''", true, true),
  literal('"', '"', true, false),
  literal("'", "'", true, false),
]);
const STRINGS_BACKTICK = Object.freeze([literal('`', '`', true, true), literal('"', '"', true, false), literal("'", "'", true, false)]);
const STRINGS_DOUBLE = Object.freeze([literal('"', '"', true, false)]);
const STRINGS_MARKUP = Object.freeze([literal('"', '"', false, false), literal("'", "'", false, false)]);
const STRINGS_YAML = Object.freeze([literal('"', '"', true, false), literal("'", "'", false, false)]);
const STRINGS_SHELL = Object.freeze([literal('"', '"', true, true), literal("'", "'", false, true)]);

const COMMENT_SLASH = Object.freeze([block('/*', '*/')]);

/**
 * Merge per-language differences onto the scanner defaults. A config only
 * declares what differs from "C-like code with no words".
 * @param {object} overrides - config fields.
 * @returns {object} a complete scanner config.
 */
function makeConfig(overrides) {
  return Object.freeze(
    Object.assign(
      {
        keywords: NO_WORDS,
        types: NO_WORDS,
        constants: NO_WORDS,
        functions: NO_WORDS,
        lineComments: Object.freeze([]),
        blockComments: Object.freeze([]),
        stringDefs: STRINGS_C,
        propertyLookahead: false,
        propertyLookaheadEquals: false,
        propertyAfterStrings: false,
        caseInsensitive: false,
        hexColor: false,
        atRules: false,
        customProperty: false,
        variablePrefix: '',
        sectionBrackets: false,
      },
      overrides,
    ),
  );
}

const JS_KEYWORDS = words(
  'as async await break case catch class const continue debugger default delete do else export extends finally ' +
    'for from function get if import in instanceof let new of return set static super switch this throw try ' +
    'typeof var void while with yield',
);
const TS_KEYWORDS = words(
  'as async await break case catch class const continue debugger declare default delete do else enum export ' +
    'extends finally for from function get if implements import in infer instanceof interface is keyof let ' +
    'namespace new of out override package private protected public readonly return satisfies set static super ' +
    'switch this throw try type typeof undefined unique unknown var void while with yield asserts',
);
const JS_TYPES = words(
  'any bigint boolean never number object string symbol unknown void ' +
    'Array ArrayBuffer BigInt Boolean DataView Date Error EvalError Float32Array Float64Array Function Int8Array ' +
    'Int16Array Int32Array Intl JSON Map Math Number Object Promise Proxy RangeError ReferenceError Reflect RegExp ' +
    'Set SharedArrayBuffer String Symbol SyntaxError TypeError URIError Uint8Array Uint8ClampedArray Uint16Array ' +
    'Uint32Array WeakMap WeakSet console document globalThis navigator process window Buffer module exports',
);
const JS_CONSTANTS = words('true false null undefined NaN Infinity');
const TS_TYPES = words(
  'any bigint boolean never number object string symbol unknown void never ' +
    'Record Partial Readonly Required Pick Omit Exclude Extract NonNullable ReturnType Parameters Awaited ' +
    'Array Promise Map Set WeakMap WeakSet Date RegExp Error JSON Math Number String Boolean Object Function Symbol ' +
    'ArrayBuffer Uint8Array console document window globalThis process Buffer',
);

/** Config for html/xml/vue/svelte: a dedicated tag/attribute scanner. */
const MARKUP_CONFIG = Object.freeze({ markup: true });

const LANGUAGE_CONFIGS = Object.freeze({
  javascript: makeConfig({
    keywords: JS_KEYWORDS,
    types: JS_TYPES,
    constants: JS_CONSTANTS,
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_JS,
  }),

  typescript: makeConfig({
    keywords: TS_KEYWORDS,
    types: TS_TYPES,
    constants: JS_CONSTANTS,
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_JS,
  }),

  json: makeConfig({
    constants: words('true false null'),
    stringDefs: STRINGS_DOUBLE,
    propertyAfterStrings: true,
  }),

  markdown: Object.freeze({ markdown: true }),

  css: makeConfig({
    keywords: words('important inherit initial unset revert none auto'),
    lineComments: Object.freeze([]),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
    propertyLookahead: true,
    hexColor: true,
    atRules: true,
    customProperty: true,
  }),

  html: MARKUP_CONFIG,
  xml: MARKUP_CONFIG,
  vue: MARKUP_CONFIG,
  svelte: MARKUP_CONFIG,

  python: makeConfig({
    keywords: words(
      'and as assert async await break class continue def del elif else except finally for from global if import ' +
        'in is lambda nonlocal not or pass raise return try while with yield match case',
    ),
    types: words(
      'int float complex str bool list dict set tuple bytes bytearray object type Any Optional List Dict Tuple ' +
        'Callable Union Iterable Iterator Sequence Mapping MutableMapping Awaitable Coroutine',
    ),
    constants: words('True False None NotImplemented Ellipsis __name__ __file__ __doc__'),
    lineComments: Object.freeze(['#']),
    stringDefs: STRINGS_PY,
  }),

  go: makeConfig({
    keywords: words(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map ' +
        'package range return select struct switch type var',
    ),
    types: words(
      'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 ' +
        'uint16 uint32 uint64 uintptr any',
    ),
    constants: words('true false nil iota'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: Object.freeze([
      literal('`', '`', false, true),
      literal('"', '"', true, false),
      literal("'", "'", true, false),
    ]),
  }),

  rust: makeConfig({
    keywords: words(
      'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod ' +
        'move mut pub ref return self Self static struct super trait true type unsafe use where while yield',
    ),
    types: words(
      'bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec Option Result Box Rc ' +
        'Arc HashMap HashSet BTreeMap BTreeSet',
    ),
    constants: words('true false None Some Ok Err'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
  }),

  java: makeConfig({
    keywords: words(
      'abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
        'final finally float for goto if implements import instanceof int interface long native new package private ' +
        'protected public return short static strictfp super switch synchronized this throw throws transient try ' +
        'void volatile while var record sealed permits yield',
    ),
    types: words(
      'String Object List Map Set Integer Long Double Boolean Character Byte Short Float Optional Stream ' +
        'ArrayList HashMap HashSet StringBuilder Exception RuntimeException',
    ),
    constants: words('true false null'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
  }),

  kotlin: makeConfig({
    keywords: words(
      'as break class continue do else false for fun if in interface is null object package return super this ' +
        'throw true try typealias typeof val var when while by catch constructor delegate dynamic field file ' +
        'finally get import init param set where actual abstract annotation companion const crossinline data enum ' +
        'expect external final infix inline inner internal lateinit noinline open operator out override private ' +
        'protected public reified sealed suspend tailrec vararg',
    ),
    types: words(
      'Int Long Short Byte Double Float Boolean Char String Any Unit Nothing Array List Map Set MutableList ' +
        'MutableMap MutableSet Pair Triple Sequence',
    ),
    constants: words('true false null'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
  }),

  swift: makeConfig({
    keywords: words(
      'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator ' +
        'private protocol public rethrows static struct subscript typealias var break case continue default defer ' +
        'do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self ' +
        'Self throw throws true try async await some any',
    ),
    types: words(
      'Int Double Float String Bool Character Array Dictionary Set Optional Result AnyObject Void UInt Int8 Int16 ' +
        'Int32 Int64 Date URL',
    ),
    constants: words('true false nil'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
  }),

  c: makeConfig({
    keywords: words(
      'auto break case const continue default do else enum extern for goto if inline register restrict return ' +
        'sizeof static struct switch typedef union volatile while _Alignas _Atomic _Bool _Complex _Generic ' +
        '_Imaginary _Noreturn _Static_assert _Thread_local',
    ),
    types: words('char double float int long short signed unsigned void size_t ssize_t FILE bool int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t'),
    constants: words('NULL true false'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
  }),

  cpp: makeConfig({
    keywords: words(
      'alignas alignof and asm auto break case catch class concept const consteval constexpr constinit const_cast ' +
        'continue co_await co_return co_yield decltype default delete do dynamic_cast else enum explicit export ' +
        'extern for friend goto if inline mutable namespace new noexcept operator or private protected public ' +
        'register reinterpret_cast requires return sizeof static static_assert static_cast struct switch template ' +
        'this thread_local throw try typedef typeid typename union using virtual volatile while',
    ),
    types: words(
      'bool char char8_t char16_t char32_t double float int long short signed unsigned void size_t string vector ' +
        'map unordered_map set unordered_set unique_ptr shared_ptr weak_ptr optional variant function',
    ),
    constants: words('true false nullptr NULL'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: Object.freeze([literal('"', '"', true, false), literal("'", "'", true, false)]),
  }),

  csharp: makeConfig({
    keywords: words(
      'abstract as async await base break case catch checked class const continue default delegate do else enum ' +
        'event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace ' +
        'new operator out override params private protected public readonly ref return sealed sizeof stackalloc ' +
        'static struct switch this throw try typeof unchecked unsafe using virtual volatile while var record ' +
        'get set init value yield where partial',
    ),
    types: words(
      'bool byte char decimal double float int long object sbyte short string uint ulong ushort void ' +
        'String Object List Dictionary HashSet DateTime Task Action Func',
    ),
    constants: words('true false null'),
    lineComments: Object.freeze(['//']),
    blockComments: COMMENT_SLASH,
    stringDefs: STRINGS_C,
  }),

  ruby: makeConfig({
    keywords: words(
      'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not ' +
        'or redo rescue retry return self super then true undef unless until when while yield require require_relative ' +
        'attr_accessor attr_reader attr_writer include extend prepend raise lambda proc loop',
    ),
    types: words('String Integer Float Array Hash Symbol Range Proc Object Class Module Struct'),
    constants: words('true false nil'),
    lineComments: Object.freeze(['#']),
    stringDefs: STRINGS_C_MULTILINE,
    variablePrefix: '@',
  }),

  php: makeConfig({
    keywords: words(
      'abstract and array as break callable case catch class clone const continue declare default do echo else ' +
        'elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach ' +
        'function global goto if implements include include_once instanceof insteadof interface isset list match ' +
        'namespace new null or print private protected public readonly require require_once return static switch ' +
        'throw trait try unset use var while xor yield true false',
    ),
    types: words('int float string bool array object iterable mixed void never self parent static'),
    constants: words('true false null'),
    lineComments: Object.freeze(['//', '#']),
    blockComments: COMMENT_SLASH,
    stringDefs: Object.freeze([
      literal('"""', '"""', true, true),
      literal("'''", "'''", true, true),
      literal('"', '"', true, true),
      literal("'", "'", true, true),
    ]),
    variablePrefix: '$',
  }),

  shell: makeConfig({
    keywords: words(
      'if then else elif fi for in do done while until case esac function select time coproc local export readonly ' +
        'return break continue shift source alias unset set trap eval exec exit test',
    ),
    functions: words(
      'echo printf cd pwd read cat grep sed awk find mkdir rmdir rm cp mv ls chmod chown chgrp curl wget git npm ' +
        'node kill sleep head tail sort uniq xargs tee touch ln tar gzip sudo env which command type',
    ),
    constants: words('true false'),
    lineComments: Object.freeze(['#']),
    stringDefs: STRINGS_SHELL,
    variablePrefix: '$',
  }),

  powershell: makeConfig({
    keywords: words(
      'begin break catch class continue data define do dynamicparam else elseif end exit filter finally for foreach ' +
        'from function if in param process return switch throw trap try until using var while workflow',
    ),
    functions: words(
      'Write-Host Write-Output Write-Error Get-Item Get-ChildItem Get-Content Set-Content New-Item Remove-Item ' +
        'Test-Path Join-Path Select-Object Where-Object ForEach-Object Sort-Object Measure-Object',
    ),
    constants: words('true false null'),
    lineComments: Object.freeze(['#']),
    blockComments: Object.freeze([block('<#', '#>')]),
    stringDefs: STRINGS_C,
    variablePrefix: '$',
  }),

  yaml: makeConfig({
    keywords: words('yes no on off'),
    constants: words('true false null yes no on off'),
    lineComments: Object.freeze(['#']),
    stringDefs: STRINGS_YAML,
    propertyLookahead: true,
  }),

  toml: makeConfig({
    keywords: words('true false'),
    constants: words('true false'),
    lineComments: Object.freeze(['#']),
    stringDefs: Object.freeze([
      literal('"""', '"""', true, true),
      literal("'''", "'''", true, true),
      literal('"', '"', true, false),
      literal("'", "'", false, false),
    ]),
    propertyLookaheadEquals: true,
    sectionBrackets: true,
  }),

  ini: makeConfig({
    constants: words('true false null'),
    lineComments: Object.freeze([';', '#']),
    stringDefs: STRINGS_C,
    propertyLookaheadEquals: true,
    sectionBrackets: true,
  }),

  sql: makeConfig({
    keywords: words(
      'select from where and or not insert into values update set delete create table drop alter add primary key ' +
        'foreign references unique index view join inner left right outer full cross on as group by order having ' +
        'limit offset union all distinct case when then else end exists in between like is null asc desc with ' +
        'returning cascade constraint default check begin commit rollback transaction if function procedure trigger ' +
        'database schema varchar integer int bigint smallint boolean text date timestamp numeric decimal float ' +
        'double char serial',
    ),
    constants: words('null true false'),
    lineComments: Object.freeze(['--']),
    blockComments: COMMENT_SLASH,
    stringDefs: Object.freeze([literal("'", "'", false, false), literal('"', '"', false, false)]),
    caseInsensitive: true,
  }),

  graphql: makeConfig({
    keywords: words(
      'query mutation subscription fragment on type interface union enum input scalar schema directive extend ' +
        'implements repeatable',
    ),
    types: words('String Int Float Boolean ID'),
    constants: words('true false null'),
    lineComments: Object.freeze(['#']),
    blockComments: Object.freeze([]),
    stringDefs: STRINGS_DOUBLE,
    propertyLookahead: true,
  }),
});

// ─── plain fallback ─────────────────────────────────────────────────────────

/**
 * @param {string} code - source text.
 * @returns {Array<Array<Array<string>>>} one plain segment per non-empty line.
 */
function plainHighlightLines(code) {
  const lines = code.split('\n');
  const out = new Array(lines.length);
  for (let index = 0; index < lines.length; index = index + 1) {
    out[index] = lines[index].length === 0 ? [] : [['plain', lines[index]]];
  }
  return out;
}

/**
 * Canonicalise a Host language value (or an extension-ish alias).
 * @param {unknown} language - language chip value.
 * @returns {string} one of the canonical ids, `text` when unknown.
 */
function normalizeLanguage(language) {
  if (typeof language !== 'string') return 'text';
  const key = language.trim().toLowerCase().replace(/^\./, '');
  const mapped = HIGHLIGHT_LANGUAGES[key];
  return typeof mapped === 'string' ? mapped : 'text';
}

// ─── scanner state ──────────────────────────────────────────────────────────

/** One line-to-line carrier of open block comments / strings / markup tags. */
function createScanState() {
  return {
    blockEnd: null,
    stringEnd: null,
    stringKind: 'string',
    inTag: false,
    fence: null,
    fenceConfig: null,
    fenceMarkup: false,
    fenceState: null,
  };
}

// ─── word classification ────────────────────────────────────────────────────

/**
 * Decide the kind of a bare word using the language word tables and the
 * two lookaheads the contract asks for (call -> function, JSON/CSS/YAML key ->
 * property).
 * @param {string} word - identifier text.
 * @param {string} line - full source line.
 * @param {number} after - index just past the identifier.
 * @param {object} config - language config.
 * @returns {string} segment kind.
 */
function classifyWord(word, line, after, config) {
  const key = config.caseInsensitive === true ? word.toLowerCase() : word;
  if (config.keywords[key] === true) return 'keyword';
  if (config.constants[key] === true) return 'constant';
  if (config.types[key] === true) return 'type';
  if (config.functions[key] === true) return 'function';
  const next = skipSpaces(line, after);
  if (next < line.length) {
    const code = line.charCodeAt(next);
    if (config.propertyLookahead === true && code === 58) return 'property';
    if (config.propertyLookaheadEquals === true && code === 61) return 'property';
    if (code === 40) return 'function';
  }
  return 'variable';
}

// ─── numbers ────────────────────────────────────────────────────────────────

/**
 * Consume one numeric literal (decimal, hex, binary, octal, float, exponent).
 * @param {string} line - source line.
 * @param {number} start - index of the first digit (or the dot of `.5`).
 * @param {Function} push - segment sink.
 * @returns {number} index just past the literal.
 */
function scanNumber(line, start, push) {
  const length = line.length;
  let index = start;
  const first = line.charAt(index);
  if (first === '0' && index + 1 < length) {
    const marker = line.charAt(index + 1);
    if (marker === 'x' || marker === 'X') {
      index = index + 2;
      while (index < length && (isHexCode(line.charCodeAt(index)) || line.charCodeAt(index) === 95)) index = index + 1;
      push('number', line.slice(start, index));
      return index;
    }
    if (marker === 'b' || marker === 'B') {
      index = index + 2;
      while (index < length && (line.charCodeAt(index) === 48 || line.charCodeAt(index) === 49 || line.charCodeAt(index) === 95)) index = index + 1;
      push('number', line.slice(start, index));
      return index;
    }
    if (marker === 'o' || marker === 'O') {
      index = index + 2;
      while (index < length && ((line.charCodeAt(index) >= 48 && line.charCodeAt(index) <= 55) || line.charCodeAt(index) === 95)) index = index + 1;
      push('number', line.slice(start, index));
      return index;
    }
  }
  if (first === '.') index = index + 1;
  while (index < length && (isDigitCode(line.charCodeAt(index)) || line.charCodeAt(index) === 95)) index = index + 1;
  if (index < length && line.charCodeAt(index) === 46) {
    index = index + 1;
    while (index < length && (isDigitCode(line.charCodeAt(index)) || line.charCodeAt(index) === 95)) index = index + 1;
  }
  if (index < length && (line.charAt(index) === 'e' || line.charAt(index) === 'E')) {
    let exponent = index + 1;
    if (exponent < length && (line.charAt(exponent) === '+' || line.charAt(exponent) === '-')) exponent = exponent + 1;
    if (exponent < length && isDigitCode(line.charCodeAt(exponent))) {
      index = exponent;
      while (index < length && isDigitCode(line.charCodeAt(index))) index = index + 1;
    }
  }
  push('number', line.slice(start, index));
  return index;
}

// ─── code scanner (all non-markup languages) ────────────────────────────────

/**
 * Tokenize one line of a C-like / word-based language.
 *
 * The scanner is a single left-to-right pass; every character ends up in
 * exactly one segment (the overlay alignment invariant), and adjacent segments
 * of equal kind are merged. Open block comments and multi-line strings survive
 * in `state` across lines.
 *
 * @param {string} line - source line (no trailing newline).
 * @param {object} state - mutable cross-line state.
 * @param {object} config - language config.
 * @returns {Array<Array<string>>} `[kind, text]` segments.
 */
function scanCodeLine(line, state, config) {
  const segments = [];
  let lastKind = null;

  function push(kind, text) {
    if (text.length === 0) return;
    const last = segments.length > 0 ? segments[segments.length - 1] : null;
    if (last !== null && last[0] === kind) last[1] = last[1] + text;
    else segments.push([kind, text]);
    lastKind = kind;
  }

  const length = line.length;
  let index = 0;

  // Resume an open block comment / multi-line string from the previous line.
  if (state.blockEnd !== null) {
    const end = line.indexOf(state.blockEnd, index);
    if (end === -1) {
      push('comment', line);
      return segments;
    }
    push('comment', line.slice(index, end + state.blockEnd.length));
    index = end + state.blockEnd.length;
    state.blockEnd = null;
  }
  if (state.stringEnd !== null) {
    const end = line.indexOf(state.stringEnd, index);
    if (end === -1) {
      push(state.stringKind, line.slice(index));
      return segments;
    }
    push(state.stringKind, line.slice(index, end + state.stringEnd.length));
    index = end + state.stringEnd.length;
    state.stringEnd = null;
  }
  if (index >= length) return segments;

  while (index < length) {
    const code = line.charCodeAt(index);

    // Horizontal whitespace: one plain run.
    if (code === 32 || code === 9) {
      let cursor = index + 1;
      while (cursor < length) {
        const next = line.charCodeAt(cursor);
        if (next !== 32 && next !== 9) break;
        cursor = cursor + 1;
      }
      push('plain', line.slice(index, cursor));
      index = cursor;
      continue;
    }

    let matched = false;

    // Line comments.
    for (let slot = 0; slot < config.lineComments.length; slot = slot + 1) {
      const prefix = config.lineComments[slot];
      if (!line.startsWith(prefix, index)) continue;
      // `http://…` inside a URL value: the `:` was an operator, not a comment.
      if (prefix === '//' && lastKind === 'operator') continue;
      push('comment', line.slice(index));
      index = length;
      matched = true;
      break;
    }
    if (matched) break;

    // Block comments.
    for (let slot = 0; slot < config.blockComments.length; slot = slot + 1) {
      const marker = config.blockComments[slot];
      if (!line.startsWith(marker.open, index)) continue;
      const end = line.indexOf(marker.close, index + marker.open.length);
      if (end === -1) {
        push('comment', line.slice(index));
        state.blockEnd = marker.close;
        index = length;
      } else {
        push('comment', line.slice(index, end + marker.close.length));
        index = end + marker.close.length;
      }
      matched = true;
      break;
    }
    if (matched) {
      if (index >= length) break;
      continue;
    }

    // String literals.
    for (let slot = 0; slot < config.stringDefs.length; slot = slot + 1) {
      const def = config.stringDefs[slot];
      if (!line.startsWith(def.open, index)) continue;
      let cursor = index + def.open.length;
      let closed = false;
      while (cursor < length) {
        if (def.escape === true && line.charCodeAt(cursor) === 92) {
          cursor = cursor + 2;
          continue;
        }
        if (line.startsWith(def.close, cursor)) {
          cursor = cursor + def.close.length;
          closed = true;
          break;
        }
        cursor = cursor + 1;
      }
      if (closed === false) {
        push(def.kind, line.slice(index));
        if (def.multiline === true) {
          state.stringEnd = def.close;
          state.stringKind = def.kind;
        }
        index = length;
      } else {
        let kind = def.kind;
        if (config.propertyAfterStrings === true) {
          const next = skipSpaces(line, cursor);
          if (next < length && line.charCodeAt(next) === 58) kind = 'property';
        }
        push(kind, line.slice(index, cursor));
        index = cursor;
      }
      matched = true;
      break;
    }
    if (matched) {
      if (index >= length) break;
      continue;
    }

    // Numbers (including a leading `.5`).
    if (isDigitCode(code) || (code === 46 && isDigitCode(line.charCodeAt(index + 1)))) {
      index = scanNumber(line, index, push);
      continue;
    }

    // CSS hex colour literal; other hash usages fall through to operators.
    if (config.hexColor === true && code === 35) {
      let cursor = index + 1;
      const start = cursor;
      while (cursor < length && isHexCode(line.charCodeAt(cursor)) && cursor - start < 8) cursor = cursor + 1;
      const digits = cursor - start;
      if (digits === 3 || digits === 4 || digits === 6 || digits === 8) {
        push('number', line.slice(index, cursor));
        index = cursor;
        continue;
      }
    }

    // CSS at-rules (`@media`, `@keyframes`).
    if (config.atRules === true && code === 64) {
      let cursor = index + 1;
      while (cursor < length && isIdentPartCode(line.charCodeAt(cursor))) cursor = cursor + 1;
      if (cursor > index + 1) {
        push('keyword', line.slice(index, cursor));
        index = cursor;
        continue;
      }
    }

    // TOML / INI section headers: `[section]`.
    if (config.sectionBrackets === true && code === 91) {
      const end = line.indexOf(']', index + 1);
      if (end !== -1) {
        push('punctuation', '[');
        push('tag', line.slice(index + 1, end));
        push('punctuation', ']');
        index = end + 1;
        continue;
      }
    }

    // `$VAR` / `${VAR}` (shell, PHP, PowerShell).
    if (config.variablePrefix === '$' && code === 36) {
      const nextCode = line.charCodeAt(index + 1);
      if (nextCode === 123) {
        const end = line.indexOf('}', index + 2);
        if (end !== -1) {
          push('variable', line.slice(index, end + 1));
          index = end + 1;
          continue;
        }
      }
      if (isIdentStartCode(nextCode)) {
        let cursor = index + 1;
        while (cursor < length && isIdentPartCode(line.charCodeAt(cursor))) cursor = cursor + 1;
        push('variable', line.slice(index, cursor));
        index = cursor;
        continue;
      }
    }

    // Ruby instance / class variables: `@name`.
    if (config.variablePrefix === '@' && code === 64) {
      let cursor = index + 1;
      if (line.charCodeAt(cursor) === 64) cursor = cursor + 1;
      if (isIdentStartCode(line.charCodeAt(cursor))) {
        while (cursor < length && isIdentPartCode(line.charCodeAt(cursor))) cursor = cursor + 1;
        push('variable', line.slice(index, cursor));
        index = cursor;
        continue;
      }
    }

    // CSS custom properties: `--brand-color`.
    if (config.customProperty === true && code === 45 && line.charCodeAt(index + 1) === 45) {
      let cursor = index + 2;
      while (cursor < length) {
        const next = line.charCodeAt(cursor);
        if (isIdentPartCode(next) || next === 45) cursor = cursor + 1;
        else break;
      }
      const next = skipSpaces(line, cursor);
      push(next < length && line.charCodeAt(next) === 58 ? 'property' : 'variable', line.slice(index, cursor));
      index = cursor;
      continue;
    }

    // Identifiers / words.
    if (isIdentStartCode(code)) {
      let cursor = index + 1;
      while (cursor < length && isIdentPartCode(line.charCodeAt(cursor))) cursor = cursor + 1;
      const word = line.slice(index, cursor);
      push(classifyWord(word, line, cursor, config), word);
      index = cursor;
      continue;
    }

    // Operators (longest match wins), then punctuation, then bare plain text.
    let operator = null;
    for (let slot = 0; slot < CODE_OPERATORS.length; slot = slot + 1) {
      if (line.startsWith(CODE_OPERATORS[slot], index)) {
        operator = CODE_OPERATORS[slot];
        break;
      }
    }
    if (operator !== null) {
      push('operator', operator);
      index = index + operator.length;
      continue;
    }
    const char = line.charAt(index);
    if (CODE_PUNCTUATION.indexOf(char) !== -1) {
      push('punctuation', char);
      index = index + 1;
      continue;
    }
    if (CODE_OPERATOR_CHARS.indexOf(char) !== -1) {
      push('operator', char);
      index = index + 1;
      continue;
    }
    push('plain', char);
    index = index + 1;
  }

  return segments;
}

// ─── markup scanner (html / xml / vue / svelte) ─────────────────────────────

/**
 * Consume the attribute body of a tag until its closing `>`.
 * @param {string} line - source line.
 * @param {number} start - index just past the tag name.
 * @param {object} state - mutable state (`inTag` survives line ends).
 * @param {Function} push - segment sink.
 * @returns {number} index to continue scanning at.
 */
function scanTagBody(line, start, state, push) {
  const length = line.length;
  let index = start;
  while (index < length) {
    const code = line.charCodeAt(index);
    if (code === 32 || code === 9) {
      let cursor = index + 1;
      while (cursor < length) {
        const next = line.charCodeAt(cursor);
        if (next !== 32 && next !== 9) break;
        cursor = cursor + 1;
      }
      push('plain', line.slice(index, cursor));
      index = cursor;
      continue;
    }
    const char = line.charAt(index);
    if (char === '>') {
      push('punctuation', '>');
      state.inTag = false;
      return index + 1;
    }
    if (char === '/' && line.charAt(index + 1) === '>') {
      push('punctuation', '/>');
      state.inTag = false;
      return index + 2;
    }
    if (char === '=') {
      push('operator', '=');
      index = index + 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const close = char;
      let cursor = index + 1;
      while (cursor < length && line.charAt(cursor) !== close) cursor = cursor + 1;
      if (cursor < length) {
        push('string', line.slice(index, cursor + 1));
        index = cursor + 1;
        continue;
      }
      push('string', line.slice(index));
      state.inTag = true;
      return length;
    }
    if (isIdentStartCode(code)) {
      let cursor = index + 1;
      while (cursor < length && isAttrPartCode(line.charCodeAt(cursor))) cursor = cursor + 1;
      push('attr', line.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (char === '<') {
      state.inTag = false;
      return index;
    }
    push('operator', char);
    index = index + 1;
  }
  state.inTag = true;
  return index;
}

/**
 * Tokenize one line of markup: comments, declarations, tags with attributes,
 * entities, and plain character data.
 * @param {string} line - source line.
 * @param {object} state - mutable cross-line state.
 * @returns {Array<Array<string>>} segments.
 */
function scanMarkupLine(line, state) {
  const segments = [];
  function push(kind, text) {
    if (text.length === 0) return;
    const last = segments.length > 0 ? segments[segments.length - 1] : null;
    if (last !== null && last[0] === kind) last[1] = last[1] + text;
    else segments.push([kind, text]);
  }

  const length = line.length;
  let index = 0;

  if (state.blockEnd !== null) {
    const end = line.indexOf(state.blockEnd, index);
    if (end === -1) {
      push('comment', line);
      return segments;
    }
    push('comment', line.slice(index, end + state.blockEnd.length));
    index = end + state.blockEnd.length;
    state.blockEnd = null;
  }
  if (state.inTag === true) {
    index = scanTagBody(line, index, state, push);
    if (state.inTag === true) return segments;
  }

  while (index < length) {
    if (line.startsWith('<!--', index)) {
      const end = line.indexOf('-->', index + 4);
      if (end === -1) {
        push('comment', line.slice(index));
        state.blockEnd = '-->';
        index = length;
      } else {
        push('comment', line.slice(index, end + 3));
        index = end + 3;
      }
      continue;
    }
    if (line.startsWith('<![CDATA[', index)) {
      const end = line.indexOf(']]>', index + 9);
      if (end === -1) {
        push('meta', line.slice(index));
        index = length;
      } else {
        push('meta', line.slice(index, end + 3));
        index = end + 3;
      }
      continue;
    }
    if (line.startsWith('<?', index)) {
      const end = line.indexOf('?>', index + 2);
      if (end === -1) {
        push('meta', line.slice(index));
        index = length;
      } else {
        push('meta', line.slice(index, end + 2));
        index = end + 2;
      }
      continue;
    }
    if (line.startsWith('<!', index)) {
      const end = line.indexOf('>', index + 2);
      if (end === -1) {
        push('meta', line.slice(index));
        index = length;
      } else {
        push('meta', line.slice(index, end + 1));
        index = end + 1;
      }
      continue;
    }
    if (line.charAt(index) === '<') {
      let cursor = index + 1;
      let closing = false;
      if (line.charAt(cursor) === '/') {
        closing = true;
        cursor = cursor + 1;
      }
      if (isIdentStartCode(line.charCodeAt(cursor))) {
        push('punctuation', line.slice(index, cursor));
        const nameStart = cursor;
        while (cursor < length && isAttrPartCode(line.charCodeAt(cursor))) cursor = cursor + 1;
        push('tag', line.slice(nameStart, cursor));
        state.inTag = true;
        index = scanTagBody(line, cursor, state, push);
        if (state.inTag === true) return segments;
        if (closing === true) continue;
        continue;
      }
      push('plain', '<');
      index = index + 1;
      continue;
    }

    // Plain character data up to the next tag / entity.
    let cursor = index;
    while (cursor < length && line.charAt(cursor) !== '<' && line.charAt(cursor) !== '&') cursor = cursor + 1;
    if (cursor > index) push('plain', line.slice(index, cursor));
    if (cursor < length && line.charAt(cursor) === '&') {
      const semi = line.indexOf(';', cursor + 1);
      if (semi !== -1 && semi - cursor <= 12) {
        push('constant', line.slice(cursor, semi + 1));
        index = semi + 1;
      } else {
        push('plain', '&');
        index = cursor + 1;
      }
    } else {
      index = cursor;
    }
  }

  return segments;
}

// ─── markdown scanner ───────────────────────────────────────────────────────

/**
 * Classify inline markdown spans from `start` to the end of the line.
 * @param {string} line - source line.
 * @param {number} start - first index to classify.
 * @param {Function} push - segment sink.
 */
function scanMarkdownInline(line, start, push) {
  const length = line.length;
  let index = start;
  while (index < length) {
    const char = line.charAt(index);
    if (char === '\\' && index + 1 < length) {
      push('plain', line.slice(index, index + 2));
      index = index + 2;
      continue;
    }
    if (char === '`') {
      let run = 1;
      while (line.charAt(index + run) === '`') run = run + 1;
      const marker = line.slice(index, index + run);
      const end = line.indexOf(marker, index + run);
      if (end !== -1) {
        push('string', line.slice(index, end + run));
        index = end + run;
      } else {
        push('plain', line.slice(index, index + run));
        index = index + run;
      }
      continue;
    }
    if (char === '*' || char === '_') {
      let run = 1;
      while (line.charAt(index + run) === char && run < 3) run = run + 1;
      const marker = line.slice(index, index + run);
      const end = line.indexOf(marker, index + run);
      if (end !== -1 && end > index + run) {
        push(run >= 2 ? 'constant' : 'meta', line.slice(index, end + run));
        index = end + run;
      } else {
        push('plain', marker);
        index = index + run;
      }
      continue;
    }
    if (char === '!' && line.charAt(index + 1) === '[') {
      push('operator', '!');
      index = index + 1;
      continue;
    }
    if (char === '[') {
      const close = line.indexOf(']', index + 1);
      if (close !== -1 && line.charAt(close + 1) === '(') {
        const closeParen = line.indexOf(')', close + 2);
        if (closeParen !== -1) {
          push('punctuation', '[');
          push('variable', line.slice(index + 1, close));
          push('punctuation', '](');
          push('string', line.slice(close + 2, closeParen));
          push('punctuation', ')');
          index = closeParen + 1;
          continue;
        }
      }
      push('plain', '[');
      index = index + 1;
      continue;
    }
    if (char === '<') {
      const end = line.indexOf('>', index + 1);
      if (end !== -1) {
        push('tag', line.slice(index, end + 1));
        index = end + 1;
        continue;
      }
    }
    if (char === '&') {
      const semi = line.indexOf(';', index + 1);
      if (semi !== -1 && semi - index <= 12) {
        push('constant', line.slice(index, semi + 1));
        index = semi + 1;
        continue;
      }
    }
    let cursor = index + 1;
    while (cursor < length && '\\`*_![<&'.indexOf(line.charAt(cursor)) === -1) cursor = cursor + 1;
    push('plain', line.slice(index, cursor));
    index = cursor;
  }
}

/**
 * Tokenize one markdown line, including fenced code blocks (whose content is
 * highlighted with the fence info string's language when it is known).
 * @param {string} line - source line.
 * @param {object} state - mutable fence state.
 * @returns {Array<Array<string>>} segments.
 */
function scanMarkdownLine(line, state) {
  const segments = [];
  function push(kind, text) {
    if (text.length === 0) return;
    const last = segments.length > 0 ? segments[segments.length - 1] : null;
    if (last !== null && last[0] === kind) last[1] = last[1] + text;
    else segments.push([kind, text]);
  }

  if (state.fence !== null) {
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
    if (close !== null && close[1].charAt(0) === state.fence.charAt(0) && close[1].length >= state.fence.length) {
      push('meta', line);
      state.fence = null;
      state.fenceConfig = null;
      state.fenceMarkup = false;
      state.fenceState = null;
      return segments;
    }
    if (state.fenceConfig !== null && state.fenceConfig !== undefined) {
      if (state.fenceMarkup === true) return scanMarkupLine(line, state.fenceState);
      return scanCodeLine(line, state.fenceState, state.fenceConfig);
    }
    push('plain', line);
    return segments;
  }

  const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (fence !== null) {
    push('meta', line);
    state.fence = fence[1];
    const info = fence[2].trim().split(/\s+/)[0];
    const inner = typeof info === 'string' && info.length > 0 ? normalizeLanguage(info) : 'text';
    const innerConfig = inner !== 'text' && inner !== 'markdown' ? LANGUAGE_CONFIGS[inner] : undefined;
    state.fenceConfig = innerConfig === undefined ? null : innerConfig;
    state.fenceMarkup = innerConfig !== undefined && innerConfig.markup === true;
    state.fenceState = createScanState();
    return segments;
  }

  const heading = /^(\s{0,3})(#{1,6})(\s+)/.exec(line);
  if (heading !== null) {
    push('plain', heading[1]);
    push('keyword', heading[2]);
    push('plain', heading[3]);
    scanMarkdownInline(line, heading[0].length, push);
    return segments;
  }

  const rule = /^(\s{0,3})([-*_])(?:\s*\2){2,}\s*$/.exec(line);
  if (rule !== null) {
    push('meta', line);
    return segments;
  }

  const quote = /^(\s{0,3})(>\s?)/.exec(line);
  if (quote !== null) {
    push('plain', quote[1]);
    push('comment', quote[2]);
    scanMarkdownInline(line, quote[0].length, push);
    return segments;
  }

  const list = /^(\s*)([-*+]|\d{1,3}[.)])(\s+)/.exec(line);
  if (list !== null) {
    push('plain', list[1]);
    push('keyword', list[2]);
    push('plain', list[3]);
    scanMarkdownInline(line, list[0].length, push);
    return segments;
  }

  scanMarkdownInline(line, 0, push);
  return segments;
}

// ─── public entry point ─────────────────────────────────────────────────────

/**
 * Highlight source text for the editor overlay.
 *
 * The result has exactly one entry per `\n`-separated line (and `[]` for an
 * empty source). Each entry concatenates back to that source line exactly.
 *
 * @param {unknown} code - source text.
 * @param {unknown} language - Host language chip / alias.
 * @returns {Array<Array<Array<string>>>} per-line `[kind, text]` segments.
 */
function highlightLines(code, language) {
  if (typeof code !== 'string' || code.length === 0) return [];
  const id = normalizeLanguage(language);
  const config = LANGUAGE_CONFIGS[id];
  if (id === 'text' || config === undefined || code.length > MAX_HIGHLIGHT_CHARS) return plainHighlightLines(code);

  const lines = code.split('\n');
  const out = new Array(lines.length);
  const state = createScanState();
  for (let index = 0; index < lines.length; index = index + 1) {
    const line = lines[index];
    if (config.markdown === true) out[index] = scanMarkdownLine(line, state);
    else if (config.markup === true) out[index] = scanMarkupLine(line, state);
    else out[index] = scanCodeLine(line, state, config);
  }
  return out;
}

S.MAX_HIGHLIGHT_CHARS = MAX_HIGHLIGHT_CHARS;
S.HIGHLIGHT_KINDS = HIGHLIGHT_KINDS;
S.HIGHLIGHT_LANGUAGES = HIGHLIGHT_LANGUAGES;
S.normalizeHighlightLanguage = normalizeLanguage;
S.highlightLines = highlightLines;
S.highlightColor = function highlightColor(kind) {
  return typeof S.SYN === 'object' && S.SYN !== null && typeof S.SYN[kind] === 'string' ? S.SYN[kind] : 'inherit';
};
