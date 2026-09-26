import type ExcelJS from 'exceljs';

/**
 * テスト用: 出勤簿の書き出しに使う範囲の Excel の式(IF・AND・OR・COUNT・MAX・MIN・TIME・ROUND・SEARCH・ISNUMBER・
 * INT・SUM・SUMIFS と四則演算・比較)を、書き出した .xlsx のシートの上で計算する小さな評価器。
 * 書き出した式そのものを計算して、アプリの計算(attendanceCalc.ts)と同じ値になることを CI でも確かめるために使う
 * (LibreOffice のある環境では attendanceWorkbook.libreoffice.test.ts が本物の表計算ソフトでも確かめる)。
 * 空のセルは Excel と同じく、計算では 0、文字との比較では '' として扱う。
 */

type Scalar = number | string | boolean | null;
class FormulaError {
  constructor(readonly code: string) {}
}
type Value = Scalar | FormulaError | { range: Scalar[] } | { ref: Scalar };

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; v: string }
  | { t: 'range'; from: string; to: string }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: string }
  | { t: '(' | ')' | ',' };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const cellRef = /^\$?([A-Z]{1,3})\$?(\d+)/;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      tokens.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (num) {
      tokens.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const ref = cellRef.exec(src.slice(i));
    if (ref && !/^[A-Z]+\(/.test(src.slice(i))) {
      const first = `${ref[1]}${ref[2]}`;
      i += ref[0].length;
      if (src[i] === ':') {
        const second = cellRef.exec(src.slice(i + 1));
        if (!second) throw new Error(`範囲の書き方が不正です: ${src}`);
        tokens.push({ t: 'range', from: first, to: `${second[1]}${second[2]}` });
        i += 1 + second[0].length;
      } else {
        tokens.push({ t: 'ref', v: first });
      }
      continue;
    }
    const fn = /^[A-Z]+(?=\()/.exec(src.slice(i));
    if (fn) {
      tokens.push({ t: 'fn', v: fn[0] });
      i += fn[0].length;
      continue;
    }
    const op = /^(<=|>=|<>|[+\-*/&=<>])/.exec(src.slice(i));
    if (op) {
      tokens.push({ t: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push({ t: ch });
      i++;
      continue;
    }
    throw new Error(`読めない文字です: ${ch} (${src})`);
  }
  return tokens;
}

type Node =
  | { k: 'lit'; v: Scalar }
  | { k: 'ref'; v: string }
  | { k: 'range'; from: string; to: string }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'neg'; a: Node };

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (...ops: string[]) => {
    const tk = peek();
    return tk?.t === 'op' && ops.includes(tk.v);
  };
  const expect = (t: Token['t']) => {
    if (peek()?.t !== t) throw new Error(`${t} が必要です`);
    pos++;
  };
  const primary = (): Node => {
    const tk = tokens[pos++];
    if (!tk) throw new Error('式が途中で終わっています');
    if (tk.t === 'num' || tk.t === 'str') return { k: 'lit', v: tk.v };
    if (tk.t === 'ref') return { k: 'ref', v: tk.v };
    if (tk.t === 'range') return { k: 'range', from: tk.from, to: tk.to };
    if (tk.t === 'op' && tk.v === '-') return { k: 'neg', a: primary() };
    if (tk.t === '(') {
      const e = comparison();
      expect(')');
      return e;
    }
    if (tk.t === 'fn') {
      expect('(');
      const args: Node[] = [];
      if (peek()?.t !== ')') {
        args.push(comparison());
        while (peek()?.t === ',') {
          pos++;
          args.push(comparison());
        }
      }
      expect(')');
      return { k: 'call', fn: tk.v, args };
    }
    throw new Error(`思わぬ字句です: ${JSON.stringify(tk)}`);
  };
  const binary = (next: () => Node, ops: string[]) => (): Node => {
    let a = next();
    while (isOp(...ops)) {
      const op = (tokens[pos++] as { v: string }).v;
      a = { k: 'bin', op, a, b: next() };
    }
    return a;
  };
  const term = binary(primary, ['*', '/']);
  const additive = binary(term, ['+', '-']);
  const concat = binary(additive, ['&']);
  const comparison = binary(concat, ['=', '<>', '<', '>', '<=', '>=']);
  const root = comparison();
  if (pos !== tokens.length) throw new Error('式の終わりに余分な字句があります');
  return root;
}

const colNumber = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const splitRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`セルの番地が不正です: ${ref}`);
  return { col: colNumber(m[1] as string), row: Number(m[2]) };
};

