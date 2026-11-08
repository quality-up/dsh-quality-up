'use strict';
/**
 * 统计与 SPC 计算引擎（零第三方依赖）
 * ==================================================================
 * 服务于质量平台的智能体工具层。平台内所有
 * Cpk / 判异 / 假设检验 / MSA 结论都必须由本文件真实计算得出，
 * 智能体不允许凭经验"编"数字。
 *
 * 设计约束：
 *   1. 纯 Node.js 内置能力（只用到 Math），无任何 npm 依赖；
 *   2. 所有函数纯粹：不打印日志、不读写文件、不依赖外部状态；
 *   3. 分布函数采用高精度数值算法（非查表），详见各实现处的注释；
 *   4. 对脏数据（null/undefined/NaN/±Infinity/非数字字符串）统一过滤，
 *      行为明确、绝不抛异常崩溃（见 clean / asNumber / numOrNull）。
 *
 * 数值算法选型（精度均已自测，见 qip-agent/tmp-stats-test）：
 *   - 正态 CDF：Numerical Recipes 的 erfc 有理逼近（|相对误差| < 1.2e-9），
 *     中心区（|x|<0.475）用 erf 泰勒级数，避免尾概率精度丢失。
 *   - 正态分位数：Acklam 有理逼近（中心区 |相对误差| < 1.15e-9）+ 一步 Halley 精修。
 *   - Γ 对数：Lanczos 近似（g=7, n=9，|相对误差| < 1e-15）。
 *   - 不完全 Beta：Lentz 连分式 betacf + betai（Numerical Recipes），
 *     据此实现 tCdf / tInv / fCdf / binomCdf。
 *   - 不完全 Gamma：级数（x < a+1）+ 连分式（x ≥ a+1）的 gammp / gammq，
 *     据此实现 chi2Cdf / chi2Inv / poissonCdf / poissonPmf。
 *   - tInv / chi2Inv 用二分法（收敛到 ~1e-12），fInv 用单调变换 + 二分。
 *
 * 单位与约定：
 *   - 变异系数 cv 返回百分数（%），如 5 表示 5%；
 *   - PPM = 百万分之不良数；yieldPct 为百分数（99.9999 表示 99.9999%）；
 *   - sigmaLevel = 由实际不良率直接反解的正态分位数 Z（不额外加 1.5 偏移），
 *     另附 sigmaLevelShifted = sigmaLevel + 1.5 供"六西格玛"口径引用；
 *   - dpmoToSigma / sigmaToDpmo 则采用业界通行的 1.5σ 偏移口径
 *     （与 Motorola/ASQ 的 Sigma 水平表一致）。
 */

/** 迭代收敛容差 */
const EPS = 1e-14;
/** tInv / chi2Inv 二分的绝对容差 */
const ROOT_EPS = 1e-12;
/** 均值-极差/均值-标准差控制图系数表支持的子组容量范围 */
const CHART_N_MIN = 2;
const CHART_N_MAX = 10;

// ==================================================================
// 0. 基础工具：数据清洗与矩阵运算
// ==================================================================

/** 单值转数字：仅接受有限数值或可完整解析的数字字符串，其余返回 null */
function asNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 单值转整数：接受整数或"整数值的浮点/字符串"（如 2.0、"3"），其余返回 null */
function asInt(v) {
  const n = asNumber(v);
  if (n === null) return null;
  const r = Math.round(n);
  return Math.abs(n - r) <= 1e-9 ? r : null;
}

/** 清洗数值数组：过滤 null/undefined/NaN/±Infinity/不可解析字符串；非数组返回 [] */
function clean(a) {
  if (a == null) return [];
  if (!Array.isArray(a)) {
    const v = asNumber(a);
    return v === null ? [] : [v];
  }
  const out = [];
  for (let i = 0; i < a.length; i++) {
    const v = asNumber(a[i]);
    if (v !== null) out.push(v);
  }
  return out;
}

/** 二维清洗：逐行过滤非法值，返回纯数字矩阵（行序保留） */
function cleanMatrix(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (let i = 0; i < rows.length; i++) out.push(clean(rows[i]));
  return out;
}

/** 有限数或 null（用于可空输出字段） */
function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 保留若干位小数（仅用于展示性派生字段，如 ppm），null 安全 */
function roundTo(v, digits) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** 求和（忽略非法值） */
function sum(a) {
  const d = clean(a);
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s;
}

/** 算术平均（空数组返回 null） */
function mean(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s / d.length;
}

/** 样本方差（n-1 分母）；n<2 时返回 0（约定：无离散信息时方差记 0） */
function variance(a) {
  const d = clean(a);
  const n = d.length;
  if (n < 2) return 0;
  const m = mean(d);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const e = d[i] - m;
    s += e * e;
  }
  return s / (n - 1);
}

/** 样本标准差（n-1）；n<2 返回 0 */
function sd(a) {
  return Math.sqrt(variance(a));
}

/** 中位数（偶数个取中间两值平均；空数组返回 null） */
function median(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  return quantileSorted(d.slice().sort((x, y) => x - y), 0.5);
}

/** 已排序数组的分位数（线性插值法，等同 Excel PERCENTILE.INC / R type 7） */
function quantileSorted(sorted, p) {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  let q = asNumber(p);
  if (q === null) q = 0.5;
  if (q <= 0) return sorted[0];
  if (q >= 1) return sorted[n - 1];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

/** 分位数（线性插值，p∈[0,1]） */
function quantile(a, p) {
  const d = clean(a);
  if (d.length === 0) return null;
  d.sort((x, y) => x - y);
  return quantileSorted(d, p);
}

function min(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  let m = d[0];
  for (let i = 1; i < d.length; i++) if (d[i] < m) m = d[i];
  return m;
}

function max(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  let m = d[0];
  for (let i = 1; i < d.length; i++) if (d[i] > m) m = d[i];
  return m;
}

/** 极差 = max - min */
function range(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  return max(d) - min(d);
}

/** 变异系数（百分数）；均值缺失或为 0 时返回 null */
function cv(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  const m = mean(d);
  if (m === null || m === 0) return null;
  return (sd(d) / Math.abs(m)) * 100;
}

/** 四分位距 = Q3 - Q1 */
function iqr(a) {
  const d = clean(a);
  if (d.length === 0) return null;
  d.sort((x, y) => x - y);
  return quantileSorted(d, 0.75) - quantileSorted(d, 0.25);
}

/** 一次给出常用描述统计量 */
function describe(a) {
  const d = clean(a);
  const n = d.length;
  if (n === 0) {
    return {
      n: 0, sum: 0, mean: null, sd: null, min: null, max: null,
      median: null, q1: null, q3: null, iqr: null, cv: null, range: null,
    };
  }
  const s = d.slice().sort((x, y) => x - y);
  const m = mean(d);
  const sdd = sd(d);
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  return {
    n,
    sum: sum(d),
    mean: m,
    sd: sdd,
    min: s[0],
    max: s[n - 1],
    median: quantileSorted(s, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    cv: m === 0 ? null : (sdd / Math.abs(m)) * 100,
    range: s[n - 1] - s[0],
  };
}

/** 矩阵转置 */
function transpose(M) {
  const r = M.length;
  const c = r > 0 ? M[0].length : 0;
  const T = [];
  for (let j = 0; j < c; j++) {
    const row = new Array(r);
    for (let i = 0; i < r; i++) row[i] = M[i][j];
    T.push(row);
  }
  return T;
}

/** 矩阵乘法 */
function matMul(A, B) {
  const n = A.length;
  const m = B.length;
  const p = m > 0 ? B[0].length : 0;
  const C = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(p).fill(0);
    for (let k = 0; k < m; k++) {
      const a = A[i][k];
      if (a === 0) continue;
      const Bk = B[k];
      for (let j = 0; j < p; j++) row[j] += a * Bk[j];
    }
    C.push(row);
  }
  return C;
}

/**
 * 高斯-约当消元求逆（部分主元）
 * @returns {number[][]|null} 奇异或非法时返回 null
 */
function matInverse(M) {
  const n = M.length;
  if (n === 0 || M.some((r) => r.length !== n)) return null;
  const A = M.map((r) => r.slice());
  const I = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n).fill(0);
    row[i] = 1;
    I.push(row);
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > best) { best = v; piv = r; }
    }
    if (!(best > 1e-12)) return null; // 奇异 / 严重共线
    if (piv !== col) {
      const t1 = A[piv]; A[piv] = A[col]; A[col] = t1;
      const t2 = I[piv]; I[piv] = I[col]; I[col] = t2;
    }
    const d = A[col][col];
    for (let j = 0; j < n; j++) { A[col][j] /= d; I[col][j] /= d; }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        A[r][j] -= f * A[col][j];
        I[r][j] -= f * I[col][j];
      }
    }
  }
  return I;
}

/** 数组去重（保持首次出现顺序，用于 SPC 命中下标合并） */
function uniqSorted(arr) {
  const s = Array.from(new Set(arr)).sort((a, b) => a - b);
  return s;
}

/** 连续段合并：把递增下标数组压缩成 [start,end] 段（用于判异描述） */
function segments(idx) {
  const out = [];
  if (idx.length === 0) return out;
  let s = idx[0];
  let p = idx[0];
  for (let i = 1; i < idx.length; i++) {
    if (idx[i] === p + 1) { p = idx[i]; continue; }
    out.push([s, p]);
    s = idx[i];
    p = idx[i];
  }
  out.push([s, p]);
  return out;
}

/** 最小二乘直线拟合 -> {slope, intercept, n}；n<2 或 x 全相同返回 slope=null */
function lstsq(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { slope: null, intercept: n === 1 ? y[0] : null, n };
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    sxx += dx * dx;
    sxy += dx * (y[i] - my);
  }
  if (sxx === 0) return { slope: null, intercept: my, n };
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, n };
}

// ==================================================================
// 1. 分布函数（高精度数值实现）
// ==================================================================

/**
 * 误差函数 erf(x)（高精度）
 * 利用恒等式 erf(x) = P(1/2, x²)·sign(x)，其中 P 为正则化下不完全 Gamma 函数。
 * P(1/2, x²) 内部按 x² 与 a+1 的大小自动选择级数 / Lentz 连分式，
 * 相对误差可达 ~1e-15，且尾部平滑衰减（无查表式突变）。
 * 注：本函数定义在 gammp 之前，函数声明会被提升，运行时可用。
 */
function erf(x) {
  const X = asNumber(x);
  if (X === null) return null;
  if (X === 0) return 0;
  const p = gammp(0.5, X * X);
  if (p === null) return null;
  const v = Math.min(1, Math.max(0, p));
  return X > 0 ? v : -v;
}

/**
 * 互补误差函数 erfc(x) = 1 - erf(x)
 * 为保证 X 较大时的相对精度，这里用 erfc = Q(1/2, x²) = 1 - P(1/2, x²)
 * 的互补形式直接计算，避免"1 减小量"造成的有效位丢失。
 */
function erfc(x) {
  const X = asNumber(x);
  if (X === null) return null;
  const q = gammq(0.5, X * X);
  if (q === null) return null;
  const v = Math.min(1, Math.max(0, q));
  return X >= 0 ? v : 2 - v;
}

/** 标准正态概率密度 */
function normalPdf(x, mu, sigma) {
  const X = asNumber(x);
  const M = asNumber(mu);
  const S = asNumber(sigma);
  if (X === null) return null;
  const m = M === null ? 0 : M;
  const s = S === null ? 1 : S;
  if (!(s > 0)) return null;
  const z = (X - m) / s;
  return Math.exp(-0.5 * z * z) / (s * Math.sqrt(2 * Math.PI));
}

/** 正态累积分布（erfc 高精度逼近） */
function normalCdf(x, mu, sigma) {
  const X = asNumber(x);
  const M = asNumber(mu);
  const S = asNumber(sigma);
  if (X === null) return null;
  const m = M === null ? 0 : M;
  const s = S === null ? 1 : S;
  if (!(s > 0)) return null;
  return 0.5 * erfc(-(X - m) / (s * Math.SQRT2));
}

