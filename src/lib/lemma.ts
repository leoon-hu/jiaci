/** 单词原形匹配（详情页着色用）：规则去后缀 + 不规则表；MVP 不引入词形还原库 */
const IRREGULAR: Record<string, string> = {
  hypotheses: "hypothesis", wolves: "wolf", children: "child", phenomena: "phenomenon", criteria: "criterion",
  mice: "mouse", men: "man", women: "woman", feet: "foot", teeth: "tooth", geese: "goose", people: "person",
  went: "go", gone: "go", did: "do", done: "do", was: "be", were: "be", been: "be", is: "be", are: "be", am: "be",
  had: "have", has: "have", took: "take", taken: "take", gave: "give", given: "give", made: "make", said: "say",
  saw: "see", seen: "see", came: "come", knew: "know", known: "know", got: "get", found: "find", thought: "think",
  put: "put", brought: "bring", bought: "buy", built: "build", felt: "feel", kept: "keep", left: "leave", lost: "lose",
  met: "meet", paid: "pay", ran: "run", sold: "sell", sent: "send", spent: "spend", stood: "stand", told: "tell",
  understood: "understand", wrote: "write", written: "write", better: "good", best: "good", worse: "bad", worst: "bad",
  // 例句里的不规则过去式 / 过去分词要能还原回原形，否则「例句必须含本词」会把好例句判成不含本词
  // （break out 的例句写 "The fire broke out" 就匹配不上，整词填充失败）
  broke: "break", broken: "break", began: "begin", begun: "begin", chose: "choose", chosen: "choose",
  drove: "drive", driven: "drive", ate: "eat", eaten: "eat", fell: "fall", fallen: "fall", flew: "fly", flown: "fly",
  forgot: "forget", forgotten: "forget", froze: "freeze", frozen: "freeze", grew: "grow", grown: "grow",
  hid: "hide", hidden: "hide", held: "hold", led: "lead", rode: "ride", ridden: "ride", rose: "rise", risen: "rise",
  sang: "sing", sung: "sing", sat: "sit", slept: "sleep", spoke: "speak", spoken: "speak", stole: "steal", stolen: "steal",
  swam: "swim", swum: "swim", threw: "throw", thrown: "throw", wore: "wear", worn: "wear", won: "win",
  woke: "wake", woken: "wake", drew: "draw", drawn: "draw", drank: "drink", drunk: "drink", blew: "blow", blown: "blow",
  caught: "catch", fed: "feed", fought: "fight", heard: "hear", lit: "light", rang: "ring", rung: "ring",
  shot: "shoot", sank: "sink", sunk: "sink", slid: "slide", stuck: "stick", struck: "strike", swept: "sweep",
  taught: "teach", tore: "tear", torn: "tear", dealt: "deal", dug: "dig", bent: "bend", bound: "bind",
  bled: "bleed", bred: "breed", crept: "creep", fled: "flee", flung: "fling", hung: "hang", knelt: "kneel",
  meant: "mean", shone: "shine", shook: "shake", shaken: "shake", sought: "seek", sped: "speed", spun: "spin",
  sprang: "spring", sprung: "spring", stung: "sting", swore: "swear", sworn: "swear", swung: "swing", wept: "weep",
  arose: "arise", arisen: "arise", awoke: "awake", bore: "bear", borne: "bear", became: "become",
  bit: "bite", bitten: "bite", clung: "cling", forbade: "forbid", forbidden: "forbid",
  forgave: "forgive", forgiven: "forgive", overcame: "overcome", withdrew: "withdraw", withdrawn: "withdraw",
  lent: "lend", wound: "wind", ground: "grind", leapt: "leap", trod: "tread", trodden: "tread", woven: "weave",
};

export function candidateLemmas(token: string): string[] {
  const t = token.toLowerCase().replace(/[’']s?$/, "");
  if (IRREGULAR[t]) return [IRREGULAR[t], t];
  const c = [t];
  if (/ies$/.test(t)) c.push(t.slice(0, -3) + "y");
  if (/ves$/.test(t)) c.push(t.slice(0, -3) + "f", t.slice(0, -3) + "fe");
  if (/es$/.test(t)) c.push(t.slice(0, -2));
  if (/s$/.test(t) && !/ss$/.test(t)) c.push(t.slice(0, -1));
  if (/ied$/.test(t)) c.push(t.slice(0, -3) + "y");
  if (/ed$/.test(t)) c.push(t.slice(0, -2), t.slice(0, -1));
  if (/ing$/.test(t)) c.push(t.slice(0, -3), t.slice(0, -3) + "e");
  if (/([a-z])\1(ed|ing)$/.test(t)) c.push(t.replace(/([a-z])\1(ed|ing)$/, "$1"));
  if (/er$/.test(t)) c.push(t.slice(0, -2), t.slice(0, -1));
  if (/est$/.test(t)) c.push(t.slice(0, -3));
  if (/ly$/.test(t)) c.push(t.slice(0, -2));
  // 单字母的 token 本身要保留：过滤掉会让点 a / I 直接 400（审计 F089）
  return Array.from(new Set(c.filter((x) => x.length >= 2 || (x === t && x.length === 1))));
}

export const WORD_TOKEN_RE = /[A-Za-z][A-Za-z’'-]*/g;

/** 把文本切成 token（英文单词）与非 token 片段，供着色渲染 */
export function tokenize(text: string): Array<{ text: string; word: boolean }> {
  const out: Array<{ text: string; word: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(WORD_TOKEN_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), word: false });
    out.push({ text: m[0], word: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), word: false });
  return out;
}
