// Landing do OrgMap: uma câmera sobre o mapa de círculos,
// guiada pela rolagem nativa. Dados fictícios (Pagoana).
import { hierarchy, pack } from "d3-hierarchy";

const DATA = {
  name: "Pagoana",
  children: [
    {
      name: "Relacionamento",
      children: [
        { name: "Atendimento", value: 1.7 },
        { name: "Escuta" },
        { name: "Comunicação" },
        { name: "Parcerias" },
      ],
    },
    {
      name: "Produto",
      children: [
        { name: "Pesquisa" },
        { name: "Design" },
        { name: "Código" },
        { name: "Qualidade" },
        { name: "Suporte" },
      ],
    },
    {
      name: "Operações",
      children: [
        { name: "Finanças" },
        { name: "Pessoas" },
        { name: "Jurídico" },
      ],
    },
    { name: "Estratégia" },
    { name: "Facilitação" },
  ],
};
const NEW_LINE = "Manter quem fez uma solicitação informado sobre o andamento.";
// O que cada papel cuida, para a espiada ao tocar no mapa.
const ROLE_INFO = {
  Atendimento: "Acolher solicitações e levar cada pessoa à resposta.",
  Escuta: "Ouvir quem usa o serviço e trazer o que aprendeu.",
  Comunicação: "Manter todos informados sobre o que muda.",
  Parcerias: "Cuidar das relações com organizações parceiras.",
  Pesquisa: "Investigar necessidades antes de construir.",
  Design: "Dar forma clara ao que será entregue.",
  Código: "Construir e manter o que está no ar.",
  Qualidade: "Conferir se o que sai funciona como combinado.",
  Suporte: "Resolver problemas de quem já usa.",
  Finanças: "Cuidar do caixa e das contas.",
  Pessoas: "Acompanhar entradas, saídas e desenvolvimento.",
  Jurídico: "Zelar por contratos e obrigações legais.",
  Estratégia: "Propor rumos e prioridades.",
  Facilitação: "Conduzir reuniões e processos de decisão.",
};
const TOTAL = 10; // unidades da partitura
const PAD = 30;
const ROOT_PAD = 40; // faixa interna dos círculos, em unidades de mundo

const root = document.documentElement;
const film = document.querySelector(".film");
const stage = document.querySelector(".stage");
const svg = document.querySelector(".map");
const cameraG = document.querySelector(".camera");
const lights = document.querySelector(".lights");
const sheet = document.querySelector(".sheet");
const sheetInner = document.querySelector(".sheet-inner");
const ghost = document.querySelector(".sheet-ghost");
const sheetTitle = sheet.querySelector("h2");
const peek = document.querySelector(".peek");
const typed = document.querySelector(".typed");
const rest = document.querySelector(".rest");
const progressBar = document.querySelector(".progress i");
const cards = [...document.querySelectorAll(".card")].map((el) => ({
  el,
  a: Number(el.dataset.in),
  b: Number(el.dataset.out),
}));
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const shortViewport = matchMedia("(max-height: 560px)");