/** 正态下尾概率 P(Z < z)（标准正态，用于内部快速计算） */
function normalCdfStd(z) {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Horner 法求多项式值：coef[0] 为最高次项系数，z 为自变量 */
function poly(coef, z) {
  let v = coef[0];
  for (let i = 1; i < coef.length; i++) v = v * z + coef[i];
  return v;
}

/** 标准正态下尾分位数（Acklam 逼近 + 一步 Halley 精修） */
function normalInvStd(p) {
  const P = asNumber(p);
  if (P === null) return null;
  if (P <= 0) return -Infinity;
  if (P >= 1) return Infinity;
  const q = P - 0.5;
  let x;
  if (Math.abs(q) <= 0.425) {
    // 中心区（|p-0.5| ≤ 0.425），相对误差 < 1.15e-9
    const r = 0.180625 - q * q;
    x = (q * poly([
      2509.0809287301226727, 33430.575583588128105, 67265.770927008700853,
      45921.953931549871457, 13731.693765509461125, 1971.5909503065514427,
      133.14166789178437745, 3.387132872796366608,
    ], r)) / poly([
      5226.495278852854561, 28729.085735721942674, 39307.89580009271061,
      21213.794301586595867, 5394.1960214247511077, 687.1870074920579083,
      42.313330701600911252, 1,
    ], r);
  } else {
    // 尾部区：先取较近的一侧概率，再对 -ln(p) 开方后有理逼近
    let r = q < 0 ? P : 1 - P;
    r = Math.sqrt(-Math.log(r));
    if (r <= 5) {
      const t = r - 1.6;
      x = poly([
        7.7454501427834140764e-4, 0.0227238449892691845833, 0.24178072517745061177,
        1.27045825245236838258, 3.64784832476320460504, 5.7694972214606914055,
        4.6303378461565452959, 1.42343711074968357734,
      ], t) / poly([
        1.05075007164441684324e-9, 5.475938084995344946e-4, 0.0151986665636164571966,
        0.14810397642748007459, 0.68976733498510000455, 1.6763848301838038494,
        2.05319162663775882187, 1,
      ], t);
    } else {
      const t = r - 5;
      x = poly([
        2.01033439929228813265e-7, 2.71155556874348757815e-5, 0.0012426609473880784386,
        0.026532189526576123093, 0.29656057182850489123, 1.7848265399172913358,
        5.4637849111641143699, 6.6579046435011037772,
      ], t) / poly([
        2.04426310338993978564e-15, 1.4215117583164458887e-7, 1.8463183175100546818e-5,
        7.868691311456132591e-4, 0.0148753612908506148525, 0.13692988092273580531,
        0.59983220655588793769, 1,
      ], t);
    }
    if (q < 0) x = -x;
  }
  // Halley 精修一步（利用正态密度与 CDF），把误差压到 ~1e-15
  for (let i = 0; i < 2; i++) {
    const e = normalCdfStd(x) - P;
    const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    if (pdf < 1e-300) break;
    const u = e / pdf;
    x -= u / (1 + 0.5 * x * u);
    if (!Number.isFinite(x)) return null;
  }
  return x;
}

/** 正态分位数（逆累积分布） */
function normalInv(p, mu, sigma) {
  const M = asNumber(mu);
  const S = asNumber(sigma);
  const m = M === null ? 0 : M;
  const s = S === null ? 1 : S;
  if (!(s > 0)) return null;
  const z = normalInvStd(p);
  if (z === null) return null;
  return m + s * z;
}

/** Lanczos 对数 Gamma 函数 lnΓ(x)（g=7, n=9，相对误差 < 1e-15） */
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function logGamma(x) {
  const X = asNumber(x);
  if (X === null) return null;
  if (X <= 0 && Number.isInteger(X)) return Infinity; // 极点
  if (X < 0.5) {
    // 反射公式
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * X))) - logGamma(1 - X);
  }
  const z = X - 1;
  let a = LANCZOS_C[0];
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_C.length; i++) a += LANCZOS_C[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** ln B(a,b) = lnΓ(a)+lnΓ(b)-lnΓ(a+b) */
function logBeta(a, b) {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** 正则化不完全 Beta：I_x(a,b) 的连分式部分（Lentz 算法，Numerical Recipes betacf） */
function betacf(a, b, x) {
  const MAXIT = 300;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/**
 * 正则化不完全 Beta 函数 I_x(a,b) ∈ [0,1]
 * a,b > 0；x 会被夹到 (0,1) 闭区间外做边界处理。
 */
function betai(a, b, x) {
  if (!(a > 0) || !(b > 0)) return null;
  const X = asNumber(x);
  if (X === null) return null;
  if (X <= 0) return 0;
  if (X >= 1) return 1;
  // 前置因子 x^a (1-x)^b / B(a,b)
  const bt = Math.exp(-logBeta(a, b) + a * Math.log(X) + b * Math.log(1 - X));
  if (X < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, X)) / a;
  return 1 - (bt * betacf(b, a, 1 - X)) / b;
}

/** 正则化下不完全 Gamma P(a,x)（级数展开，x < a+1 时使用） */
function gser(a, x) {
  const ITMAX = 1000;
  const EPSG = 3e-16;
  if (x <= 0) return 0;
  let ap = a;
  let sumG = 1 / a;
  let del = sumG;
  for (let n = 1; n <= ITMAX; n++) {
    ap += 1;
    del *= x / ap;
    sumG += del;
    if (Math.abs(del) < Math.abs(sumG) * EPSG) break;
  }
  const lg = logGamma(a);
  if (!Number.isFinite(lg)) return null;
  return sumG * Math.exp(-x + a * Math.log(x) - lg);
}

/** 正则化上不完全 Gamma Q(a,x)（连分式，x ≥ a+1 时使用） */
function gcf(a, x) {
  const ITMAX = 1000;
  const EPSG = 3e-16;
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPSG) break;
  }
  const lg = logGamma(a);
  if (!Number.isFinite(lg)) return null;
  return Math.exp(-x + a * Math.log(x) - lg) * h;
}

/** 下不完全 Gamma P(a,x) */
function gammp(a, x) {
  if (!(a > 0)) return null;
  const X = asNumber(x);
  if (X === null || X < 0) return null;
  if (X === 0) return 0;
  return X < a + 1 ? gser(a, X) : 1 - gcf(a, X);
}

/** 上不完全 Gamma Q(a,x) = 1 - P(a,x) */
function gammq(a, x) {
  if (!(a > 0)) return null;
  const X = asNumber(x);
  if (X === null || X < 0) return null;
  if (X === 0) return 1;
  return X < a + 1 ? 1 - gser(a, X) : gcf(a, X);
}

/**
 * 学生 t 分布累积概率 P(T ≤ t)
 * 关系式：P(T>t) = 0.5 * I_{df/(df+t²)}(df/2, 1/2)
 */
function tCdf(t, df) {
  const T = asNumber(t);
  const D = asNumber(df);
  if (T === null || D === null || !(D > 0)) return null;
  const x = D / (D + T * T);
  const ib = betai(D / 2, 0.5, x);
  if (ib === null) return null;
  if (T > 0) return 1 - 0.5 * ib;
  if (T < 0) return 0.5 * ib;
  return 0.5;
}

/** t 分布上尾概率 P(T > t) */
function tSf(t, df) {
  const c = tCdf(t, df);
  return c === null ? null : 1 - c;
}

/**
 * t 分位数（下尾）：tInv(p, df) = 使 P(T ≤ t) = p 的 t
 * 用二分法配合 tCdf，收敛到 ~1e-12。
 */
function tInv(p, df) {
  const P = asNumber(p);
  const D = asNumber(df);
  if (P === null || D === null || !(D > 0)) return null;
  if (P <= 0) return -Infinity;
  if (P >= 1) return Infinity;
  if (P === 0.5) return 0;
  return rootFind((t) => tCdf(t, D), P, -1, 1);
}

/**
 * 通用单调增函数的求根：先用 [-1,1] 起手，按 2 倍步长向外扩展直到夹住 p，
 * 再二分到 ROOT_EPS。f(a)、f(b) 必须能给出有限值。
 */
function rootFind(f, target, a0, b0) {
  let a = a0;
  let b = b0;
  let fa = f(a);
  let fb = f(b);
  if (fa === null || fb === null) return null;
  let guard = 0;
  while (fa > target && guard < 200) {
    b = a;
    fb = fa;
    a *= 2;
    if (a === 0) a = -1e-6;
    fa = f(a);
    if (fa === null) return null;
    guard++;
  }
  guard = 0;
  while (fb < target && guard < 200) {
    a = b;
    fa = fb;
    b *= 2;
    if (b === 0) b = 1e-6;
    fb = f(b);
    if (fb === null) return null;
    guard++;
  }
  if (!(fa <= target && target <= fb)) return null;
  for (let i = 0; i < 400; i++) {
    const m = 0.5 * (a + b);
    if (b - a <= ROOT_EPS * Math.max(1, Math.abs(m))) return m;
    const fm = f(m);
    if (fm === null) return null;
    if (fm < target) { a = m; fa = fm; } else { b = m; fb = fm; }
  }
  return 0.5 * (a + b);
}

/**
 * F 分布累积概率 P(F ≤ f)
 * 关系式：P(F>f) = I_{d2/(d2+d1·f)}(d2/2, d1/2)
 */
function fCdf(f, df1, df2) {
  const F = asNumber(f);
  const D1 = asNumber(df1);
  const D2 = asNumber(df2);
  if (F === null || D1 === null || D2 === null) return null;
  if (!(D1 > 0) || !(D2 > 0)) return null;
  if (F <= 0) return 0;
  const x = D2 / (D2 + D1 * F);
  const ib = betai(D2 / 2, D1 / 2, x);
  if (ib === null) return null;
  return 1 - ib;
}

/** F 分布上尾概率 */
function fSf(f, df1, df2) {
  const c = fCdf(f, df1, df2);
  return c === null ? null : 1 - c;
}

/** F 分位数（下尾） */
function fInv(p, df1, df2) {
  const P = asNumber(p);
  const D1 = asNumber(df1);
  const D2 = asNumber(df2);
  if (P === null || D1 === null || D2 === null || !(D1 > 0) || !(D2 > 0)) return null;
  if (P <= 0) return 0;
  if (P >= 1) return Infinity;
  return rootFind((f) => fCdf(f, D1, D2), P, 1e-3, 1);
}

/** 卡方累积概率 P(X ≤ x) = P(df/2, x/2) */
function chi2Cdf(x, df) {
  const X = asNumber(x);
  const D = asNumber(df);
  if (X === null || D === null || !(D > 0)) return null;
  if (X <= 0) return X === 0 ? 0 : 0;
  return gammp(D / 2, X / 2);
}

/** 卡方上尾概率 */
function chi2Sf(x, df) {
  const c = chi2Cdf(x, df);
  return c === null ? null : 1 - c;
}

/** 卡方下尾分位数（二分法，单调） */
function chi2Inv(p, df) {
  const P = asNumber(p);
  const D = asNumber(df);
  if (P === null || D === null || !(D > 0)) return null;
  if (P <= 0) return 0;
  if (P >= 1) return Infinity;
  let hi = D + 10 * Math.sqrt(2 * D) + 10;
  let guard = 0;
  while (chi2Cdf(hi, D) < P && guard < 200) { hi *= 2; guard++; }
  let lo = 0;
  for (let i = 0; i < 400; i++) {
    const m = 0.5 * (lo + hi);
    if (hi - lo <= ROOT_EPS * Math.max(1, Math.abs(m))) return m;
    if (chi2Cdf(m, D) < P) lo = m; else hi = m;
  }
  return 0.5 * (lo + hi);
}

/**
 * 由检验统计量求真实 p 值（统一入口，避免各处重复判断）
 * @param {'t'|'f'|'chi2'} kind
 * @param {number} stat 统计量
 * @param {number} df  自由度（kind='f' 时传 df1，需另给 df2）
 * @param {object} [opt] {tail:'two'|'greater'|'less', df2}
 */
function pValue(kind, stat, df, opt) {
  const o = opt || {};
  const tail = o.tail || 'two';
  const S = asNumber(stat);
  const D = asNumber(df);
  if (S === null || D === null) return null;
  if (kind === 't') {
    if (tail === 'greater') return tSf(S, D);
    if (tail === 'less') return tCdf(S, D);
    const sf = tSf(Math.abs(S), D);
    return sf === null ? null : Math.min(1, 2 * sf);
  }
  if (kind === 'f') {
    const D2 = asNumber(o.df2);
    if (D2 === null) return null;
    return tail === 'less' ? fCdf(S, D, D2) : fSf(S, D, D2);
  }
  if (kind === 'chi2') {
    return tail === 'less' ? chi2Cdf(S, D) : chi2Sf(S, D);
  }
  return null;
}

/** 双侧 t 临界值 t_{1-α/2, df} */
function tCrit(alpha, df) {
  return tInv(1 - alpha / 2, df);
}

// ==================================================================
// 2. 过程能力 / 过程性能
// ==================================================================

/**
 * 过程能力与过程性能指数
 *
 * 记号：USL/LSL 规格上下限，x̄ 总均值，s 总体样本标准差（n-1），
 *       σ̂_within 组内标准差（优先使用调用方传入的 withinSd，
 *       否则由子组极差均值 R̄/d2 估计，再退化到总体 s）。
 *
 * 输出中：Cp/Cpk/Cpu/Cpl 使用组内 σ̂（短期能力），
 *         Pp/Ppk/Ppu/Ppl 使用总体 s（长期性能）；
 *         若组件标准差不可得（无子组信息），短期指标同样用 s 计算并在
 *         sigmaBasis 中标注 'overall'。
 *
 * @param {number[]} values 测量值序列（脏数据自动过滤）
 * @param {number} usl 规格上限（null/非法则该侧指标为 null）
 * @param {number} lsl 规格下限
 * @param {{subgroupSize?:number, withinSd?:number, target?:number}} [opts]
 */
