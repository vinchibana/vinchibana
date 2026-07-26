/** 公共物理常量与小工具函数（全部使用国际单位制） */

export const G = 9.8; // 重力加速度 m/s²
export const MU0 = 4 * Math.PI * 1e-7; // 真空磁导率 T·m/A
export const P0 = 101325; // 标准大气压 Pa

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = (rad) => (rad * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/**
 * 国际标准大气模型（对流层部分），返回给定海拔的大气压强 (Pa)。
 * p = p0 · (1 − 2.25577×10⁻⁵ · h)^5.25588
 */
export function pressureAtAltitude(h) {
  return P0 * Math.pow(1 - 2.25577e-5 * clamp(h, 0, 11000), 5.25588);
}

/**
 * 柯西色散公式 n(λ) = A + B/λ²（λ 单位 μm）。
 * 用于棱镜实验中不同颜色光的折射率。
 */
export function cauchy(lambdaNm, A, B) {
  const um = lambdaNm / 1000;
  return A + B / (um * um);
}

/**
 * 波长(nm) → RGB(0~1)，基于常用的可见光近似算法。
 * 用于把 380~780nm 的单色光画成人眼看到的颜色。
 */
export function wavelengthToRGB(nm) {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / (440 - 380);
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / (645 - 580);
  } else if (nm <= 780) {
    r = 1;
  }
  // 视觉在光谱两端的衰减
  let f = 1;
  if (nm >= 380 && nm < 420) f = 0.3 + (0.7 * (nm - 380)) / 40;
  else if (nm > 700 && nm <= 780) f = 0.3 + (0.7 * (780 - nm)) / 80;
  const gamma = 0.8;
  const adj = (c) => (c <= 0 ? 0 : Math.pow(c * f, gamma));
  return [adj(r), adj(g), adj(b)];
}

/** 颜色名称，用于读数展示 */
export function colorName(nm) {
  if (nm < 435) return '紫';
  if (nm < 460) return '蓝紫';
  if (nm < 500) return '蓝';
  if (nm < 560) return '绿';
  if (nm < 590) return '黄';
  if (nm < 625) return '橙';
  return '红';
}

/** 数字格式化：保留 n 位小数并去掉多余的 0 */
export const fx = (v, n = 2) => {
  if (!Number.isFinite(v)) return '—';
  return Number(v.toFixed(n)).toString();
};