// Layout do mapa em unidades de mundo (1000 × 1000)
const tree = pack()
  .size([1000, 1000])
  .padding((d) => (d.depth === 0 ? ROOT_PAD : PAD))(
  hierarchy(DATA).sum((d) => (d.children ? 0 : (d.value ?? 1))),
);
const NS = "http://www.w3.org/2000/svg";
const nodes = tree.descendants().map((d) => {
  const g = document.createElementNS(NS, "g");
  const kind = d.depth === 0 ? "root" : d.children ? "circle" : "role";
  g.setAttribute("class", kind);
  const c = document.createElementNS(NS, "circle");
  c.setAttribute("cx", d.x);
  c.setAttribute("cy", d.y);
  c.setAttribute("r", d.r);
  const t = document.createElementNS(NS, "text");
  let arc = null;
  if (kind === "role") {
    t.textContent = d.data.name;
    g.append(c, t);
  } else {
    // Nome do círculo acompanha a borda interna, na faixa livre do topo.
    arc = document.createElementNS(NS, "path");
    arc.setAttribute("class", "arc");
    arc.id = `arc-${d.data.name}`;
    const tp = document.createElementNS(NS, "textPath");
    tp.setAttribute("href", `#${arc.id}`);
    tp.setAttribute("startOffset", "50%");
    tp.textContent = d.data.name;
    t.append(tp);
    g.append(c, arc, t);
  }
  cameraG.append(g);
  return { d, g, t, arc, kind, name: d.data.name };
});
const byName = (n) => nodes.find((x) => x.name === n);
const nRoot = nodes[0];
const nCircle = byName("Relacionamento");
const nRole = byName("Atendimento");
const inCircle = new Set(nCircle.d.descendants());
const pulse = document.createElementNS(NS, "circle");
pulse.setAttribute("class", "pulse");
pulse.setAttribute("cx", nRole.d.x);
pulse.setAttribute("cy", nRole.d.y);
pulse.setAttribute("vector-effect", "non-scaling-stroke");
cameraG.append(pulse);

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
// Trecho linear; com movimento reduzido vira corte seco.
const seg = (u, a, b) => {
  const t = clamp((u - a) / (b - a));
  return reduced.matches ? (t < 0.5 ? 0 : 1) : t;
};
const move = (u, a, b) => ease(seg(u, a, b));

let lastState = "";
let lastTyped = -1;
let vw = 0;
let vh = 0;
let S = null; // retângulo final da folha
let G = null; // medidas do título viajante
let camK = 1; // escala atual da câmera
let calm = 1; // 1 = mapa em repouso, livre para respirar
let cams = null;

function cam(node, ax, ay, diameter) {
  const k = diameter / (2 * node.d.r);
  return {
    k,
    x: node.d.x - (ax - vw / 2) / k,
    y: node.d.y - (ay - vh / 2) / k,
  };
}
// Zoom em torno de um ponto fixo da tela: sem "nadar" lateralmente.
function mix(c0, c1, t) {
  const k = c0.k * (c1.k / c0.k) ** t;
  const span = 1 - c0.k / c1.k;
  const w = Math.abs(span) < 1e-6 ? 1 - t : (c0.k / k - c0.k / c1.k) / span;
  return { k, x: c1.x + (c0.x - c1.x) * w, y: c1.y + (c0.y - c1.y) * w };
}

// Altura da folha no estado mais cheio (acordo adotado), para caber sem sobra.
function sheetHeight(width) {
  sheet.classList.add("measuring");
  const state = sheet.dataset.state;
  sheet.dataset.state = "adopted";
  typed.textContent = NEW_LINE;
  rest.textContent = "";
  sheetInner.style.width = `${width}px`;
  sheetInner.style.height = "auto";
  const h = sheetInner.offsetHeight;
  sheetInner.style.width = "";
  sheetInner.style.height = "";
  sheet.dataset.state = state ?? "none";
  sheet.classList.remove("measuring");
  lastTyped = -1;
  return h;
}

function measure() {
  if (!stage.clientWidth || !stage.clientHeight) return;
  vw = stage.clientWidth;
  vh = stage.clientHeight;
  const mobile = vw < 760;
  const sw = mobile ? vw - 32 : Math.min(540, vw * 0.4);
  const natural = sheetHeight(sw);
  if (mobile) {
    const h = Math.min(natural, vh * 0.62);
    S = { w: vw - 32, h, cx: vw / 2, cy: vh - 22 - h / 2 };
    cams = {
      // No celular o mapa sangra pelas laterais para os nomes caberem.
      wide: cam(nRoot, vw / 2, vh * 0.76, vw * 1.1),
      circle: cam(nCircle, S.cx, S.cy, vw * 1.18),
    };
  } else {
    S = { w: sw, h: Math.min(natural, vh * 0.8), cx: vw * 0.69, cy: vh * 0.54 };
    cams = {
      wide: cam(nRoot, vw * 0.69, vh * 0.54, Math.min(vh * 0.82, vw * 0.54)),
      circle: cam(nCircle, S.cx, S.cy, Math.min(vh * 0.88, vw * 0.56)),
    };
  }
  cams.role = cam(nRole, S.cx, S.cy, Math.min(S.w, S.h) * 0.92);
  // Título que viaja do círculo até o cabeçalho da folha.
  G = {
    w: ghost.offsetWidth,
    h: ghost.offsetHeight,
    x: sheetTitle.offsetLeft,
    y: sheetTitle.offsetTop,
    start: 17 / parseFloat(getComputedStyle(ghost).fontSize),
  };
  // Luz baixa com um foco sobre a folha.
  lights.style.background = `radial-gradient(circle at ${S.cx}px ${S.cy}px, rgb(16 38 43 / 0.72) 0, #10262b ${Math.round(Math.max(S.w, S.h) * 0.95)}px)`;
  sheet.style.setProperty("--sw", `${S.w}px`);
  sheet.style.setProperty("--sh", `${S.h}px`);
  svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
}

