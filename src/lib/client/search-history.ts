"use client";
import { dropSearchHistory, normalizeSearchHistory, pushSearchHistory, type SearchHistoryItem } from "@/lib/search";

/**
 * 单词搜索（需求 3.9）的搜索记录：只存在本设备的 localStorage，不上传、不随账号同步；
 * 登录与未登录共用一份，退出登录也不清。存不了（隐私模式、存储被禁）就只在这次打开的面板里有。
 */
const KEY = "aiword.searchHistory";

export function readSearchHistory(): SearchHistoryItem[] {
  try { return normalizeSearchHistory(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { return []; }
}

function write(list: SearchHistoryItem[]): SearchHistoryItem[] {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch { /* 存不了就算了 */ }
  return list;
}

export const addSearchHistory = (item: SearchHistoryItem) => write(pushSearchHistory(readSearchHistory(), item));
export const removeSearchHistory = (spelling: string) => write(dropSearchHistory(readSearchHistory(), spelling));
export const clearSearchHistory = () => write([]);
