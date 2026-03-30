/**
 * cwd 路径安全校验工具
 *
 * validateCwd()
 *   |-- resolve() + normalize()  消除路径穿越
 *   |-- 白名单校验               对照 allowedCwdDirs
 *   └-- 返回安全路径或 undefined
 */

import { resolve, normalize, sep } from 'node:path'

/**
 * 校验 cwd 路径是否在允许的目录白名单内
 * 防止路径穿越攻击和任意文件系统访问
 *
 * @param cwd - 请求的工作目录
 * @param allowedBaseDirs - 允许的基础目录路径列表
 * @returns 校验通过的绝对路径, 不通过返回 undefined
 */
export function validateCwd(
  cwd: string | undefined,
  allowedBaseDirs: string[],
): string | undefined {
  if (!cwd) return undefined

  const resolved = resolve(cwd)
  const normalized = normalize(resolved)

  // 防止路径穿越序列
  if (normalized.includes('..')) return undefined

  // 白名单为空时拒绝所有请求
  if (allowedBaseDirs.length === 0) return undefined

  // 检查是否在白名单目录下
  for (const base of allowedBaseDirs) {
    const resolvedBase = resolve(base)
    if (normalized.startsWith(resolvedBase + sep) || normalized === resolvedBase) {
      return normalized
    }
  }

  return undefined
}