function render(p) {
  if (!cams) return;
  const u = p * TOTAL;

  // Câmera
  const zoomA = move(u, 0.6, 2.0);
  const zoomB = move(u, 2.8, 3.7);
  const back = move(u, 8.3, 9.25);
  const c =
    u < 2.8
      ? mix(cams.wide, cams.circle, zoomA)
      : u < 8.3
        ? mix(cams.circle, cams.role, zoomB)
        : mix(cams.role, cams.wide, back);
  camK = c.k;
  const tx = vw / 2 - c.x * c.k;
  const ty = vh / 2 - c.y * c.k;
  cameraG.setAttribute("transform", `translate(${tx} ${ty}) scale(${c.k})`);

  // Folha: o círculo do papel vira o documento, e volta.
  const morph = Math.min(move(u, 3.6, 4.2), 1 - move(u, 7.85, 8.4));
  const changed = u >= 7.3;
  const dark = Math.min(move(u, 4.9, 5.4), 1 - move(u, 7.25, 7.6));

  // Foco: o que não é assunto do quadro recua.
  const focus = Math.min(zoomA + zoomB, 2) * (1 - back);
  for (const n of nodes) {
    const sr = n.d.r * c.k;
    let o = 1;
    if (n !== nRoot && !inCircle.has(n.d)) o = 1 - 0.72 * clamp(focus);
    else if (n !== nRoot && n !== nCircle && n !== nRole)
      o = 1 - 0.6 * clamp(focus - 1);
    n.g.setAttribute("opacity", o.toFixed(3));
    if (n.kind === "role") {
      const x = (n.d.x - c.x) * c.k + vw / 2;
      const y = (n.d.y - c.y) * c.k + vh / 2;
      const available =
        o >= 0.6 &&
        morph < 0.001 &&
        x - sr >= 0 &&
        x + sr <= vw &&
        y - sr >= 64 &&
        y + sr <= vh;
      n.g.setAttribute("tabindex", available ? "0" : "-1");
      n.g.setAttribute("aria-hidden", String(!available));
    }
    if (n.kind === "role") {
      // O nome sempre aparece: a letra encolhe até caber no círculo.
      const fs = clamp(
        Math.min(sr * 0.24, (sr * 2 - 10) / (n.name.length * 0.58)),
        7.5,
        17,
      );
      let lo = clamp((sr - 12) / 6);
      if (n === nRole && morph > 0.001) lo = 0;
      n.t.setAttribute("x", n.d.x);
      n.t.setAttribute("y", n.d.y);
      n.t.setAttribute("font-size", fs / c.k);
      n.t.setAttribute("opacity", lo.toFixed(3));
    } else {
      // Nome do círculo centrado na faixa livre, nunca maior que ela.
      const pad = n === nRoot ? ROOT_PAD : PAD;
      const fs = clamp(Math.min(sr * 0.085, pad * c.k - 5), 8, 19);
      const R = n.d.r - pad / 2;
      n.arc.setAttribute(
        "d",
        `M${n.d.x - R} ${n.d.y}A${R} ${R} 0 0 1 ${n.d.x + R} ${n.d.y}`,
      );
      n.t.setAttribute("font-size", fs / c.k);
      // Sem faixa livre para o nome (mapa pequeno), o círculo fica sem rótulo.
      n.t.setAttribute("opacity", clamp((sr - 60) / 30).toFixed(3));
    }
  }
  nRole.g.classList.toggle("changed", changed);

  // Anel que marca o papel alterado no quadro final.
  const ring = seg(u, 9.1, 9.9);
  pulse.setAttribute("r", nRole.d.r * (1 + ring * 0.9));
  pulse.setAttribute("opacity", changed && ring > 0 ? (1 - ring) * 0.9 : 0);

  svg.style.filter = morph > 0.02 ? `blur(${(morph * 5).toFixed(2)}px)` : "";
  lights.style.opacity = (dark * 0.97).toFixed(3);
  calm = u < 8.3 ? 1 - zoomB : back;
  root.style.setProperty("--dark", dark.toFixed(3));

  if (morph > 0.001) {
    const sx = (nRole.d.x - c.x) * c.k + vw / 2;
    const sy = (nRole.d.y - c.y) * c.k + vh / 2;
    const sr = nRole.d.r * c.k;
    const w = lerp(sr * 2, S.w, morph);
    const h = lerp(sr * 2, S.h, morph);
    const cx = lerp(sx, S.cx, morph);
    const cy = lerp(sy, S.cy, morph);
    sheet.style.visibility = "visible";
    sheet.style.width = `${w}px`;
    sheet.style.height = `${h}px`;
    sheet.style.transform = `translate(${cx - w / 2}px, ${cy - h / 2}px)`;
    sheet.style.borderRadius = `${lerp(sr, 16, morph)}px`;
    // Na volta, a folha se fecha já na cor do papel alterado.
    const tint = changed ? Math.round((1 - morph) * 100) : 0;
    sheet.style.background = `color-mix(in srgb, #0b7077 ${tint}%, #fff)`;
    sheet.style.borderColor = changed ? "#0b7077" : "#6a969b";
    sheetInner.style.opacity = clamp((morph - 0.55) / 0.4).toFixed(3);
    const gs = lerp(G.start, 1, morph);
    const gx = lerp((w - G.w * gs) / 2, (w - S.w) / 2 + G.x, morph);
    const gy = lerp((h - G.h * gs) / 2, (h - S.h) / 2 + G.y, morph);
    ghost.style.transform = `translate(${gx}px, ${gy}px) scale(${gs})`;
    ghost.style.color = `color-mix(in srgb, #fff ${tint}%, #183237)`;
  } else {
    sheet.style.visibility = "hidden";
  }

  // Estado do acordo
  const state =
    u < 5.0 ? "none" : u < 6.4 ? "question" : u < 7.3 ? "proposal" : "adopted";
  if (state !== lastState) {
    sheet.dataset.state = state;
    lastState = state;
  }
  const count =
    state === "adopted"
      ? NEW_LINE.length
      : state === "proposal"
        ? Math.round(clamp((u - 6.5) / 0.65) * NEW_LINE.length)
        : 0;
  if (count !== lastTyped) {
    typed.textContent = NEW_LINE.slice(0, count);
    rest.textContent = NEW_LINE.slice(count);
    lastTyped = count;
  }

  // Cartelas
  for (const card of cards) {
    const o = Math.min(
      seg(u, card.a, card.a + 0.3),
      1 - seg(u, card.b - 0.3, card.b),
    );
    const before = u < (card.a + card.b) / 2;
    card.el.style.opacity = o.toFixed(3);
    card.el.style.setProperty("--o", o.toFixed(3));
    card.el.style.visibility = o > 0.01 ? "visible" : "hidden";
    card.el.style.setProperty(
      "--shift",
      `${((1 - o) * (before ? 18 : -18)).toFixed(1)}px`,
    );
  }
  progressBar.style.transform = `scaleX(${p.toFixed(4)})`;
}