function capability(values, usl, lsl, opts) {
  const o = opts || {};
  const d = clean(values);
  const n = d.length;
  const USL = asNumber(usl);
  const LSL = asNumber(lsl);
  const out = {
    n,
    mean: null, sd: null, usl: USL, lsl: LSL,
    cp: null, cpu: null, cpl: null, cpk: null,
    pp: null, ppu: null, ppl: null, ppk: null, cpm: null,
    ppmTotal: null, ppmAbove: null, ppmBelow: null,
    sigmaLevel: null, yieldPct: null,
    withinSd: null, sigmaBasis: null,
    target: null, sigmaLevelShifted: null, note: null,
  };
  if (n === 0) {
    out.note = '无有效数据（已过滤 null/NaN/Infinity）';
    return out;
  }
  const m = mean(d);
  const s = sd(d);
  out.mean = m;
  out.sd = s;

  // ---- 组内标准差 ----
  let sw = null;
  let basis = null;
  const withinGiven = asNumber(o.withinSd);
  if (withinGiven !== null && withinGiven > 0) {
    sw = withinGiven;
    basis = 'withinSd(传入)';
  } else if (o.subgroupSize != null) {
    const g = Math.floor(asNumber(o.subgroupSize) || 0);
    if (g >= CHART_N_MIN) {
      const mr = [];
      for (let i = 0; i + g <= n; i += g) {
        const seg = d.slice(i, i + g);
        mr.push(range(seg));
      }
      const rbar = mean(mr);
      const c = rangeConst(g);
      if (rbar !== null && rbar > 0 && c && c.d2 > 0) {
        sw = rbar / c.d2;
        basis = '子组极差 R̄/d2 (n=' + g + ')';
      }
    }
  }
  if (sw === null) {
    sw = s;
    basis = '总体 s（未提供子组信息，短期=长期口径）';
  }
  out.withinSd = sw;
  out.sigmaBasis = basis;

  // ---- 目标值与 Cpm ----
  const tgt = asNumber(o.target);
  const target = tgt !== null ? tgt : (USL !== null && LSL !== null ? (USL + LSL) / 2 : null);
  out.target = target;

  // ---- 能力指数（组内 σ̂）----
  if (USL !== null && LSL !== null && sw > 0) {
    out.cp = (USL - LSL) / (6 * sw);
  }
  if (USL !== null && sw > 0) out.cpu = (USL - m) / (3 * sw);
  if (LSL !== null && sw > 0) out.cpl = (m - LSL) / (3 * sw);
  if (out.cpu !== null || out.cpl !== null) {
    out.cpk = Math.min(out.cpu === null ? Infinity : out.cpu, out.cpl === null ? Infinity : out.cpl);
    if (!Number.isFinite(out.cpk)) out.cpk = null;
  }
  if (target !== null && sw > 0) {
    out.cpm = (USL !== null && LSL !== null)
      ? (USL - LSL) / (6 * Math.sqrt(sw * sw + (m - target) * (m - target)))
      : null;
  }

  // ---- 过程性能指数（总体 s）----
  if (USL !== null && LSL !== null && s > 0) out.pp = (USL - LSL) / (6 * s);
  if (USL !== null && s > 0) out.ppu = (USL - m) / (3 * s);
  if (LSL !== null && s > 0) out.ppl = (m - LSL) / (3 * s);
  if (out.ppu !== null || out.ppl !== null) {
    out.ppk = Math.min(out.ppu === null ? Infinity : out.ppu, out.ppl === null ? Infinity : out.ppl);
    if (!Number.isFinite(out.ppk)) out.ppk = null;
  }

  // ---- 不良率（基于正态假设，用长期 s 估计）----
  if (s > 0) {
    const pAbove = USL !== null ? 1 - normalCdf(USL, m, s) : 0;
    const pBelow = LSL !== null ? normalCdf(LSL, m, s) : 0;
    const pTot = pAbove + pBelow;
    out.ppmAbove = USL !== null ? roundTo(pAbove * 1e6, 4) : null;
    out.ppmBelow = LSL !== null ? roundTo(pBelow * 1e6, 4) : null;
    out.ppmTotal = roundTo(pTot * 1e6, 4);
    const yieldFrac = Math.max(0, Math.min(1, 1 - pTot));
    out.yieldPct = yieldFrac * 100;
    const z = normalInvStd(yieldFrac);
    out.sigmaLevel = z;
    out.sigmaLevelShifted = z === null ? null : z + 1.5;
  } else {
    // 方差为 0：无变异，按规格判断是否全部合格
    const ok = (USL === null || m <= USL) && (LSL === null || m >= LSL);
    out.ppmAbove = USL !== null ? (m > USL ? 1e6 : 0) : null;
    out.ppmBelow = LSL !== null ? (m < LSL ? 1e6 : 0) : null;
    out.ppmTotal = (out.ppmAbove === null ? 0 : out.ppmAbove) + (out.ppmBelow === null ? 0 : out.ppmBelow);
    out.yieldPct = ok ? 100 : 0;
    out.sigmaLevel = ok ? Infinity : -Infinity;
    out.sigmaLevelShifted = out.sigmaLevel;
    out.note = '样本标准差为 0（无变异），ppm/σ 水平按退化情形处理';
  }
  if (USL === null && LSL === null) {
    out.note = '未提供 USL/LSL，仅返回描述统计与标准差分解';
  }
  return out;
}

// ==================================================================
// 3. 控制图
// ==================================================================

/**
 * 控制图系数表（n = 2..10）
 *   d2, d3, c4, A2 = 3/(d2·√n), D3 = max(0, 1-3·d3/d2), D4 = 1+3·d3/d2,
 *   B3 = max(0, 1-3·(√(1-c4²))/c4), B4 = 1+3·(√(1-c4²))/c4
 * 极差法与标准差法两组常数均取自 AIAG SPC 手册 / GB/T 4091 附录。
 */
const CHART_CONST = {
  2: { d2: 1.128, d3: 0.853, c4: 0.7979, A2: 1.880, D3: 0, D4: 3.267, B3: 0, B4: 3.267 },
  3: { d2: 1.693, d3: 0.888, c4: 0.8862, A2: 1.023, D3: 0, D4: 2.574, B3: 0, B4: 2.568 },
  4: { d2: 2.059, d3: 0.880, c4: 0.9213, A2: 0.729, D3: 0, D4: 2.282, B3: 0, B4: 2.266 },
  5: { d2: 2.326, d3: 0.864, c4: 0.9400, A2: 0.577, D3: 0, D4: 2.114, B3: 0, B4: 2.089 },
  6: { d2: 2.534, d3: 0.848, c4: 0.9515, A2: 0.483, D3: 0, D4: 2.004, B3: 0.030, B4: 1.970 },
  7: { d2: 2.704, d3: 0.833, c4: 0.9594, A2: 0.419, D3: 0.076, D4: 1.924, B3: 0.118, B4: 1.882 },
  8: { d2: 2.847, d3: 0.820, c4: 0.9650, A2: 0.373, D3: 0.136, D4: 1.864, B3: 0.185, B4: 1.815 },
  9: { d2: 2.970, d3: 0.808, c4: 0.9693, A2: 0.337, D3: 0.184, D4: 1.816, B3: 0.239, B4: 1.761 },
  10: { d2: 3.078, d3: 0.797, c4: 0.9727, A2: 0.308, D3: 0.223, D4: 1.777, B3: 0.284, B4: 1.716 },
};

/**
 * 极差法常数：n 在 2..10 查标准表；超出范围用无偏常数数值公式补齐：
 *   d2 = E[R/σ] = ∫(1-(1-Φ(x))^n - Φ(x)^n) dx
 *   d3 = √(Var(R/σ))，由 P(R<x) = n∫φ(u)[Φ(u+x)-Φ(u)]^{n-1}du 数值微分求得
 * 结果与标准表误差 < 0.001（n≤10 时直接查表，零误差）。
 * @returns {{d2,d3,source:string}}
 */
function rangeConst(n) {
  const N = Math.floor(asNumber(n) || 0);
  if (CHART_CONST[N]) return { d2: CHART_CONST[N].d2, d3: CHART_CONST[N].d3, source: 'table' };
  if (RANGE_CONST_NUM_CACHE.has(N)) return RANGE_CONST_NUM_CACHE.get(N);
  const r = { d2: d2Numeric(N), d3: d3Numeric(N), source: 'numerical' };
  RANGE_CONST_NUM_CACHE.set(N, r);
  return r;
}

/**
 * 数值计算 d2 = E[R/σ]（Simpson 积分，精度 ~1e-6）
 *   E[R/σ] = 2∫₀^∞ [1 − Φ(x)^n − (1−Φ(x))^n] dx
 * （x≥0 的积分只覆盖"最大值落在正半轴"那一半，故乘 2）
 */
function d2Numeric(n) {
  if (!(n >= 2)) return null;
  const hi = 15;
  const steps = 8000;
  const h = hi / steps;
  let s = 0;
  for (let i = 0; i <= steps; i++) {
    const x = i * h;
    const c = normalCdfStd(x);
    const f = 1 - Math.pow(1 - c, n) - Math.pow(c, n);
    s += f * (i === 0 || i === steps ? 1 : (i % 2 === 0 ? 2 : 4));
  }
  return 2 * ((s * h) / 3);
}

/** 极差分布 CDF：F_R(x) = n∫φ(u)[Φ(u+x) − Φ(u)]^{n−1} du（x ≥ 0） */
function rangeCdf(x, n) {
  if (x <= 0) return 0;
  const lo = -9;
  const hi = 9;
  const steps = 400;
  const h = (hi - lo) / steps;
  let s = 0;
  for (let i = 0; i <= steps; i++) {
    const u = lo + i * h;
    const pdf = Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    const d = normalCdfStd(u + x) - normalCdfStd(u);
    const f = pdf * Math.pow(Math.max(0, d), n - 1);
    s += f * (i === 0 || i === steps ? 1 : (i % 2 === 0 ? 2 : 4));
  }
  return Math.min(1, n * ((s * h) / 3));
}

/**
 * 数值计算 d3 = √Var(R/σ)
 *   E[R²] = 2∫₀^∞ x·(1 − F_R(x)) dx（由 E[R²] = ∫2x·P(R>x)dx 分部积分得到）
 *   Var = E[R²] − (E[R])²
 * 当 1−F_R(x) 已小到可忽略时提前退出积分，兼顾精度与速度。
 */
function d3Numeric(n) {
  if (!(n >= 2)) return null;
  const e1 = d2Numeric(n);
  const hi = 15;
  const steps = 2000;
  const h = hi / steps;
  let m2 = 0;
  for (let i = 0; i <= steps; i++) {
    const x = i * h;
    const c = rangeCdf(x, n);
    const f = 2 * x * (1 - c);
    m2 += f * (i === 0 || i === steps ? 1 : (i % 2 === 0 ? 2 : 4));
    if (x > e1 + 8 && 1 - c < 1e-13) break; // 尾部已可忽略
  }
  m2 *= h / 3;
  const v = m2 - e1 * e1;
  return v > 0 ? Math.sqrt(v) : null;
}

/** 表外常数的数值结果缓存（d2/d3 只依赖 n，确定性，可安全缓存） */
const RANGE_CONST_NUM_CACHE = new Map();

/**
 * I-MR（单值-移动极差）控制图
 *   CL  = x̄
 *   MR̄ = 相邻两点绝对差均值
 *   σ̂within = MR̄ / 1.128      （d2, n=2）
 *   UCL = x̄ + k·(2.66·MR̄)  = x̄ + k·3σ̂within（k 默认 3）
 *   LCL = x̄ - k·3σ̂within（可能为负数，按式计算不裁剪，便于判异理解）
 * 点级附加 zone：'A'|'B'|'C'|'center' 表示点在中心线哪一侧的哪个区。
 */
function chartIMR(values, opts) {
  const o = opts || {};
  const k = asNumber(o.sigmaLimitK);
  const K = k === null || k <= 0 ? 3 : k;
  const d = clean(values);
  const n = d.length;
  const cl = mean(d);
  const mr = [];
  for (let i = 1; i < n; i++) mr.push(Math.abs(d[i] - d[i - 1]));
  const mrCenter = mr.length ? mean(mr) : null;
  const sigmaWithin = mrCenter !== null ? mrCenter / CHART_CONST[2].d2 : (n > 1 ? sd(d) : 0);
  // σ̂ = MR̄/1.128 已是单值标准差估计，故 UCL = x̄ ± K·σ̂（K=3 时等价 x̄ ± 2.66·MR̄）
  const ucl = n ? cl + K * sigmaWithin : null;
  const lcl = n ? cl - K * sigmaWithin : null;
  const out = {
    chart: 'I-MR',
    n,
    center: n ? cl : null,
    ucl,
    lcl,
    sigmaWithin,
    sigmaLimitK: K,
    mrCenter,
    mrUcl: null,
    mrLcl: null,
    mr,
    points: [],
  };
  if (mrCenter !== null) {
    out.mrUcl = CHART_CONST[2].D4 * mrCenter;  // D4(2) = 3.267
    out.mrLcl = CHART_CONST[2].D3 * mrCenter;  // D3(2) = 0
  }
  const sig = sigmaWithin;
  for (let i = 0; i < n; i++) {
    const v = d[i];
    let zone = null;
    if (sig > 0) {
      const z = (v - cl) / sig;
      const side = z > 0 ? '+' : '-';
      const az = Math.abs(z);
      let band;
      if (az > 3) band = 'A';
      else if (az > 2) band = 'B';
      else if (az > 1) band = 'C';
      else band = 'center';
      zone = band === 'center' ? 'center' : side + band;
    }
    out.points.push({
      i,
      value: v,
      outOfControl: ucl !== null && lcl !== null ? (v > ucl || v < lcl) : null,
      zone,
    });
  }
  return out;
}

