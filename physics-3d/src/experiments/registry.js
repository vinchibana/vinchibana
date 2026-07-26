/**
 * 实验清单。每个实验用动态 import 按需加载，首页只加载元信息。
 */
export const experiments = [
  {
    id: 'galileo-incline',
    title: '伽利略斜面实验',
    subtitle: 'Galileo · 斜面上的匀加速运动',
    scientist: '伽利略·伽利雷',
    year: '1604',
    field: '力学 · 运动学',
    accent: '#59c1ff',
    summary:
      '用斜面"冲淡"重力，让下落慢到可以测量。伽利略由此发现位移与时间平方成正比，等时间隔内的位移之比是 1 : 3 : 5 : 7。',
    tags: ['匀变速直线运动', 's ∝ t²', '自由落体'],
    load: () => import('./galileo-incline.js'),
  },
  {
    id: 'torricelli',
    title: '托里拆利实验',
    subtitle: 'Torricelli · 测出大气压的高度',
    scientist: '埃万杰利斯塔·托里拆利',
    year: '1643',
    field: '力学 · 压强',
    accent: '#c084fc',
    summary:
      '一根一米长的玻璃管灌满水银倒扣在水银槽里，水银柱只下降到 760 mm 就停住了——顶端留下人类第一次制造的真空。',
    tags: ['大气压强', 'p = ρgh', '760 mmHg'],
    load: () => import('./torricelli.js'),
  },
  {
    id: 'newton-prism',
    title: '牛顿棱镜色散实验',
    subtitle: 'Newton · 白光的本来面目',
    scientist: '艾萨克·牛顿',
    year: '1666',
    field: '光学',
    accent: '#ff8fb1',
    summary:
      '一束阳光穿过三棱镜散成七色光带。牛顿再用光阑取出单色光射入第二块棱镜，证明白光是复色光，而单色光不可再分。',
    tags: ['光的色散', '折射定律', '判决性实验'],
    load: () => import('./newton-prism.js'),
  },
  {
    id: 'oersted',
    title: '奥斯特电流磁效应',
    subtitle: 'Ørsted · 小磁针的偏转',
    scientist: '汉斯·奥斯特',
    year: '1820',
    field: '电磁学',
    accent: '#4ade80',
    summary:
      '课堂上的一次意外发现：导线通电的瞬间，下方的小磁针猛地偏转。电与磁从此不再是两件事。',
    tags: ['电流的磁效应', '安培定则', '磁感线'],
    load: () => import('./oersted.js'),
  },
  {
    id: 'archimedes',
    title: '阿基米德浮力实验',
    subtitle: 'Archimedes · 王冠里的秘密',
    scientist: '阿基米德',
    year: '约公元前 245 年',
    field: '力学 · 流体',
    accent: '#fbbf24',
    summary:
      '浸在液体里的物体受到的浮力，等于它排开的液体所受的重力。靠这条定律，阿基米德识破了掺银的国王金冠。',
    tags: ['阿基米德原理', 'F = ρgV排', '沉浮条件'],
    load: () => import('./archimedes.js'),
  },
];

export const findExperiment = (id) => experiments.find((e) => e.id === id);