// Rolagem nativa com amortecimento leve; sem laço em repouso.
let current = 0;
let target = 0;
let raf = 0;
let lastTime = 0;
const scrollSpan = () => film.offsetHeight - stage.clientHeight;
const readTarget = () =>
  clamp(-film.getBoundingClientRect().top / Math.max(1, scrollSpan()));

function tick(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
  lastTime = now;
  current = reduced.matches
    ? target
    : current + (target - current) * (1 - Math.exp(-dt * 9));
  if (Math.abs(target - current) < 0.0002) current = target;
  render(current);
  raf = current === target ? 0 : requestAnimationFrame(tick);
}
function schedule() {
  target = readTarget();
  if (!raf) {
    lastTime = performance.now();
    raf = requestAnimationFrame(tick);
  }
}

for (const { el } of cards) {
  const heading = el.querySelector("h1, h2");
  const rise = document.createElement("span");
  rise.className = "rise";
  rise.append(...heading.childNodes);
  heading.append(rise);
}
root.classList.add("film-on");
measure();
current = target = readTarget();
render(current);
addEventListener("scroll", schedule, { passive: true });
addEventListener("resize", () => {
  measure();
  current = target = readTarget();
  render(current);
});
reduced.addEventListener("change", schedule);

const behavior = () => (reduced.matches ? "auto" : "smooth");
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  scrollTo({ top: 0, behavior: behavior() });
});