/** 由子组矩阵计算 Xbar-R 图（含系数，便于前端展示与审计） */
function chartXbarR(subgroups, opts) {
  const o = opts || {};
  const K = (() => {
    const k = asNumber(o.sigmaLimitK);
    return k === null || k <= 0 ? 3 : k;
  })();
  const g = cleanMatrix(subgroups).filter((r) => r.length > 0);
  const k = g.length;
  const sizes = g.map((r) => r.length);
  const nMode = modeOf(sizes);
  const consts = rangeConst(nMode);
  const D3 = Math.max(0, 1 - K * (consts.d3 / consts.d2));
  const D4 = 1 + K * (consts.d3 / consts.d2);
  const A2 = K / (consts.d2 * Math.sqrt(nMode)); // K=3 时为标准 A2 = 3/(d2√n)

  const means = g.map((r) => mean(r));
  const ranges = g.map((r) => range(r));
  const xbarbar = mean(means);
  const rbar = mean(ranges);
  const sigmaWithin = rbar !== null && consts.d2 ? rbar / consts.d2 : null;

  const xUcl = xbarbar + A2 * rbar;
  const xLcl = xbarbar - A2 * rbar;
  const rUcl = D4 * rbar;
  const rLcl = D3 * rbar;

  const out = {
    chart: 'Xbar-R',
    n: nMode,
    k,
    subgroupSizes: sizes,
    a2: A2,
    d3: D3,
    d4: D4,
    sigmaWithin,
    xbar: {
      center: xbarbar,
      ucl: xUcl,
      lcl: xLcl,
      sigmaLimitK: K,
      points: means.map((m, i) => ({
        i,
        value: m,
        outOfControl: m > xUcl || m < xLcl,
        subgroupSize: sizes[i],
      })),
    },
    r: {
      center: rbar,
      ucl: rUcl,
      lcl: rLcl,
      points: ranges.map((r, i) => ({ i, value: r, outOfControl: r > rUcl || r < rLcl })),
    },
  };
  if (nMode < CHART_N_MIN || nMode > CHART_N_MAX) {
    out.note = '子组容量 n=' + nMode + ' 超出标准系数表 2..10，A2/D3/D4 由无偏常数 d2/d3 公式计算'
      + '（d2 来源：' + consts.source + '）';
  }
  if (sizes.some((s) => s !== nMode)) {
    out.note = (out.note ? out.note + '；' : '') + '子组容量不一致，图中系数按众数 n=' + nMode + ' 取值';
  }
  return out;
}

/** 众数（用于子组容量代表值） */
function modeOf(arr) {
  const m = new Map();
  let best = null;
  let bestC = -1;
  for (const v of arr) {
    const c = (m.get(v) || 0) + 1;
    m.set(v, c);
    if (c > bestC) { bestC = c; best = v; }
  }
  return best;
}

/** Xbar-S（均值-标准差）控制图，S 图系数 B3/B4，支持 n=2..10 */
function chartXbarS(subgroups, opts) {
  const o = opts || {};
  const kRaw = asNumber(o.sigmaLimitK);
  const K = kRaw === null || kRaw <= 0 ? 3 : kRaw;
  const g = cleanMatrix(subgroups).filter((r) => r.length > 0);
  const k = g.length;
  const sizes = g.map((r) => r.length);
  const nMode = modeOf(sizes);
  const c4 = sdConst(nMode);
  const B3 = Math.max(0, 1 - K * (Math.sqrt(Math.max(0, 1 - c4 * c4)) / c4));
  const B4 = 1 + K * (Math.sqrt(Math.max(0, 1 - c4 * c4)) / c4);
  const A3 = K / (c4 * Math.sqrt(nMode));

  const means = g.map((r) => mean(r));
  const sds = g.map((r) => sd(r));
  const xbarbar = mean(means);
  const sbar = mean(sds);
  const sigmaWithin = c4 > 0 ? sbar / c4 : null;

  const out = {
    chart: 'Xbar-S',
    n: nMode,
    k,
    subgroupSizes: sizes,
    a3: A3,
    b3: B3,
    b4: B4,
    c4,
    sigmaWithin,
    xbar: {
      center: xbarbar,
      ucl: xbarbar + A3 * sbar,
      lcl: xbarbar - A3 * sbar,
      sigmaLimitK: K,
      points: means.map((m, i) => ({
        i,
        value: m,
        outOfControl: m > xbarbar + A3 * sbar || m < xbarbar - A3 * sbar,
        subgroupSize: sizes[i],
      })),
    },
    s: {
      center: sbar,
      ucl: B4 * sbar,
      lcl: B3 * sbar,
      points: sds.map((s, i) => ({ i, value: s, outOfControl: s > B4 * sbar || s < B3 * sbar })),
    },
  };
  if (nMode < CHART_N_MIN || nMode > CHART_N_MAX) {
    out.note = '子组容量 n=' + nMode + ' 超出标准系数表 2..10，B3/B4/A3 由 c4 无偏常数公式计算';
  }
  return out;
}

/**
 * 标准差法无偏常数 c4(n) = √(2/(n-1))·Γ(n/2)/Γ((n-1)/2)
 * 2..10 直接取标准表值（与 AIAG 手册一致），其余用公式。
 */
function sdConst(n) {
  const N = Math.floor(asNumber(n) || 0);
  if (CHART_CONST[N]) return CHART_CONST[N].c4;
  if (N < 2) return null;
  return Math.sqrt(2 / (N - 1)) * Math.exp(logGamma(N / 2) - logGamma((N - 1) / 2));
}

/**
 * 单值 EWMA 控制图（λ 默认 0.2，L 默认 3）
 *   z_i = λ·x_i + (1-λ)·z_{i-1}，z_0 = x̄
 *   时变控制限：CL ± L·σ̂·√(λ/(2-λ)·(1-(1-λ)^{2i}))
 * σ̂ 由移动极差估计（MR̄/1.128），与 I-MR 口径一致。
 */
function chartEWMA(values, opts) {
  const o = opts || {};
  const lam = asNumber(o.lambda);
  const L = asNumber(o.L);
  const lambda = lam === null || lam <= 0 || lam > 1 ? 0.2 : lam;
  const Lc = L === null || L <= 0 ? 3 : L;
  const d = clean(values);
  const n = d.length;
  const cl = mean(d);
  const mr = [];
  for (let i = 1; i < n; i++) mr.push(Math.abs(d[i] - d[i - 1]));
  const mrBar = mr.length ? mean(mr) : null;
  const sigma = mrBar !== null ? mrBar / 1.128 : (n > 1 ? sd(d) : 0);
  const kf = Math.sqrt((lambda / (2 - lambda)));
  const points = [];
  let z = n ? cl : null;
  for (let i = 0; i < n; i++) {
    z = lambda * d[i] + (1 - lambda) * z;
    const f = 1 - Math.pow(1 - lambda, 2 * (i + 1));
    const halfWidth = Lc * sigma * kf * Math.sqrt(Math.max(0, f));
    const ucl = cl + halfWidth;
    const lcl = cl - halfWidth;
    points.push({
      i,
      value: d[i],
      z,
      ucl,
      lcl,
      outOfControl: z > ucl || z < lcl,
    });
  }
  return {
    chart: 'EWMA',
    n,
    lambda,
    L: Lc,
    center: n ? cl : null,
    ucl: points.length ? points[points.length - 1].ucl : null,
    lcl: points.length ? points[points.length - 1].lcl : null,
    sigmaWithin: sigma,
    sigmaBasis: 'MR̄/1.128（与 I-MR 同口径）',
    kf,
    points,
  };
}

// ==================================================================
// 4. GB/T 4091（ISO 7870）八大判异准则
// ==================================================================

/**
 * 区域划分：以中心线为界，1σ 内为 C 区，1~2σ 为 B 区，2~3σ 为 A 区，
 * 3σ 之外（超限）仍属 A 区之外，由准则 1 单独负责。
 */
function zoneOf(v, center, sigma) {
  if (!(sigma > 0)) return 'C';
  const z = (v - center) / sigma;
  const side = z >= 0 ? 1 : -1;
  const az = Math.abs(z);
  if (az > 3) return side > 0 ? 'A+' : 'A-';
  if (az > 2) return side > 0 ? 'B+' : 'B-';
  if (az > 1) return side > 0 ? 'C+' : 'C-';
  return 'C0';
}

const RULE_META = {
  1: { name: '准则1：1点落在A区之外', severity: 'high' },
  2: { name: '准则2：连续9点落在中心线同一侧', severity: 'medium' },
  3: { name: '准则3：连续6点递增或递减', severity: 'medium' },
  4: { name: '准则4：连续14点上下交替', severity: 'low' },
  5: { name: '准则5：连续3点中有2点落在中心线同一侧的B区以外', severity: 'high' },
  6: { name: '准则6：连续5点中有4点落在中心线同一侧的C区以外', severity: 'medium' },
  7: { name: '准则7：连续15点集中在中心线两侧的C区之内', severity: 'low' },
  8: { name: '准则8：连续8点落在中心线两侧且无一点在C区之内', severity: 'medium' },
};

/**
 * 八大判异准则扫描
 * @param {number[]} values 按时间顺序的测量值
 * @param {{center:number, ucl:number, lcl:number, sigma:number, k?:number}} limits
 * @returns {Array<{rule:number,name:string,indexes:number[],desc:string,severity:string}>}
 *          按下标升序返回命中的全部准则（每准则合并为一条，indexes 去重升序）。
 */
function spcRules(values, limits) {
  const d = clean(values);
  const L = limits || {};
  const center = asNumber(L.center);
  const ucl = asNumber(L.ucl);
  const lcl = asNumber(L.lcl);
  let sigma = asNumber(L.sigma);
  if (center === null || d.length === 0) return [];
  // σ 容错推导：优先显式 sigma，其次由 UCL 推，最后退化为样本标准差
  if (sigma === null || !(sigma > 0)) {
    if (ucl !== null) sigma = (ucl - center) / 3;
    else if (lcl !== null) sigma = (center - lcl) / 3;
    else sigma = sd(d);
  }
  if (!(sigma > 0)) sigma = 0;
  const n = d.length;
  const z = d.map((v) => (sigma > 0 ? (v - center) / sigma : 0));
  const hits = {}; // rule -> Set(index)

  const mark = (rule, idxs) => {
    if (!hits[rule]) hits[rule] = new Set();
    for (const i of idxs) hits[rule].add(i);
  };

  // 准则1：1 点超出 UCL/LCL（A 区之外）
  if (ucl !== null || lcl !== null) {
    for (let i = 0; i < n; i++) {
      const hi = ucl !== null && d[i] > ucl;
      const lo = lcl !== null && d[i] < lcl;
      if (hi || lo) mark(1, [i]);
    }
  } else {
    for (let i = 0; i < n; i++) if (Math.abs(z[i]) > 3) mark(1, [i]);
  }

  // 准则2：连续 9 点位于中心线同一侧（严格大于/小于，落在中心线上不计入）
  for (let i = 0; i + 9 <= n; i++) {
    let allPos = true;
    let allNeg = true;
    for (let j = i; j < i + 9; j++) {
      if (!(d[j] > center)) allPos = false;
      if (!(d[j] < center)) allNeg = false;
    }
    if (allPos || allNeg) {
      const idxs = [];
      for (let j = i; j < i + 9; j++) idxs.push(j);
      mark(2, idxs);
    }
  }

  // 准则3：连续 6 点递增或递减（严格单调）
  for (let i = 0; i + 6 <= n; i++) {
    let inc = true;
    let dec = true;
    for (let j = i; j < i + 5; j++) {
      if (!(d[j + 1] > d[j])) inc = false;
      if (!(d[j + 1] < d[j])) dec = false;
    }
    if (inc || dec) {
      const idxs = [];
      for (let j = i; j < i + 6; j++) idxs.push(j);
      mark(3, idxs);
    }
  }

  // 准则4：连续 14 点上下交替（相邻差值符号交替，差值须非 0）
  for (let i = 0; i + 14 <= n; i++) {
    let ok = true;
    let prevSign = 0;
    for (let j = i; j < i + 13; j++) {
      const diff = d[j + 1] - d[j];
      if (diff === 0) { ok = false; break; }
      const s = diff > 0 ? 1 : -1;
      if (prevSign !== 0 && s === prevSign) { ok = false; break; }
      prevSign = s;
    }
    if (ok) {
      const idxs = [];
      for (let j = i; j < i + 14; j++) idxs.push(j);
      mark(4, idxs);
    }
  }

  // 准则5：连续 3 点中有 2 点落在中心线同一侧的 B 区以外（同侧且 |z|>2）
  for (let i = 0; i + 3 <= n; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i; j < i + 3; j++) {
      if (z[j] > 2) pos++;
      else if (z[j] < -2) neg++;
    }
    if (pos >= 2 || neg >= 2) {
      const idxs = [];
      for (let j = i; j < i + 3; j++) idxs.push(j);
      mark(5, idxs);
    }
  }

  // 准则6：连续 5 点中至少有 4 点落在中心线同一侧的 C 区以外（|z|>1）
  for (let i = 0; i + 5 <= n; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i; j < i + 5; j++) {
      if (z[j] > 1) pos++;
      else if (z[j] < -1) neg++;
    }
    if (pos >= 4 || neg >= 4) {
      const idxs = [];
      for (let j = i; j < i + 5; j++) idxs.push(j);
      mark(6, idxs);
    }
  }

  // 准则7：连续 15 点集中在中心线两侧的 C 区之内（|z|<1，含落在中心线上）
  for (let i = 0; i + 15 <= n; i++) {
    let ok = true;
    for (let j = i; j < i + 15; j++) {
      if (!(Math.abs(z[j]) < 1)) { ok = false; break; }
    }
    if (ok) {
      const idxs = [];
      for (let j = i; j < i + 15; j++) idxs.push(j);
      mark(7, idxs);
    }
  }

  // 准则8：连续 8 点落在中心线两侧且无一点在 C 区之内（|z|>1，两侧都要有）
  for (let i = 0; i + 8 <= n; i++) {
    let ok = true;
    let hasPos = false;
    let hasNeg = false;
    for (let j = i; j < i + 8; j++) {
      if (!(Math.abs(z[j]) > 1)) { ok = false; break; }
      if (z[j] > 0) hasPos = true; else hasNeg = true;
    }
    if (ok && hasPos && hasNeg) {
      const idxs = [];
      for (let j = i; j < i + 8; j++) idxs.push(j);
      mark(8, idxs);
    }
  }

  const out = [];
  for (let r = 1; r <= 8; r++) {
    if (!hits[r] || hits[r].size === 0) continue;
    const indexes = uniqSorted(Array.from(hits[r]));
    const segs = segments(indexes)
      .map((s) => (s[0] === s[1] ? String(s[0]) : s[0] + '-' + s[1]))
      .join('、');
    out.push({
      rule: r,
      name: RULE_META[r].name,
      indexes,
      desc: RULE_META[r].name + '；命中下标：' + segs + '（0-based，共 ' + indexes.length + ' 点）',
      severity: RULE_META[r].severity,
    });
  }
  return out;
}

