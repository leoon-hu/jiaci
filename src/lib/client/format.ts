/** 词库封面缩写：去掉符号后取前 4 个字符 */
export function coverText(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, "");
  return (clean || name).slice(0, 4);
}