// Depois do filme: cabeçalho sólido, frase que se acende e fio que se desenha.
const topBar = document.querySelector(".top");
const pov = document.querySelector(".pov-line");
const thread = document.querySelector(".thread");
const words = pov.textContent.trim().split(/\s+/);
pov.textContent = "";
const wordEls = words.map((w, i) => {
  const s = document.createElement("span");
  s.textContent = w;
  pov.append(s, i < words.length - 1 ? " " : "");
  return s;
});

function flow() {
  const h = innerHeight;
  topBar.classList.toggle("solid", film.getBoundingClientRect().bottom < 70);
  const pr = pov.getBoundingClientRect();
  const pt = reduced.matches
    ? 1
    : clamp((h * 0.82 - pr.top) / (pr.height + h * 0.3));
  wordEls.forEach((el, i) => {
    el.style.opacity = (
      0.16 +
      0.84 * clamp(pt * (words.length + 3) - i)
    ).toFixed(3);
  });
  const tr = thread.getBoundingClientRect();
  const tt = reduced.matches ? 1 : clamp((h * 0.85 - tr.top) / (h * 0.55));
  thread.style.setProperty("--draw", tt.toFixed(3));
}
let flowRaf = 0;
const scheduleFlow = () => {
  if (!flowRaf)
    flowRaf = requestAnimationFrame(() => {
      flowRaf = 0;
      flow();
    });
};
addEventListener("scroll", scheduleFlow, { passive: true });
addEventListener("resize", scheduleFlow);
flow();

const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        e.target.classList.add("in");
        seen.unobserve(e.target);
      }
  },
  { rootMargin: "0px 0px -12% 0px" },
);
for (const el of document.querySelectorAll("[data-reveal]")) seen.observe(el);