// ==================================================================
// 5. 直方图 / 帕累托
// ==================================================================

/**
 * 直方图
 * @param {number[]} values
 * @param {number|number[]} [bins] 组数（默认 Sturges 规则）或组边界数组
 * @returns {{edges:number[], bins:Array<{from,to,count,freq}> , n:number, binCount:number, mode:'count'|'edges'}}
 */
function histogram(values, bins) {
  const d = clean(values);
  const n = d.length;
  if (n === 0) return { edges: [], bins: [], n: 0, binCount: 0, mode: 'count' };
  const lo = min(d);
  const hi = max(d);
  let edges = [];
  let mode = 'count';
  if (Array.isArray(bins) && bins.length >= 2) {
    mode = 'edges';
    edges = clean(bins).slice().sort((a, b) => a - b);
    if (edges.length < 2) {
      edges = [lo, hi === lo ? lo + 1 : hi];
      mode = 'count';
    }
  } else {
    let k = Math.floor(asNumber(bins) || 0);
    if (!(k >= 1)) k = Math.max(1, Math.ceil(Math.log2(n) + 1)); // Sturges
    if (k > 1000) k = 1000;
    const span = hi - lo;
    const w = span > 0 ? span / k : 1;
    edges = [];
    for (let i = 0; i <= k; i++) edges.push(lo + i * w);
    if (span === 0) edges = [lo - 0.5, lo + 0.5];
  }
  const K = edges.length - 1;
  const counts = new Array(K).fill(0);
  for (let i = 0; i < n; i++) {
    const v = d[i];
    let idx;
    if (v <= edges[0]) idx = 0;
    else if (v >= edges[K]) idx = K - 1;
    else {
      idx = K - 1;
      for (let j = 1; j <= K; j++) {
        if (v < edges[j]) { idx = j - 1; break; }
      }
    }
    counts[idx]++;
  }
  const out = [];
  for (let i = 0; i < K; i++) {
    out.push({
      from: edges[i],
      to: edges[i + 1],
      count: counts[i],
      freq: counts[i] / n,
    });
  }
  return { edges, bins: out, n, binCount: K, mode };
}

/**
 * 帕累托分析
 * @param {Array<{name:string,value:number}>|Object} items
 * @returns {{rows:Array<{name,value,pct,cumPct}>, total:number, vitalFew:string[], top80Count:number}}
 */
function pareto(items) {
  let list = [];
  if (Array.isArray(items)) {
    list = items.map((it) => ({
      name: it && it.name != null ? String(it.name) : '',
      value: asNumber(it && it.value),
    }));
  } else if (items && typeof items === 'object') {
    list = Object.keys(items).map((k) => ({ name: k, value: asNumber(items[k]) }));
  }
  list = list.filter((it) => it.value !== null && it.value > 0);
  list.sort((a, b) => b.value - a.value);
  const total = list.reduce((s, it) => s + it.value, 0);
  let cum = 0;
  const rows = list.map((it) => {
    cum += it.value;
    return {
      name: it.name,
      value: it.value,
      pct: total > 0 ? (it.value / total) * 100 : null,
      cumPct: total > 0 ? (cum / total) * 100 : null,
    };
  });
  // 80% 关键少数：按累计占比从大到小累加，直到累计占比首次达到 80% 为止，
  // 这些项即为"关键少数"（top80Count = 达到 80% 所需的最少项数）。
  // 若全部项累计仍不足 80%（理论上不会，因末项累计恒为 100%），则退回全部项。
  const vitalFew = [];
  let top80Count = rows.length;
  for (let i = 0; i < rows.length; i++) {
    vitalFew.push(rows[i].name);
    if (rows[i].cumPct >= 80) { top80Count = i + 1; break; }
  }
  if (rows.length > 0 && rows[rows.length - 1].cumPct < 80) {
    top80Count = rows.length;
    vitalFew.length = 0;
    for (const r of rows) vitalFew.push(r.name);
  }
  return { rows, total, vitalFew, top80Count };
}

// ==================================================================
// 6. 假设检验
// ==================================================================

/** 单样本 t 检验（H0: μ = μ0） */
function tTest1(values, mu0, opts) {
  const o = opts || {};
  const alpha = numOr(o.alpha, 0.05);
  const tail = o.tail || 'two';
  const d = clean(values);
  const n = d.length;
  const M0 = asNumber(mu0);
  const m = mean(d);
  const s = sd(d);
  const df = n - 1;
  const out = {
    test: 'one-sample t',
    n, df, mean: m, sd: s, mu0: M0, alpha, tail,
    t: null, p: null, ci: null, reject: null, conclusion: null,
  };
  if (n < 2 || M0 === null || !(s > 0)) {
    out.conclusion = n < 2
      ? '有效样本量不足（n<2），无法进行 t 检验'
      : (!(s > 0) ? '样本标准差为 0，t 统计量无定义' : 'H0 均值 μ0 非法');
    return out;
  }
  const se = s / Math.sqrt(n);
  const t = (m - M0) / se;
  const p = pValue('t', t, df, { tail });
  const tc = tCrit(alpha, df);
  out.t = t;
  out.p = p;
  out.se = se;
  out.ci = [m - tc * se, m + tc * se]; // t 检验的均值置信区间（双侧 1-α）
  out.reject = p !== null && p < alpha;
  out.conclusion = out.reject
    ? '拒绝 H0（p=' + fmtP(p) + ' < α=' + alpha + '），样本均值与 ' + M0 + ' 存在统计显著差异'
    : '不拒绝 H0（p=' + fmtP(p) + ' ≥ α=' + alpha + '），无足够证据表明均值偏离 ' + M0;
  return out;
}

/** 数值/参数兜底 */
function numOr(v, dflt) {
  const n = asNumber(v);
  return n === null ? dflt : n;
}

/** p 值格式化（便于结论文本阅读） */
function fmtP(p) {
  if (p === null || !Number.isFinite(p)) return 'N/A';
  if (p < 1e-4) return p.toExponential(3);
  return p.toFixed(6);
}

/**
 * 独立双样本 t 检验
 * 默认 Welch（不假定方差齐性）；equalVariance=true 时使用合并方差（pooled）。
 * 返回同时包含两种算法的 t/df/p，便于审计对照。
 */
function tTest2(a, b, opts) {
  const o = opts || {};
  const alpha = numOr(o.alpha, 0.05);
  const tail = o.tail || 'two';
  const equalVar = !!o.equalVariance;
  const A = clean(a);
  const B = clean(b);
  const na = A.length;
  const nb = B.length;
  const ma = mean(A);
  const mb = mean(B);
  const sa = sd(A);
  const sb = sd(B);
  const out = {
    test: equalVar ? 'two-sample t (pooled)' : 'two-sample t (Welch)',
    nA: na, nB: nb, meanA: ma, meanB: mb, sdA: sa, sdB: sb,
    diff: na && nb ? ma - mb : null,
    alpha, tail, equalVariance: equalVar,
    t: null, df: null, p: null, ci: null, reject: null, conclusion: null,
    welch: { t: null, df: null, p: null },
    pooled: { t: null, df: null, p: null, sp2: null },
  };
  if (na < 2 || nb < 2) {
    out.conclusion = '两组有效样本量均需 ≥2，当前 nA=' + na + '、nB=' + nb;
    return out;
  }
  // Welch
  const va = sa * sa / na;
  const vb = sb * sb / nb;
  const seW = Math.sqrt(va + vb);
  if (seW > 0) {
    const tW = (ma - mb) / seW;
    const dfW = Math.pow(va + vb, 2) / (va * va / (na - 1) + vb * vb / (nb - 1));
    out.welch = { t: tW, df: dfW, p: pValue('t', tW, dfW, { tail }) };
  }
  // Pooled
  const sp2 = ((na - 1) * sa * sa + (nb - 1) * sb * sb) / (na + nb - 2);
  const seP = Math.sqrt(sp2 * (1 / na + 1 / nb));
  if (seP > 0) {
    const tP = (ma - mb) / seP;
    const dfP = na + nb - 2;
    out.pooled = { t: tP, df: dfP, p: pValue('t', tP, dfP, { tail }), sp2 };
  }
  const use = equalVar ? out.pooled : out.welch;
  out.t = use.t;
  out.df = use.df;
  out.p = use.p;
  out.usePooled = equalVar;
  if (out.t !== null && Number.isFinite(out.t)) {
    const se = equalVar ? seP : seW;
    const tc = tCrit(alpha, out.df);
    out.ci = [(ma - mb) - tc * se, (ma - mb) + tc * se];
    out.se = se;
    out.reject = out.p !== null && out.p < alpha;
    out.conclusion = out.reject
      ? '拒绝 H0（p=' + fmtP(out.p) + ' < α=' + alpha + '），两组均值差异显著（差值 ' +
        (ma - mb).toFixed(6) + '）'
      : '不拒绝 H0（p=' + fmtP(out.p) + ' ≥ α=' + alpha + '），两组均值差异不显著';
  } else {
    out.conclusion = '两组方差均为 0 或标准误为 0，t 统计量无定义';
  }
  return out;
}

/** 配对 t 检验（H0: 差值均值 = 0） */
function pairedT(a, b, opts) {
  const o = opts || {};
  const alpha = numOr(o.alpha, 0.05);
  const tail = o.tail || 'two';
  const A = clean(a);
  const B = clean(b);
  const m = Math.min(A.length, B.length);
  const diffs = [];
  for (let i = 0; i < m; i++) diffs.push(A[i] - B[i]);
  const base = tTest1(diffs, 0, { alpha, tail });
  return {
    test: 'paired t',
    n: diffs.length,
    df: base.df,
    meanA: mean(A),
    meanB: mean(B),
    meanDiff: diffs.length ? mean(diffs) : null,
    sdDiff: diffs.length ? sd(diffs) : null,
    t: base.t,
    p: base.p,
    alpha,
    tail,
    ci: base.ci,
    reject: base.reject,
    diffs,
    conclusion: base.conclusion,
    note: A.length !== B.length
      ? '两侧长度不一致，按较短长度 ' + m + ' 逐对相减（原始长度 ' + A.length + '/' + B.length + '）'
      : null,
  };
}

/** 单因素方差分析（one-way ANOVA） */
function anova1(groups, opts) {
  const o = opts || {};
  const alpha = numOr(o.alpha, 0.05);
  const G = cleanMatrix(groups).filter((g) => g.length > 0);
  const k = G.length;
  const all = [];
  for (const g of G) for (const v of g) all.push(v);
  const N = all.length;
  const grand = N ? mean(all) : null;
  const out = {
    test: 'one-way ANOVA',
    F: null, dfB: k - 1, dfW: null, ssB: null, ssW: null, ssT: null,
    msB: null, msW: null, p: null, alpha, reject: null,
    groupStats: G.map((g) => ({ n: g.length, mean: mean(g), sd: sd(g) })),
    grandMean: grand, k, N,
    conclusion: null,
  };
  if (k < 2 || N - k < 1) {
    out.conclusion = '至少需要 2 组且组内自由度 > 0，当前组数 ' + k + '、总样本 ' + N;
    out.dfW = N - k;
    return out;
  }
  let ssB = 0;
  let ssW = 0;
  for (const g of G) {
    const gm = mean(g);
    ssB += g.length * Math.pow(gm - grand, 2);
    for (const v of g) ssW += Math.pow(v - gm, 2);
  }
  const dfB = k - 1;
  const dfW = N - k;
  const msB = ssB / dfB;
  const msW = ssW / dfW;
  out.ssB = ssB;
  out.ssW = ssW;
  out.ssT = ssB + ssW;
  out.dfB = dfB;
  out.dfW = dfW;
  out.msB = msB;
  out.msW = msW;
  if (msW > 0) {
    const F = msB / msW;
    out.F = F;
    out.p = fSf(F, dfB, dfW);
    out.reject = out.p !== null && out.p < alpha;
    out.conclusion = out.reject
      ? '拒绝 H0（p=' + fmtP(out.p) + ' < α=' + alpha + '），至少有一组均值与其他组显著不同'
      : '不拒绝 H0（p=' + fmtP(out.p) + ' ≥ α=' + alpha + '），各组均值无显著差异';
  } else {
    out.conclusion = '组内均方为 0（组内无变异），F 无定义';
  }
  return out;
}

