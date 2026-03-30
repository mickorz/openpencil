import { mkdirSync, chmodSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveMediaExtension } from './sse.js'
import type { Attachment } from '../providers/base-provider.js'

export async function saveAttachmentsToTempFiles(
  attachments: Attachment[],
  insideProject = false,
): Promise<{ tempDir: string; files: string[] }> {
  let tempDir: string

  if (insideProject) {
    const baseDir = join(process.cwd(), '.gateway-tmp')
    mkdirSync(baseDir, { recursive: true })
    chmodSync(baseDir, 0o700)
    tempDir = await mkdtemp(join(baseDir, 'attach-'))
  } else {
    tempDir = await mkdtemp(join(tmpdir(), 'ai-gateway-attach-'))
  }

  const files: string[] = []
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]
    const ext = resolveMediaExtension(att.mediaType)
    const filePath = join(tempDir, `${i}.${ext}`)
    await writeFile(filePath, Buffer.from(att.data, 'base64'))
    files.push(filePath)
  }

  return { tempDir, files }
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}