// As mesmas pessoas, por papel ou por cargo. Quem se move são as pessoas:
// um papel não vira cargo. Dados fictícios.
const STAFF = [
  {
    id: "Ana",
    cargo: "Diretora",
    boss: null,
    color: "#3f6f8f",
    roles: ["Estratégia"],
  },
  {
    id: "Bia",
    cargo: "Gerente de Relacionamento",
    boss: "Ana",
    color: "#6a969b",
    roles: ["Parcerias", "Comunicação"],
  },
  {
    id: "Lia",
    cargo: "Analista de Relacionamento",
    boss: "Bia",
    color: "#b54d35",
    roles: ["Atendimento", "Escuta"],
  },
  {
    id: "Davi",
    cargo: "Gerente de Produto",
    boss: "Ana",
    color: "#0b7077",
    roles: ["Pesquisa", "Qualidade"],
  },
  {
    id: "Caio",
    cargo: "Analista de Produto",
    boss: "Davi",
    color: "#c98a2b",
    roles: ["Atendimento", "Suporte"],
  },
  {
    id: "Gil",
    cargo: "Designer",
    boss: "Davi",
    color: "#8a5a9b",
    roles: ["Design"],
  },
  {
    id: "Edu",
    cargo: "Engenheiro",
    boss: "Davi",
    color: "#4f8a5b",
    roles: ["Código", "Qualidade"],
  },
  {
    id: "Rosa",
    cargo: "Gerente de Operações",
    boss: "Ana",
    color: "#50666a",
    roles: ["Finanças", "Jurídico"],
  },
  {
    id: "Téo",
    cargo: "Analista de Pessoas",
    boss: "Rosa",
    color: "#a34f6f",
    roles: ["Pessoas", "Facilitação"],
  },
];
const WHO = {};
for (const p of STAFF) for (const r of p.roles) (WHO[r] ??= []).push(p.id);
const CAPTIONS = [
  "Por papel: cada círculo é uma parte do trabalho. Lia cuida de duas, e Atendimento tem duas pessoas.",
  "Por cargo: cada pessoa tem um contrato e uma linha de comando. Os papéis seguem com ela.",
];
const formsSvg = document.querySelector(".forms-map");
const formsCaption = document.querySelector(".forms-caption");
const formButtons = [...document.querySelectorAll("[data-form]")];
const el = (name, cls, parent) => {
  const e = document.createElementNS(NS, name);
  if (cls) e.setAttribute("class", cls);
  parent?.append(e);
  return e;
};
const rolesLayer = el("g", "roles-layer", formsSvg);
const chartLayer = el("g", "chart-layer", formsSvg);
const linksPath = el("path", "links", chartLayer);
const shapes = tree.descendants().map((d) => {
  const kind = d.depth === 0 ? "rootc" : d.children ? "cont" : "rolec";
  const g = el("g", kind, rolesLayer);
  const circle = el("circle", "", g);
  const name = el("text", "rname", g);
  name.textContent = d.data.name;
  return { d, circle, name };
});
const boxes = STAFF.map((p) => {
  const g = el("g", "box", chartLayer);
  const rect = el("rect", "", g);
  const name = el("text", "pname", g);
  name.textContent = p.id;
  const cargo = el("text", "pcargo", g);
  cargo.textContent = p.cargo;
  const tags = el("text", "ptags", g);
  tags.textContent = p.roles.join(" · ");
  return { p, rect, name, cargo, tags };
});
// Um rosto por pessoa em cada papel que ela energiza.
const avatars = STAFF.flatMap((p) =>
  p.roles.map((role) => {
    const g = el("g", "av", formsSvg);
    const circle = el("circle", "", g);
    circle.style.fill = p.color;
    const text = el("text", "", g);
    text.textContent = p.id[0];
    return { p, role, g, circle, text };
  }),
);