/** 卡方拟合优度检验（H0: 观测分布 = 期望分布） */
function chiSquareGOF(observed, expected) {
  const obs = clean(observed);
  const exp = clean(expected);
  const k = obs.length;
  const out = {
    test: 'chi-square goodness-of-fit',
    k, chi2: null, df: null, p: null, reject: null, alpha: 0.05,
    contributions: [], expected: exp, conclusion: null,
  };
  if (k === 0 || exp.length !== k) {
    out.conclusion = '观测与期望长度不一致或为空（观测 ' + k + '，期望 ' + exp.length + '）';
    return out;
  }
  const totalO = obs.reduce((s, v) => s + v, 0);
  const totalE = exp.reduce((s, v) => s + v, 0);
  // 期望值自动按观测总量等比缩放（允许传入比例）
  const scaled = totalE > 0 ? exp.map((e) => (e / totalE) * totalO) : exp.map(() => 0);
  let chi2 = 0;
  for (let i = 0; i < k; i++) {
    const e = scaled[i];
    const c = e > 0 ? Math.pow(obs[i] - e, 2) / e : 0;
    chi2 += c;
    out.contributions.push({ index: i, observed: obs[i], expected: e, contribution: c });
  }
  const df = k - 1;
  out.chi2 = chi2;
  out.df = df;
  out.p = chi2Sf(chi2, df);
  out.reject = out.p !== null && out.p < out.alpha;
  out.conclusion = out.reject
    ? '拒绝 H0（p=' + fmtP(out.p) + ' < 0.05），观测分布与期望分布存在显著差异'
    : '不拒绝 H0（p=' + fmtP(out.p) + ' ≥ 0.05），观测分布与期望分布无显著差异';
  if (scaled.some((e) => e > 0 && e < 5)) {
    out.warning = '存在期望频数 < 5 的单元格，卡方近似可能不可靠（建议合并类别）';
  }
  return out;
}

/** 列联表独立性检验（H0: 行变量与列变量独立） */
function chiSquareIndependence(table) {
  const T = cleanMatrix(table);
  const r = T.length;
  const c = r > 0 ? T[0].length : 0;
  const ok = r >= 2 && c >= 2 && T.every((row) => row.length === c);
  const out = {
    test: 'chi-square independence',
    rows: r, cols: c, chi2: null, df: null, p: null, reject: null, alpha: 0.05,
    expected: [], stdResiduals: [], rowTotals: [], colTotals: [], grandTotal: null,
    cramersV: null, conclusion: null,
  };
  if (!ok) {
    out.conclusion = '需要至少 2×2 且各行等长的数值列联表（当前 ' + r + '×' + c + '）';
    return out;
  }
  const rowT = T.map((row) => row.reduce((s, v) => s + v, 0));
  const colT = new Array(c).fill(0);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) colT[j] += T[i][j];
  const total = rowT.reduce((s, v) => s + v, 0);
  out.rowTotals = rowT;
  out.colTotals = colT;
  out.grandTotal = total;
  if (!(total > 0)) {
    out.conclusion = '列联表总量为 0，无法检验';
    return out;
  }
  let chi2 = 0;
  let small = false;
  for (let i = 0; i < r; i++) {
    const erow = [];
    const srow = [];
    for (let j = 0; j < c; j++) {
      const e = (rowT[i] * colT[j]) / total;
      erow.push(e);
      if (e > 0 && e < 5) small = true;
      chi2 += e > 0 ? Math.pow(T[i][j] - e, 2) / e : 0;
      srow.push(e > 0 ? (T[i][j] - e) / Math.sqrt(e * (1 - rowT[i] / total) * (1 - colT[j] / total)) : null);
    }
    out.expected.push(erow);
    out.stdResiduals.push(srow);
  }
  const df = (r - 1) * (c - 1);
  out.chi2 = chi2;
  out.df = df;
  out.p = chi2Sf(chi2, df);
  out.reject = out.p !== null && out.p < out.alpha;
  out.cramersV = Math.sqrt(chi2 / (total * Math.min(r - 1, c - 1)));
  out.conclusion = out.reject
    ? '拒绝 H0（p=' + fmtP(out.p) + ' < 0.05），行变量与列变量不独立（存在关联）'
    : '不拒绝 H0（p=' + fmtP(out.p) + ' ≥ 0.05），无证据表明行变量与列变量相关';
  if (small) out.warning = '存在期望频数 < 5 的单元格，卡方近似可能不可靠（建议合并类别）';
  return out;
}

// ==================================================================
// 7. 相关与回归
// ==================================================================

/** 取成对有效数据（任一侧非法则整对丢弃） */
function pairs(x, y) {
  const X = Array.isArray(x) ? x : [];
  const Y = Array.isArray(y) ? y : [];
  const n = Math.min(X.length, Y.length);
  const px = [];
  const py = [];
  for (let i = 0; i < n; i++) {
    const a = asNumber(X[i]);
    const b = asNumber(Y[i]);
    if (a === null || b === null) continue;
    px.push(a);
    py.push(b);
  }
  return { x: px, y: py, n: px.length, trimmed: n - px.length };
}

/** 平均秩（并列取平均），用于 Spearman */
function rankAvg(a) {
  const idx = a.map((v, i) => ({ v, i }));
  idx.sort((p, q) => p.v - q.v);
  const r = new Array(a.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1; // 秩从 1 开始
    for (let k = i; k <= j; k++) r[idx[k].i] = avg;
    i = j + 1;
  }
  return r;
}

/** Pearson 相关系数及显著性检验 */
function pearson(x, y) {
  const p = pairs(x, y);
  const n = p.n;
  const out = {
    test: 'pearson', r: null, n, t: null, df: null, p: null, r2: null,
    conclusion: null, trimmed: p.trimmed,
  };
  if (n < 3) {
    out.conclusion = '有效数据对不足（n<3），无法进行相关分析';
    return out;
  }
  const mx = mean(p.x);
  const my = mean(p.y);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = p.x[i] - mx;
    const dy = p.y[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) {
    out.conclusion = '某一变量的取值全相同（无变异），相关系数无定义';
    return out;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const df = n - 2;
  out.r = r;
  out.r2 = r * r;
  const denom = 1 - r * r;
  if (denom > 0) {
    const t = r * Math.sqrt(df / denom);
    out.t = t;
    out.df = df;
    out.p = pValue('t', t, df, { tail: 'two' });
    out.reject = out.p !== null && out.p < 0.05;
    out.conclusion = out.reject
      ? '相关显著（r=' + r.toFixed(6) + '，p=' + fmtP(out.p) + ' < 0.05）'
      : '相关不显著（r=' + r.toFixed(6) + '，p=' + fmtP(out.p) + ' ≥ 0.05）';
  } else {
    out.t = Infinity;
    out.df = df;
    out.p = 0;
    out.reject = true;
    out.conclusion = '完全线性相关（|r|=1）';
  }
  return out;
}

/** Spearman 秩相关（并列取平均秩，显著性用 t 近似） */
function spearman(x, y) {
  const p = pairs(x, y);
  const n = p.n;
  const out = {
    test: 'spearman', rho: null, n, t: null, df: null, p: null, conclusion: null,
  };
  if (n < 3) {
    out.conclusion = '有效数据对不足（n<3），无法进行秩相关分析';
    return out;
  }
  const rx = rankAvg(p.x);
  const ry = rankAvg(p.y);
  const base = pearson(rx, ry);
  out.rho = base.r;
  out.t = base.t;
  out.df = base.df;
  out.p = base.p;
  out.reject = base.reject;
  out.conclusion = base.conclusion;
  return out;
}

/** 简单线性回归 y = intercept + slope·x（含回归 ANOVA 与系数检验） */
function linearRegression(x, y) {
  const p = pairs(x, y);
  const n = p.n;
  const out = {
    test: 'simple linear regression',
    n, slope: null, intercept: null, r: null, r2: null, adjR2: null,
    se: null, seSlope: null, seIntercept: null,
    tSlope: null, pSlope: null, tIntercept: null, pIntercept: null,
    df: n - 2, residuals: [], fitted: [],
    anova: { F: null, p: null, ssR: null, ssE: null, ssT: null, dfR: 1, dfE: n - 2, msR: null, msE: null },
    predict: null, conclusion: null,
  };
  if (n < 3) {
    out.conclusion = '有效数据对不足（n<3），无法建立回归模型';
    out.predict = () => null;
    return out;
  }
  const fit = lstsq(p.x, p.y);
  if (fit.slope === null) {
    out.conclusion = '自变量取值全相同，斜率无定义';
    out.predict = () => null;
    return out;
  }
  const b = fit.slope;
  const a = fit.intercept;
  const my = mean(p.y);
  let ssE = 0;
  let ssT = 0;
  const fitted = [];
  const residuals = [];
  for (let i = 0; i < n; i++) {
    const f = a + b * p.x[i];
    fitted.push(f);
    residuals.push(p.y[i] - f);
    ssE += Math.pow(p.y[i] - f, 2);
    ssT += Math.pow(p.y[i] - my, 2);
  }
  const ssR = ssT - ssE;
  const dfE = n - 2;
  const msE = ssE / dfE;
  const msR = ssR / 1;
  const r2 = ssT > 0 ? ssR / ssT : (ssE === 0 ? 1 : 0);
  const r = Math.sign(b) * Math.sqrt(Math.max(0, r2));
  const se = Math.sqrt(msE);
  // 斜率标准误：se / √Sxx
  const mx = mean(p.x);
  let sxx = 0;
  for (let i = 0; i < n; i++) sxx += Math.pow(p.x[i] - mx, 2);
  const seSlope = sxx > 0 ? se / Math.sqrt(sxx) : null;
  const seIntercept = sxx > 0 ? se * Math.sqrt(1 / n + (mx * mx) / sxx) : null;
  out.slope = b;
  out.intercept = a;
  out.r = r;
  out.r2 = r2;
  out.adjR2 = n > 2 ? 1 - ((1 - r2) * (n - 1)) / (n - 2) : null;
  out.se = se;
  out.seSlope = seSlope;
  out.seIntercept = seIntercept;
  out.residuals = residuals;
  out.fitted = fitted;
  if (seSlope !== null && seSlope > 0) {
    out.tSlope = b / seSlope;
    out.pSlope = pValue('t', out.tSlope, dfE, { tail: 'two' });
  } else if (seSlope === 0) {
    out.tSlope = b === 0 ? 0 : Infinity;
    out.pSlope = b === 0 ? 1 : 0;
  }
  if (seIntercept !== null && seIntercept > 0) {
    out.tIntercept = a / seIntercept;
    out.pIntercept = pValue('t', out.tIntercept, dfE, { tail: 'two' });
  }
  out.anova = {
    F: msE > 0 ? msR / msE : (ssR > 0 ? Infinity : 0),
    p: null, ssR, ssE, ssT, dfR: 1, dfE, msR, msE,
  };
  out.anova.p = msE > 0 ? fSf(out.anova.F, 1, dfE) : (ssR > 0 ? 0 : 1);
  out.predict = (xx) => {
    const v = asNumber(xx);
    return v === null ? null : a + b * v;
  };
  out.conclusion = 'y = ' + a.toFixed(6) + ' + ' + b.toFixed(6) + '·x；R²=' + r2.toFixed(6) +
    '，斜率 p=' + fmtP(out.pSlope);
  return out;
}

/**
 * 多元线性回归（最小二乘 + 正态误差推断）
 * @param {number[][]} X 自变量矩阵（每行一个样本，不含截距列）
 * @param {number[]} y 因变量
 * @param {{featureNames?:string[]}} [opts]
 */
function multipleRegression(X, y, opts) {
  const o = opts || {};
  const rows = Array.isArray(X) ? X : [];
  const Y = Array.isArray(y) ? y : [];
  const n = Math.min(rows.length, Y.length);
  const Xc = [];
  const yc = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    let okRow = true;
    const r = Array.isArray(rows[i]) ? rows[i] : [];
    for (let j = 0; j < r.length; j++) {
      const v = asNumber(r[j]);
      if (v === null) { okRow = false; break; }
      row.push(v);
    }
    const vy = asNumber(Y[i]);
    if (!okRow || vy === null) continue;
    Xc.push(row);
    yc.push(vy);
  }
  const N = Xc.length;
  const k = N > 0 ? Xc[0].length : 0;
  const names = Array.isArray(o.featureNames) && o.featureNames.length === k
    ? o.featureNames.slice()
    : Array.from({ length: k }, (_, i) => 'x' + (i + 1));
  const out = {
    test: 'multiple linear regression',
    n: N, k, featureNames: names,
    coefficients: null, se: null, t: null, p: null,
    r2: null, adjR2: null, seEstimate: null,
    df: N - k - 1, predict: () => null, fitted: [], residuals: [], anova: null,
    conclusion: null,
  };
  if (k < 1 || N < k + 2) {
    out.conclusion = '样本量不足（需 n ≥ k+2）：n=' + N + '，k=' + k;
    return out;
  }
  // 设计矩阵（含截距列）
  const D = Xc.map((r) => [1].concat(r));
  const Dt = transpose(D);
  const DtD = matMul(Dt, D);
  const DtDi = matInverse(DtD);
  if (!DtDi) {
    out.conclusion = '设计矩阵奇异（自变量间存在完全共线，或某列为常数）';
    return out;
  }
  const Dty = matMul(Dt, yc.map((v) => [v]));
  const beta = matMul(DtDi, Dty).map((r) => r[0]);
  const fitted = D.map((r) => r.reduce((s, v, i) => s + v * beta[i], 0));
  const residuals = yc.map((v, i) => v - fitted[i]);
  const my = mean(yc);
  let ssE = 0;
  let ssT = 0;
  for (let i = 0; i < N; i++) {
    ssE += residuals[i] * residuals[i];
    ssT += Math.pow(yc[i] - my, 2);
  }
  const dfE = N - k - 1;
  const msE = ssE / dfE;
  const ssR = ssT - ssE;
  const dfR = k;
  const r2 = ssT > 0 ? ssR / ssT : (ssE === 0 ? 1 : 0);
  out.coefficients = beta;
  out.r2 = r2;
  out.adjR2 = 1 - ((1 - r2) * (N - 1)) / dfE;
  out.seEstimate = Math.sqrt(msE);
  out.fitted = fitted;
  out.residuals = residuals;
  const seCoef = beta.map((_, i) => Math.sqrt(Math.max(0, DtDi[i][i] * msE)));
  out.se = seCoef;
  out.t = beta.map((b, i) => (seCoef[i] > 0 ? b / seCoef[i] : (b === 0 ? 0 : Infinity)));
  out.p = out.t.map((t) => (Number.isFinite(t) ? pValue('t', t, dfE, { tail: 'two' }) : 0));
  const F = msE > 0 ? (ssR / dfR) / msE : (ssR > 0 ? Infinity : 0);
  out.anova = {
    F, p: msE > 0 ? fSf(F, dfR, dfE) : (ssR > 0 ? 0 : 1),
    ssR, ssE, ssT, dfR, dfE, msR: ssR / dfR, msE,
  };
  out.predict = (xRow) => {
    const r = Array.isArray(xRow) ? xRow : [xRow];
    if (r.length !== k) return null;
    let s = beta[0];
    for (let i = 0; i < k; i++) {
      const v = asNumber(r[i]);
      if (v === null) return null;
      s += beta[i + 1] * v;
    }
    return s;
  };
  out.conclusion = 'R²=' + r2.toFixed(6) + '，调整 R²=' + out.adjR2.toFixed(6) +
    '，整体 F=' + (Number.isFinite(F) ? F.toFixed(4) : 'Inf') + '（p=' + fmtP(out.anova.p) + '）';
  return out;
}