/** Excel の ROUND(0から遠い方へ丸める。2進の誤差で 0.5 未満になった値も補う)。 */
function excelRound(x: number, digits: number): number {
  const f = 10 ** digits;
  const scaled = Math.abs(x) * f;
  return (Math.sign(x) * Math.round(scaled + 1e-9)) / f;
}

/** シート ws の式を計算する(式のセルを参照していれば、その式も計算する)。 */
export function createFormulaEvaluator(ws: ExcelJS.Worksheet) {
  const cache = new Map<string, Scalar | FormulaError>();

  const cellValue = (ref: string): Scalar | FormulaError => {
    const cached = cache.get(ref);
    if (cached !== undefined) return cached;
    const raw = ws.getCell(ref).value as unknown;
    let result: Scalar | FormulaError;
    if (raw && typeof raw === 'object' && 'formula' in raw) {
      result = evaluate((raw as { formula: string }).formula);
    } else if (raw instanceof Date) {
      result = raw.getTime() / 86_400_000 + 25_569; // Excel の日付の値(1900年方式)
    } else if (raw === undefined || raw === null || raw === '') {
      result = null;
    } else {
      result = raw as Scalar;
    }
    cache.set(ref, result);
    return result;
  };

  const rangeValues = (from: string, to: string): Scalar[] => {
    const a = splitRef(from);
    const b = splitRef(to);
    const values: Scalar[] = [];
    for (let row = a.row; row <= b.row; row++) {
      for (let col = a.col; col <= b.col; col++) {
        const v = cellValue(`${colLetters(col)}${row}`);
        values.push(v instanceof FormulaError ? null : v);
      }
    }
    return values;
  };

  const toNumber = (v: Scalar | FormulaError): number | FormulaError => {
    if (v instanceof FormulaError) return v;
    if (v === null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return v;
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) ? n : new FormulaError('#VALUE!');
  };

  const scalar = (v: Value): Scalar | FormulaError => {
    if (v instanceof FormulaError) return v;
    if (v && typeof v === 'object' && 'ref' in v) return v.ref;
    if (v && typeof v === 'object' && 'range' in v) return new FormulaError('#VALUE!');
    return v as Scalar;
  };

  /** 引数の数(MAX・MIN・SUM・COUNT 用)。参照・範囲の中の数以外は数えない。直接の値は数にする。 */
  const numbersOf = (args: Value[], strict: boolean): number[] | FormulaError => {
    const out: number[] = [];
    for (const arg of args) {
      if (arg instanceof FormulaError) return arg;
      if (arg && typeof arg === 'object' && 'range' in arg) {
        for (const v of arg.range) if (typeof v === 'number') out.push(v);
      } else if (arg && typeof arg === 'object' && 'ref' in arg) {
        if (typeof arg.ref === 'number') out.push(arg.ref);
      } else {
        const n = toNumber(arg as Scalar);
        if (n instanceof FormulaError) {
          if (strict) return n;
        } else out.push(n);
      }
    }
    return out;
  };

  const compare = (a: Scalar, b: Scalar, op: string): boolean => {
    const norm = (x: Scalar, other: Scalar): Scalar =>
      x === null ? (typeof other === 'string' ? '' : 0) : x;
    const x = norm(a, b);
    const y = norm(b, a);
    const cmp =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).toLowerCase().localeCompare(String(y).toLowerCase());
    switch (op) {
      case '=':
        return typeof x === typeof y && cmp === 0;
      case '<>':
        return !(typeof x === typeof y && cmp === 0);
      case '<':
        return cmp < 0;
      case '>':
        return cmp > 0;
      case '<=':
        return cmp <= 0;
      default:
        return cmp >= 0;
    }
  };

  const truthy = (v: Scalar | FormulaError): boolean | FormulaError => {
    const n = toNumber(v);
    return n instanceof FormulaError ? n : n !== 0;
  };

  const call = (fn: string, nodes: Node[]): Value => {
    const args = () => nodes.map(evalNode);
    switch (fn) {
      case 'IF': {
        const c = truthy(scalar(evalNode(nodes[0] as Node)));
        if (c instanceof FormulaError) return c;
        return c ? scalar(evalNode(nodes[1] as Node)) : nodes[2] ? scalar(evalNode(nodes[2])) : false;
      }
      case 'AND':
      case 'OR': {
        const values = args().map((v) => truthy(scalar(v)));
        const err = values.find((v) => v instanceof FormulaError);
        if (err) return err;
        return fn === 'AND' ? values.every(Boolean) : values.some(Boolean);
      }
      case 'COUNT': {
        const n = numbersOf(args(), false);
        return n instanceof FormulaError ? 0 : n.length;
      }
      case 'MAX':
      case 'MIN':
      case 'SUM': {
        const n = numbersOf(args(), true);
        if (n instanceof FormulaError) return n;
        if (fn === 'SUM') return n.reduce((s, x) => s + x, 0);
        if (n.length === 0) return 0;
        return fn === 'MAX' ? Math.max(...n) : Math.min(...n);
      }
      case 'TIME': {
        const [h, m, s] = args().map((v) => toNumber(scalar(v))) as number[];
        return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) / 86400;
      }
      case 'ROUND': {
        const [x, d] = args().map((v) => toNumber(scalar(v)));
        if (x instanceof FormulaError) return x;
        return excelRound(x as number, d as number);
      }
      case 'INT': {
        const x = toNumber(scalar(evalNode(nodes[0] as Node)));
        return x instanceof FormulaError ? x : Math.floor(x);
      }
      case 'SEARCH': {
        const [find, text] = args().map(scalar);
        const index = String(text ?? '')
          .toLowerCase()
          .indexOf(String(find ?? '').toLowerCase());
        return index < 0 ? new FormulaError('#VALUE!') : index + 1;
      }
      case 'ISNUMBER':
        return typeof scalar(evalNode(nodes[0] as Node)) === 'number';
      case 'SUMIFS': {
        const [sumRange, criteriaRange, criteria] = args();
        const sums = (sumRange as { range: Scalar[] }).range;
        const keys = (criteriaRange as { range: Scalar[] }).range;
        const key = scalar(criteria as Value);
        return keys.reduce<number>(
          (total, k, i) =>
            k !== null && k === key && typeof sums[i] === 'number' ? total + (sums[i] as number) : total,
          0,
        );
      }
      default:
        throw new Error(`この評価器が知らない関数です: ${fn}`);
    }
  };

  const evalNode = (node: Node): Value => {
    switch (node.k) {
      case 'lit':
        return node.v;
      case 'ref':
        return { ref: cellValue(node.v) as Scalar };
      case 'range':
        return { range: rangeValues(node.from, node.to) };
      case 'neg': {
        const n = toNumber(scalar(evalNode(node.a)));
        return n instanceof FormulaError ? n : -n;
      }
      case 'call':
        return call(node.fn, node.args);
      case 'bin': {
        const a = scalar(evalNode(node.a));
        const b = scalar(evalNode(node.b));
        if (a instanceof FormulaError) return a;
        if (b instanceof FormulaError) return b;
        if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) return compare(a, b, node.op);
        if (node.op === '&') return `${a ?? ''}${b ?? ''}`;
        const x = toNumber(a);
        const y = toNumber(b);
        if (x instanceof FormulaError) return x;
        if (y instanceof FormulaError) return y;
        if (node.op === '+') return x + y;
        if (node.op === '-') return x - y;
        if (node.op === '*') return x * y;
        return y === 0 ? new FormulaError('#DIV/0!') : x / y;
      }
    }
  };

  function evaluate(formula: string): Scalar | FormulaError {
    return scalar(evalNode(parse(tokenize(formula))));
  }

  /** セルの値(式なら計算した値)。計算の誤りは '#VALUE!' などの文字列。 */
  return (ref: string): Scalar => {
    const v = cellValue(ref);
    return v instanceof FormulaError ? v.code : v;
  };
}