function layoutForms() {
  const mobile = innerWidth < 760;
  const W = mobile ? 400 : 1000;
  const H = mobile ? 560 : 600;
  formsSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const sc = mobile ? 0.42 : 0.58;
  const ox = (W - 1000 * sc) / 2;
  const oy = (H - 1000 * sc) / 2;
  const base = mobile ? 13 : 12.5;
  const spot = {};
  for (const s of shapes) {
    const { d } = s;
    const r = d.r * sc;
    const cx = ox + d.x * sc;
    const cy = oy + d.y * sc;
    const leaf = !d.children;
    const pad = (d.depth === 0 ? ROOT_PAD : PAD) * sc;
    s.circle.setAttribute("cx", cx);
    s.circle.setAttribute("cy", cy);
    s.circle.setAttribute("r", r);
    s.name.setAttribute("x", cx);
    s.name.setAttribute("y", leaf ? cy - r * 0.26 : cy - r + pad / 2);
    s.name.style.fontSize = `${(leaf
      ? Math.min(base, (r * 1.86 - 8) / (d.data.name.length * 0.58))
      : Math.min(base, pad - 3)
    ).toFixed(2)}px`;
    if (leaf) spot[d.data.name] = { cx, cy, r };
  }
  // Rostos dentro de cada papel, lado a lado.
  for (const a of avatars) {
    const { cx, cy, r } = spot[a.role];
    const mates = WHO[a.role];
    const ra = Math.min(mobile ? 8 : 11, r * 0.3);
    const i = mates.indexOf(a.p.id) - (mates.length - 1) / 2;
    a.a = { x: cx + i * (ra * 2 + 3), y: cy + r * 0.3, r: ra };
  }
  // Organograma de pessoas: uma caixa por contrato.
  const links = [];
  const order = [];
  const walk = (boss, depth) => {
    for (const b of boxes.filter((x) => x.p.boss === boss)) {
      order.push([b, depth]);
      walk(b.p.id, depth + 1);
    }
  };
  walk(null, 0);
  const col = {};
  order.forEach(([b, depth], row) => {
    if (mobile) {
      const x = 6 + depth * 18;
      b.b = { x, y: 6 + row * 61, w: W - 6 - x, h: 55 };
      return;
    }
    if (depth === 0) {
      b.b = { x: 375, y: 24, w: 250, h: 72 };
    } else if (depth === 1) {
      const i = Object.keys(col).length;
      col[b.p.id] = { x: 45 + i * 330, n: 0 };
      b.b = { x: col[b.p.id].x, y: 154, w: 250, h: 72 };
      links.push(`M500 96V125H${b.b.x + 125}V154`);
    } else {
      const c = col[b.p.boss];
      b.b = { x: c.x + 30, y: 284 + c.n * 86, w: 220, h: 72 };
      c.n += 1;
      links.push(`M${c.x + 14} 226V${b.b.y + 36}H${b.b.x}`);
    }
  });
  linksPath.setAttribute("d", links.join(""));
  for (const b of boxes) {
    const { x, y, w, h } = b.b;
    b.rect.setAttribute("x", x);
    b.rect.setAttribute("y", y);
    b.rect.setAttribute("width", w);
    b.rect.setAttribute("height", h);
    b.rect.setAttribute("rx", 12);
    const tx = x + (mobile ? 42 : 48);
    const rows = mobile ? [15, 29, 43] : [20, 37, 54];
    [b.name, b.cargo, b.tags].forEach((t, i) => {
      t.setAttribute("x", tx);
      t.setAttribute("y", y + rows[i]);
    });
  }
  for (const a of avatars) {
    const { x, y, h } = boxes.find((b) => b.p === a.p).b;
    a.b = { x: x + (mobile ? 21 : 25), y: y + h / 2, r: mobile ? 12 : 14 };
  }
}

let formT = 0;
let formTarget = 0;
let formRaf = 0;
let lastFormTime = 0;
function drawForms() {
  const t = ease(formT);
  rolesLayer.setAttribute("opacity", (1 - clamp(t / 0.55)).toFixed(3));
  chartLayer.setAttribute("opacity", clamp((t - 0.5) / 0.5).toFixed(3));
  avatars.forEach((a, i) => {
    // Saída escalonada: os rostos não voam em bloco.
    const k = ease(clamp(formT * 1.3 - (i / avatars.length) * 0.3));
    a.circle.setAttribute("cx", lerp(a.a.x, a.b.x, k));
    a.circle.setAttribute("cy", lerp(a.a.y, a.b.y, k));
    a.circle.setAttribute("r", lerp(a.a.r, a.b.r, k));
    a.text.setAttribute("x", lerp(a.a.x, a.b.x, k));
    a.text.setAttribute("y", lerp(a.a.y, a.b.y, k));
    a.text.style.fontSize = `${lerp(a.a.r, a.b.r, k).toFixed(2)}px`;
  });
}
function stepForms(now) {
  const dt = Math.min(0.05, (now - lastFormTime) / 1000);
  lastFormTime = now;
  formT = clamp(formT + Math.sign(formTarget - formT) * dt * 0.8);
  if (reduced.matches || Math.abs(formTarget - formT) < 0.002)
    formT = formTarget;
  drawForms();
  formRaf = formT === formTarget ? 0 : requestAnimationFrame(stepForms);
}
function showForm(index) {
  formTarget = index;
  formButtons.forEach((b, i) =>
    b.setAttribute("aria-pressed", String(i === index)),
  );
  formsCaption.textContent = CAPTIONS[index];
  formsSvg.setAttribute(
    "aria-label",
    index
      ? "Pagoana por cargo: organograma de nove pessoas, cada uma com seus papéis"
      : "Pagoana por papel: círculos de papéis com as pessoas que os energizam",
  );
  if (!formRaf) {
    lastFormTime = performance.now();
    formRaf = requestAnimationFrame(stepForms);
  }
}
formButtons.forEach((b, i) => b.addEventListener("click", () => showForm(i)));
layoutForms();
drawForms();
formsCaption.textContent = CAPTIONS[0];
addEventListener("resize", () => {
  layoutForms();
  drawForms();
});
// Quem só rola também vê as pessoas mudarem de lugar, uma vez.
if (!reduced.matches) {
  const once = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      once.disconnect();
      setTimeout(() => formTarget === 0 && showForm(1), 1400);
    },
    { threshold: 0.6 },
  );
  once.observe(formsSvg);
}