// ==================================================================
// 8. MSA / GR&R（AIAG MSA 第 4 版）
// ==================================================================

/**
 * GR&R 常数表（AIAG MSA 第 4 版，均值极差法）
 * K1 由"每人每零件重复次数 r"决定，K2 由"操作者数 o"决定，K3 由"零件数 p"决定。
 * 表值直接取手册发表值（4 位有效数字）：
 *   K1: r=2→0.8862, r=3→0.5908
 *   K2: o=2→0.7071, o=3→0.5231
 *   K3: p=2→0.7071, p=3→0.5231, p=4→0.4467, p=5→0.4030, p=6→0.3742,
 *       p=7→0.3534, p=8→0.3375, p=9→0.3249, p=10→0.3146
 * 重要：键必须与"实际次数/人数/零件数"一致（早期版本误按 n-1 索引，导致 r=3 取到 0.4030
 *      而非 0.5908，使 EV 偏小约 32%，进而扭曲 %GRR 与量具可接受性判定）。
 * 越表（手册未列）时用 1/d2(n) 数值公式补齐。
 */
const GRR_K1 = { 2: 0.8862, 3: 0.5908 };
const GRR_K2 = { 2: 0.7071, 3: 0.5231 };
const GRR_K3 = {
  2: 0.7071, 3: 0.5231, 4: 0.4467, 5: 0.4030, 6: 0.3742,
  7: 0.3534, 8: 0.3375, 9: 0.3249, 10: 0.3146,
};

/** 取表值，越界用 1/d2(样本量) 数值公式补齐 */
function kFactor(tbl, key, d2SampleSize) {
  if (tbl[key] !== undefined) return tbl[key];
  const d = rangeConst(d2SampleSize === undefined ? key : d2SampleSize).d2;
  return d ? 1 / d : null;
}

/** 归一化 GR&R 原始数据：number[operator][part][trial] -> 纯数字 + 结构描述 */
function prepGrr(data) {
  const D = [];
  if (Array.isArray(data)) {
    for (const op of data) {
      if (!Array.isArray(op)) continue;
      const parts = [];
      for (const pt of op) {
        if (!Array.isArray(pt)) continue;
        parts.push(clean(pt));
      }
      D.push(parts);
    }
  }
  const operators = D.length;
  const parts = operators > 0 ? D[0].length : 0;
  let trials = 0;
  for (const op of D) {
    for (let p = 0; p < Math.min(op.length, parts); p++) {
      if (op[p].length > trials) trials = op[p].length;
    }
  }
  return { D, operators, parts, trials };
}

/** GR&R 结果统一装配（百分比、ndc、判定结论） */
function assembleGrr(core, opts, ctx) {
  const o = opts || {};
  const tol = asNumber(o.tolerance);
  const ev = core.ev;
  const av = core.av;
  const grr = core.grr;
  const pv = core.pv;
  const tv = core.tv;
  const denom = tv && tv > 0 ? tv : null;
  const pct = (v) => (denom && v !== null ? (v / denom) * 100 : null);
  const pctOfTol = (v) => (tol !== null && tol > 0 && v !== null ? (v / tol) * 100 : null);
  const ndc = tv && tv > 0 && grr !== null ? 1.41 * (pv / grr) : null;
  const pctGrr = pct(grr);
  let conclusion;
  if (pctGrr === null) conclusion = '数据不足，无法给出判定';
  else if (pctGrr < 10) conclusion = '%GRR=' + pctGrr.toFixed(2) + '% < 10%：测量系统可接受';
  else if (pctGrr <= 30) conclusion = '%GRR=' + pctGrr.toFixed(2) + '% 在 10%~30% 区间：'
    + '视应用场合、成本与风险决定是否接受（边缘可接受）';
  else conclusion = '%GRR=' + pctGrr.toFixed(2) + '% > 30%：测量系统不可接受，需改进';
  const ndcNote = ndc !== null
    ? (ndc >= 5 ? '；ndc=' + ndc.toFixed(2) + ' ≥ 5，可分辨能力满足要求'
      : '；ndc=' + ndc.toFixed(2) + ' < 5，可分辨能力不足')
    : '';
  return {
    method: core.method,
    ev, av, grr, pv, tv,
    pctEv: pct(ev), pctAv: pct(av), pctGrr, pctPv: pct(pv),
    pctEvOfTol: pctOfTol(ev),
    pctAvOfTol: pctOfTol(av),
    pctGrrOfTol: pctOfTol(grr),
    pctPvOfTol: pctOfTol(pv),
    tolerance: tol,
    ndc,
    k1: core.k1 || null,
    k2: core.k2 || null,
    k3: core.k3 || null,
    xbarDiff: core.xbarDiff !== undefined ? core.xbarDiff : null,
    rbar: core.rbar !== undefined ? core.rbar : null,
    interaction: core.interaction !== undefined ? core.interaction : null,
    parts: ctx.parts,
    operators: ctx.operators,
    trials: ctx.trials,
    anovaTable: core.anovaTable || null,
    varianceComponents: core.varianceComponents || null,
    conclusion: conclusion + ndcNote,
    note: core.note || null,
    biasWarning: core.biasWarning || null,
  };
}

/**
 * GR&R 均值极差法（AIAG MSA 第 4 版）
 * @param {number[][][]} data data[operator][part][trial]
 * @param {{tolerance?:number}} [opts] tolerance = USL-LSL，用于 %公差 口径
 *
 * 公式（AIAG 手册）：
 *   R̄  = 各 (操作者,零件) 单元内极差的平均
 *   EV = R̄ · K1
 *   X̄diff = 操作者均值 的极差
 *   AV = √( (X̄diff·K2)² − EV²/(n·r) )       （负值截断为 0）
 *   GRR = √(EV² + AV²)
 *   Rp = 零件均值的极差；PV = Rp · K3
 *   TV = √(GRR² + PV²)；%GRR = GRR/TV；ndc = 1.41·PV/GRR
 */
function grrAverageRange(data, opts) {
  const prep = prepGrr(data);
  const { D, operators, parts, trials } = prep;
  const empty = {
    method: 'average-range', ev: null, av: null, grr: null, pv: null, tv: null,
    pctEv: null, pctAv: null, pctGrr: null, pctPv: null, ndc: null,
    k1: null, k2: null, k3: null, xbarDiff: null, rbar: null,
    parts: 0, operators: 0, trials: 0, conclusion: '数据结构非法：需要 data[操作者][零件][试验] 三维数组',
  };
  if (operators < 2 || parts < 2 || trials < 1) return empty;

  const opMeans = [];
  const cellRanges = [];
  const partMeansByOp = [];
  for (let oi = 0; oi < operators; oi++) {
    const pm = [];
    for (let p = 0; p < parts; p++) {
      const cell = (D[oi] && D[oi][p]) ? D[oi][p] : [];
      if (cell.length === 0) { pm.push(null); continue; }
      pm.push(mean(cell));
      if (cell.length >= 2) cellRanges.push(range(cell));
    }
    partMeansByOp.push(pm);
    const valid = pm.filter((v) => v !== null);
    opMeans.push(valid.length ? mean(valid) : null);
  }
  const rbar = cellRanges.length ? mean(cellRanges) : 0;
  const validOpMeans = opMeans.filter((v) => v !== null);
  const xbarDiff = validOpMeans.length >= 2 ? max(validOpMeans) - min(validOpMeans) : 0;

  const k1 = kFactor(GRR_K1, trials, trials);
  const k2 = kFactor(GRR_K2, operators, operators);
  const k3 = kFactor(GRR_K3, parts, parts);
  if (k1 === null || k2 === null || k3 === null) {
    return Object.assign({}, empty, { conclusion: '操作者/零件/试验次数超出可计算范围' });
  }
  const ev = rbar * k1;
  const avSq = Math.pow(xbarDiff * k2, 2) - (ev * ev) / (parts * Math.max(1, trials));
  const av = Math.sqrt(Math.max(0, avSq));
  const grr = Math.sqrt(ev * ev + av * av);

  // 零件均值：先把每个零件的所有操作者合并求均值（AIAG 用零件均值极差）
  const partMeans = [];
  for (let p = 0; p < parts; p++) {
    let s = 0;
    let c = 0;
    for (let oi = 0; oi < operators; oi++) {
      const cell = (D[oi] && D[oi][p]) ? D[oi][p] : [];
      if (cell.length === 0) continue;
      s += mean(cell);
      c++;
    }
    partMeans.push(c ? s / c : null);
  }
  const validPartMeans = partMeans.filter((v) => v !== null);
  const rp = validPartMeans.length >= 2 ? max(validPartMeans) - min(validPartMeans) : 0;
  const pv = rp * k3;
  const tv = Math.sqrt(grr * grr + pv * pv);

  return assembleGrr({
    method: 'average-range',
    ev, av, grr, pv, tv,
    k1, k2, k3, xbarDiff, rbar,
    interaction: null,
    note: '均值极差法不估计"操作者×零件"交互作用（AIAG 均值极差法口径）',
    biasWarning: avSq < 0
      ? 'AV 的平方项为负（X̄diff 过小），按 AIAG 惯例截断为 0，此时 %AV 可能被低估'
      : null,
  }, opts, { parts, operators, trials });
}

/**
 * GR&R 方差分析法（ANOVA，含操作者×零件交互作用）
 * 平衡设计下与 AIAG MSA 第 4 版 ANOVA 表完全一致；
 * 非平衡设计用期望均方系数（EMS）法近似估计方差分量，并在 note 中提示。
 *
 * 方差分量：EV = MSE；INT = max(0, (MS_INT−MSE)/r')；
 *           AV = max(0, (MS_O−MS_INT)/(k·r'))；PV = max(0, (MS_P−MS_INT)/(o·r'))
 *   r' = Σn_ij² 系数，平衡时退化为 r（重复次数）。
 */
