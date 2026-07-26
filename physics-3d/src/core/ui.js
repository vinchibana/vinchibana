/**
 * 侧边栏控件工厂：滑块 / 分段选择 / 开关 / 按钮 / 数据读数。
 * 所有控件都返回一个带 set() 的句柄，方便实验代码在"重置"时同步 UI。
 */

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

export class Panel {
  constructor(root) {
    this.root = root;
    this.current = root;
  }

  /** 开一个新分组，之后添加的控件都进这个分组 */
  section(title) {
    const sec = el('div', 'sec');
    sec.appendChild(el('h4', null, title));
    this.root.appendChild(sec);
    this.current = sec;
    return this;
  }

  html(markup, cls = 'prose') {
    const box = el('div', cls, markup);
    this.current.appendChild(box);
    return box;
  }

  callout(markup) {
    return this.html(markup, 'callout');
  }

  /**
   * 滑块。fmt 决定数值显示方式。
   * @returns {{set:(v:number)=>void, get:()=>number, el:HTMLElement}}
   */
  slider({ label, min, max, step = 1, value, unit = '', fmt, onInput }) {
    const wrap = el('div', 'ctl');
    const head = el('div', 'ctl-head');
    const name = el('span', null, label);
    const val = el('span', 'val');
    head.append(name, val);

    const input = el('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;

    wrap.append(head, input);
    this.current.appendChild(wrap);

    const format = fmt || ((v) => `${v}${unit}`);
    const paint = (v) => {
      val.textContent = format(v);
    };
    paint(value);

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      paint(v);
      onInput?.(v);
    });

    return {
      el: wrap,
      get: () => parseFloat(input.value),
      set: (v, silent = true) => {
        input.value = v;
        paint(v);
        if (!silent) onInput?.(v);
      },
      setLabel: (t) => {
        name.textContent = t;
      },
    };
  }

  /**
   * 分段选择器（互斥按钮组）。
   * @param options [{value, label}]
   */
  segmented({ label, options, value, onChange }) {
    const wrap = el('div', 'ctl');
    if (label) {
      const head = el('div', 'ctl-head');
      head.appendChild(el('span', null, label));
      wrap.appendChild(head);
    }
    const seg = el('div', 'seg');
    const buttons = new Map();
    let cur = value;

    for (const opt of options) {
      const b = el('button', null, opt.label);
      b.addEventListener('click', () => {
        if (cur === opt.value) return;
        cur = opt.value;
        sync();
        onChange?.(opt.value);
      });
      buttons.set(opt.value, b);
      seg.appendChild(b);
    }
    const sync = () => {
      for (const [v, b] of buttons) b.classList.toggle('on', v === cur);
    };
    sync();

    wrap.appendChild(seg);
    this.current.appendChild(wrap);

    return {
      el: wrap,
      get: () => cur,
      set: (v, silent = true) => {
        cur = v;
        sync();
        if (!silent) onChange?.(v);
      },
    };
  }

  toggle({ label, value = false, onChange }) {
    const wrap = el('div', 'switch');
    wrap.append(el('span', null, label), el('span', 'track'));
    let on = value;
    const sync = () => wrap.classList.toggle('on', on);
    sync();
    wrap.addEventListener('click', () => {
      on = !on;
      sync();
      onChange?.(on);
    });
    this.current.appendChild(wrap);
    return {
      el: wrap,
      get: () => on,
      set: (v, silent = true) => {
        on = v;
        sync();
        if (!silent) onChange?.(v);
      },
    };
  }

  buttons(list) {
    const row = el('div', 'btn-row');
    const handles = {};
    for (const b of list) {
      const node = el('button', `btn${b.primary ? ' primary' : ''}`, b.label);
      node.addEventListener('click', () => b.onClick?.(node));
      row.appendChild(node);
      handles[b.key ?? b.label] = node;
    }
    this.current.appendChild(row);
    return handles;
  }

  /** 数据读数网格；返回 stat(name, unit) 用于注册每个读数 */
  statGrid() {
    const grid = el('div', 'stats');
    this.current.appendChild(grid);
    return {
      add(key, { unit = '', hi = false, wide = false, value = '—' } = {}) {
        const box = el('div', `stat${hi ? ' hi' : ''}${wide ? ' wide' : ''}`);
        box.appendChild(el('div', 'k', key));
        const v = el('div', 'v');
        box.appendChild(v);
        grid.appendChild(box);
        const paint = (text) => {
          v.innerHTML = `${text}${unit ? `<small>${unit}</small>` : ''}`;
        };
        paint(value);
        return { set: paint, el: box };
      },
    };
  }
}