// O mapa respira em repouso: cada círculo deriva alguns pixels.
let idleRaf = 0;
let filmVisible = true;
function idle(now) {
  idleRaf = 0;
  if (!filmVisible || reduced.matches || shortViewport.matches || document.hidden) return;
  const k = camK;
  const amp = (2.6 * calm) / k;
  nodes.forEach((n, i) => {
    if (n === nRoot) return;
    const t = now / 1000;
    const dx = Math.sin(t * 0.55 + i * 1.7) * amp;
    const dy = Math.cos(t * 0.47 + i * 2.3) * amp;
    n.g.setAttribute(
      "transform",
      `translate(${dx.toFixed(3)} ${dy.toFixed(3)})`,
    );
  });
  idleRaf = requestAnimationFrame(idle);
}
const startIdle = () => {
  if (!idleRaf) idleRaf = requestAnimationFrame(idle);
};
new IntersectionObserver(([e]) => {
  filmVisible = e.isIntersecting;
  if (filmVisible) startIdle();
}).observe(film);
document.addEventListener("visibilitychange", startIdle);
reduced.addEventListener("change", startIdle);
shortViewport.addEventListener("change", startIdle);

// Espiar um papel: passar o mouse ou tocar mostra o que ele cuida e quem responde.
let peeked = null;
function hidePeek() {
  peek.classList.remove("on");
  peeked?.g.classList.remove("peeked");
  peeked = null;
}
function showPeek(n) {
  if (
    sheet.style.visibility === "visible" ||
    Number(n.g.getAttribute("opacity")) < 0.6
  )
    return;
  hidePeek();
  peeked = n;
  n.g.classList.add("peeked");
  const who = (WHO[n.name] ?? []).join(" e ");
  peek.replaceChildren();
  const b = document.createElement("b");
  b.textContent = n.name;
  const s = document.createElement("small");
  s.textContent = `Responde: ${who}`;
  peek.append(b, ROLE_INFO[n.name] ?? "", s);
  const r = n.g.querySelector("circle").getBoundingClientRect();
  const st = stage.getBoundingClientRect();
  const pw = peek.offsetWidth;
  const ph = peek.offsetHeight;
  const x = clamp(r.left + r.width / 2 - st.left - pw / 2, 12, vw - pw - 12);
  const above = r.top - st.top - ph - 10;
  const y = above > 70 ? above : r.bottom - st.top + 10;
  peek.style.transform = `translate(${x}px, ${y}px)`;
  peek.classList.add("on");
}
for (const n of nodes) {
  if (n.kind !== "role") continue;
  n.g.setAttribute("role", "button");
  n.g.setAttribute(
    "aria-label",
    `${n.name}: ${ROLE_INFO[n.name]} Responde: ${(WHO[n.name] ?? []).join(" e ")}. Exemplo fictício.`,
  );
  n.g.addEventListener("focus", () => showPeek(n));
  n.g.addEventListener("blur", hidePeek);
  n.g.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePeek();
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      peeked === n ? hidePeek() : showPeek(n);
    }
  });
  n.g.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") showPeek(n);
  });
  n.g.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") hidePeek();
  });
  n.g.addEventListener("click", (e) => {
    e.stopPropagation();
    peeked === n ? hidePeek() : showPeek(n);
  });
}
stage.addEventListener("click", hidePeek);
addEventListener("scroll", hidePeek, { passive: true });