function grrAnova(data, opts) {
  const prep = prepGrr(data);
  const { D, operators, parts, trials } = prep;
  const empty = {
    method: 'anova', ev: null, av: null, grr: null, pv: null, tv: null,
    pctEv: null, pctAv: null, pctGrr: null, pctPv: null, ndc: null,
    parts: 0, operators: 0, trials: 0, conclusion: '数据结构非法：需要 data[操作者][零件][试验] 三维数组',
  };
  if (operators < 2 || parts < 2 || trials < 2) {
    // 试验次数 < 2 时无法估计纯误差
    if (operators >= 2 && parts >= 2 && trials < 2) {
      return Object.assign({}, empty, { parts, operators, trials, conclusion: 'ANOVA 法要求每单元重复次数 ≥2' });
    }
    return empty;
  }

  const cells = [];
  let N = 0;
  let grandSum = 0;
  for (let oi = 0; oi < operators; oi++) {
    for (let p = 0; p < parts; p++) {
      const cell = (D[oi] && D[oi][p]) ? D[oi][p].slice() : [];
      const s = cell.reduce((x, v) => x + v, 0);
      cells.push({ o: oi, p, n: cell.length, sum: s, mean: cell.length ? s / cell.length : null, vals: cell });
      N += cell.length;
      grandSum += s;
    }
  }
  if (N === 0) return Object.assign({}, empty, { conclusion: '无有效测量数据' });
  const grand = grandSum / N;

  // 平方和
  const opSums = new Array(operators).fill(0);
  const opCnt = new Array(operators).fill(0);
  const partSums = new Array(parts).fill(0);
  const partCnt = new Array(parts).fill(0);
  let ssCells = 0;
  let ssErr = 0;
  for (const c of cells) {
    if (c.n === 0) continue;
    opSums[c.o] += c.sum;
    opCnt[c.o] += c.n;
    partSums[c.p] += c.sum;
    partCnt[c.p] += c.n;
    ssCells += c.n * Math.pow(c.mean - grand, 2);
    for (const v of c.vals) ssErr += Math.pow(v - c.mean, 2);
  }
  const ssO = opSums.reduce((s, sum, i) => {
    if (opCnt[i] === 0) return s;
    return s + Math.pow(sum, 2) / opCnt[i];
  }, 0) - Math.pow(grandSum, 2) / N;
  const ssP = partSums.reduce((s, sum, i) => {
    if (partCnt[i] === 0) return s;
    return s + Math.pow(sum, 2) / partCnt[i];
  }, 0) - Math.pow(grandSum, 2) / N;
  const ssInt = ssCells - ssO - ssP;

  const dfO = operators - 1;
  const dfP = parts - 1;
  const dfCells = cells.filter((c) => c.n > 0).length - 1;
  const dfInt = Math.max(0, dfCells - dfO - dfP);
  const dfErr = N - cells.filter((c) => c.n > 0).length;

  const msO = dfO > 0 ? ssO / dfO : null;
  const msP = dfP > 0 ? ssP / dfP : null;
  const msInt = dfInt > 0 ? Math.max(0, ssInt) / dfInt : null;
  const msErr = dfErr > 0 ? ssErr / dfErr : null;

  // 期望均方系数（EMS）：平衡设计下退化为重复次数 r；非平衡设计用下式加权，公式来源为
  // 随机效应模型下各效应的期望均方系数，例如
  //   E[MS_Operator] = σ²e + r'σ²_int + coefOp·σ²_op
  //   其中 coefOp = (1/(o−1))·Σ_i n_i·(1 − n_i/N)，coefPart 同理按零件聚合。
  let coefInt = 0; // r' = (N − Σn_ij²/N) / (nCells − 1)
  let sumN2 = 0;
  let nCells = 0;
  const cellCounts = cells.filter((c) => c.n > 0);
  for (const c of cellCounts) {
    sumN2 += c.n * c.n;
    nCells++;
  }
  if (nCells > 1) coefInt = (N - sumN2 / N) / (nCells - 1);
  const coefOp = dfO > 0
    ? (opCnt.reduce((s, cnt) => s + (cnt > 0 ? cnt * (1 - cnt / N) : 0), 0)) / dfO
    : 0;
  const coefPart = dfP > 0
    ? (partCnt.reduce((s, cnt) => s + (cnt > 0 ? cnt * (1 - cnt / N) : 0), 0)) / dfP
    : 0;

  const ev = msErr;
  const intVar = (msInt !== null && msErr !== null && coefInt > 0) ? Math.max(0, (msInt - msErr) / coefInt) : 0;
  const av = (msO !== null && msInt !== null && coefOp > 0) ? Math.max(0, (msO - msInt) / coefOp) : 0;
  const pv = (msP !== null && msInt !== null && coefPart > 0) ? Math.max(0, (msP - msInt) / coefPart) : 0;
  const grr = ev + av + intVar; // 方差相加
  const grrSd = Math.sqrt(grr);
  const tv = Math.sqrt(grr + pv);

  const anovaTable = [
    { source: '操作者(Operator)', df: dfO, ss: ssO, ms: msO, F: (msInt && msInt > 0 && msO !== null) ? msO / msInt : null },
    { source: '零件(Part)', df: dfP, ss: ssP, ms: msP, F: (msInt && msInt > 0 && msP !== null) ? msP / msInt : null },
    { source: '交互(Operator×Part)', df: dfInt, ss: ssInt, ms: msInt, F: (msErr && msErr > 0 && msInt !== null) ? msInt / msErr : null },
    { source: '重复性(Repeatability/Error)', df: dfErr, ss: ssErr, ms: msErr, F: null },
    { source: '合计(Total)', df: N - 1, ss: ssO + ssP + ssInt + ssErr, ms: null, F: null },
  ];

  const res = assembleGrr({
    method: 'anova',
    ev: Math.sqrt(Math.max(0, ev)),
    av: Math.sqrt(Math.max(0, av)),
    grr: grrSd,
    pv: Math.sqrt(Math.max(0, pv)),
    tv,
    interaction: Math.sqrt(Math.max(0, intVar)),
    anovaTable,
    varianceComponents: { repeatability: ev, operator: av, interaction: intVar, part: pv, total: grr + pv },
    note: 'ANOVA 法（含交互作用）：EV=√MSE，AV=√((MS_O−MS_INT)/coef)，'
      + 'INT=√((MS_INT−MSE)/coef)，PV=√((MS_P−MS_INT)/coef)；coef 为期望均方系数'
      + (nCells === operators * parts && new Set(cells.map((c) => c.n)).size === 1
        ? '（平衡设计，coef 退化为重复次数 r）' : '（非平衡设计，按单元样本量加权近似）'),
  }, opts, { parts, operators, trials });
  // ANOVA 法附加检验信息，便于判断交互/操作者是否显著
  res.anovaF = {
    operator: anovaTable[0].F,
    operatorP: anovaTable[0].F !== null ? fSf(anovaTable[0].F, dfO, dfInt || dfErr) : null,
    part: anovaTable[1].F,
    partP: anovaTable[1].F !== null ? fSf(anovaTable[1].F, dfP, dfInt || dfErr) : null,
    interaction: anovaTable[2].F,
    interactionP: anovaTable[2].F !== null ? fSf(anovaTable[2].F, dfInt, dfErr) : null,
  };
  return res;
}

// ==================================================================
// 9. 离散分布 / 抽样 / 其他常用工具
// ==================================================================

/** 二项分布概率质量函数 P(X=k)；k/n 按整数解析（2.0、"3" 均可） */
function binomPmf(k, n, p) {
  const K = asInt(k);
  const N = asInt(n);
  const P = asNumber(p);
  if (K === null || N === null || P === null) return null;
  if (!(N >= 0) || P < 0 || P > 1 || K < 0 || K > N) return 0;
  if (P === 0) return K === 0 ? 1 : 0;
  if (P === 1) return K === N ? 1 : 0;
  const lg = logGamma(N + 1) - logGamma(K + 1) - logGamma(N - K + 1);
  return Math.exp(lg + K * Math.log(P) + (N - K) * Math.log(1 - P));
}

/** 二项分布累积概率 P(X ≤ k)（用不完全 Beta 的精确关系，避免逐项求和误差） */
function binomCdf(k, n, p) {
  const N = asInt(n);
  const P = asNumber(p);
  if (N === null || P === null) return null;
  if (P < 0 || P > 1 || !(N >= 0)) return null;
  const K = Math.floor(numOr(k, -1));
  if (K < 0) return 0;
  if (K >= N) return 1;
  // P(X ≤ k) = I_{1-p}(n-k, k+1)
  return betai(N - K, K + 1, 1 - P);
}

/** 泊松分布概率质量函数 P(X=k) */
function poissonPmf(k, lambda) {
  const K = asInt(k);
  const L = asNumber(lambda);
  if (K === null || L === null || L < 0 || K < 0) return 0;
  if (L === 0) return K === 0 ? 1 : 0;
  return Math.exp(-L + K * Math.log(L) - logGamma(K + 1));
}

/** 泊松分布累积概率 P(X ≤ k) = Q(k+1, λ)（上不完全 Gamma） */
function poissonCdf(k, lambda) {
  const L = asNumber(lambda);
  if (L === null || L < 0) return null;
  const K = Math.floor(numOr(k, -1));
  if (K < 0) return 0;
  if (L === 0) return 1;
  return gammq(K + 1, L);
}

/**
 * DPMO -> 西格玛水平（业界 1.5σ 偏移口径，与 Motorola/ASQ 表一致）
 *   Z_benchmark = Φ⁻¹(1 − DPMO/1e6) + 1.5
 * 例：DPMO=6210 -> 3.9997σ ≈ 4.0σ；DPMO=3.4 -> 6.0σ。
 */
function dpmoToSigma(dpmo) {
  const D = asNumber(dpmo);
  if (D === null || D < 0) return null;
  if (D === 0) return Infinity;
  if (D >= 1e6) return -Infinity;
  const z = normalInvStd(1 - D / 1e6);
  if (z === null) return null;
  return z + 1.5;
}

/** 西格玛水平 -> DPMO（同样采用 1.5σ 偏移口径） */
function sigmaToDpmo(sigma) {
  const S = asNumber(sigma);
  if (S === null) return null;
  const z = S - 1.5;
  const p = 1 - normalCdfStd(z);
  return roundTo(p * 1e6, 6);
}

/**
 * 质量成本（COPQ）汇总
 * @param {{prevention?,appraisal?,internalFailure?,externalFailure?,salesRevenue?,profitMargin?}} input
 *        金额单位自定（元/万元均可），profitMargin 为利润率（0~1 或百分数均可）
 * @returns 各科目金额、占比、质量成本率等
 */
function qualityCost(input) {
  const i = input || {};
  const p = numOr(i.prevention, 0);
  const a = numOr(i.appraisal, 0);
  const inf = numOr(i.internalFailure, 0);
  const ext = numOr(i.externalFailure, 0);
  const rev = asNumber(i.salesRevenue);
  const pmRaw = asNumber(i.profitMargin);
  const pm = pmRaw === null ? null : (pmRaw > 1 ? pmRaw / 100 : pmRaw); // 兼容百分数输入
  const total = p + a + inf + ext;
  const conformance = p + a;          // 符合性成本（预防+鉴定）
  const nonconformance = inf + ext;   // 不符合性成本（内外部失败）
  const pct = (v) => (total > 0 ? (v / total) * 100 : null);
  const out = {
    prevention: p,
    appraisal: a,
    internalFailure: inf,
    externalFailure: ext,
    total,
    conformanceCost: conformance,
    nonconformanceCost: nonconformance,
    copq: nonconformance,
    pctPrevention: pct(p),
    pctAppraisal: pct(a),
    pctInternalFailure: pct(inf),
    pctExternalFailure: pct(ext),
    pctConformance: pct(conformance),
    pctNonconformance: pct(nonconformance),
    salesRevenue: rev,
    profitMargin: pm,
    qualityCostRate: rev !== null && rev > 0 ? (total / rev) * 100 : null,     // 质量成本率 %
    copqRate: rev !== null && rev > 0 ? (nonconformance / rev) * 100 : null,   // COPQ 占销售额 %
    profitImpact: pm !== null && pm > 0 ? nonconformance / pm : null,          // 侵蚀多少销售额的利润
    conclusion: null,
  };
  const ratio = conformance > 0 ? nonconformance / conformance : null;
  out.conformanceRatio = ratio;
  out.conclusion = '总质量成本 ' + total.toFixed(2) + '，其中不符合性成本（COPQ）' +
    nonconformance.toFixed(2) + '（占 ' + (pct(nonconformance) === null ? 'N/A' : pct(nonconformance).toFixed(2)) + '%）' +
    (ratio !== null ? '；不符合性/符合性成本比 = ' + ratio.toFixed(2)
      + (ratio > 1 ? '（>1，说明"事后救火"支出高于预防投入，应加大预防投入）' : '（≤1，预防投入相对充分）') : '') +
    (out.qualityCostRate !== null ? '；质量成本率 = ' + out.qualityCostRate.toFixed(2) + '%' : '');
  return out;
}

/** 简单移动平均；窗口不足的前 window-1 个位置返回 null */
function movingAverage(a, window) {
  const d = clean(a);
  const w = Math.floor(numOr(window, 0));
  if (!(w >= 1) || d.length === 0) return [];
  const out = [];
  let s = 0;
  for (let i = 0; i < d.length; i++) {
    s += d[i];
    if (i >= w) s -= d[i - w];
    out.push(i >= w - 1 ? s / w : null);
  }
  return out;
}

/** 一次指数平滑 z_i = α·x_i + (1-α)·z_{i-1}，z_0 = x_0 */
function exponentialSmooth(a, alpha) {
  const d = clean(a);
  const al = asNumber(alpha);
  if (d.length === 0) return [];
  const A = al === null || al <= 0 || al > 1 ? 0.3 : al;
  const out = [d[0]];
  for (let i = 1; i < d.length; i++) out.push(A * d[i] + (1 - A) * out[i - 1]);
  return out;
}

/** 线性趋势斜率（对下标做最小二乘，正值上升、负值下降） */
function trendSlope(a) {
  const d = clean(a);
  const n = d.length;
  if (n < 2) return 0;
  const x = [];
  for (let i = 0; i < n; i++) x.push(i);
  const fit = lstsq(x, d);
  return fit.slope === null ? 0 : fit.slope;
}

// ==================================================================
// 10. 导出
// ==================================================================

module.exports = {
  // ---------- 基础描述统计 ----------
  sum, mean, variance, sd, median, quantile,
  min, max, range, cv, iqr, describe,

  // ---------- 分布函数 ----------
  normalPdf, normalCdf, normalInv,
  tCdf, tInv, fCdf, chi2Cdf, chi2Inv,
  // 附加（内部实现所必需，亦可供工具层直接使用）
  tSf, fSf, chi2Sf, fInv, erf, erfc, logGamma, betai, gammp, gammq,
  normalInvStd, pValue,

  // ---------- 过程能力 ----------
  capability,

  // ---------- 控制图 ----------
  chartIMR, chartXbarR, chartXbarS, chartEWMA,
  // 附加：控制图系数查询（标准表 / 无偏常数公式）
  rangeConst, sdConst, controlChartConstants: CHART_CONST,

  // ---------- 八大判异准则 ----------
  spcRules,

  // ---------- 直方图 / 帕累托 ----------
  histogram, pareto,

  // ---------- 假设检验 ----------
  tTest1, tTest2, pairedT, anova1,
  chiSquareGOF, chiSquareIndependence,

  // ---------- 相关与回归 ----------
  pearson, spearman, linearRegression, multipleRegression,

  // ---------- MSA / GR&R ----------
  grrAverageRange, grrAnova,

  // ---------- 抽样 / 其他常用 ----------
  binomPmf, binomCdf, poissonPmf, poissonCdf,
  dpmoToSigma, sigmaToDpmo,
  qualityCost,
  movingAverage, exponentialSmooth, trendSlope,
};


