/**
 * 「我的词库」本数上限（需求 3.3.1）：导入的与自建的合计，每个用户最多 `wordbook.max_per_user` 本（默认 3）。
 * 这里只放浏览器与服务端共用的纯逻辑；建词库时带锁的检查在 lib/study.ts 的 createOwnWordbook
 */
export type BookQuota = { used: number; max: number };

export const quotaFull = (q: BookQuota | null | undefined): boolean => !!q && q.used >= q.max;

/** 满了之后各处（接口报错、词库列表、新建 / 导入页、选择框）说的同一句话 */
export const quotaFullMessage = (max: number) => `我的词库最多 ${max} 本（导入的与自建的合计），删掉一本不用的才能再导入或新建`;

/** 词库列表「我的词库」下面那一行：没满说还能加几本，满了说怎么办 */
export const quotaHint = (q: BookQuota) =>
  quotaFull(q) ? quotaFullMessage(q.max) : `我的词库最多 ${q.max} 本（导入的与自建的合计），还能再加 ${q.max - q.used} 本`;
