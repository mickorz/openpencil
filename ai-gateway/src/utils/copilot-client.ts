/**
 * Copilot CLI 路径解析器
 *
 * resolveCopilotCli()     自动查找 copilot CLI
 *   |-- which/where 查 PATH
 *   |-- 返回路径或 undefined
 */

import { execSync } from 'node:child_process'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'

/**
 * 自动查找 copilot CLI 的绝对路径
 *
 * 查找策略：通过 which/where 在 PATH 中查找 copilot 可执行文件
 *
 * @returns 可用的 CLI 路径，或 undefined
 */
export function resolveCopilotCli(): string | undefined {
  try {
    const cmd = isWindows ? 'where copilot' : 'which copilot 2>/dev/null'
    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()

    const firstLine = output.split(/\r?\n/)[0]?.trim()
    return firstLine || undefined
  } catch {
    return undefined
  }
}
