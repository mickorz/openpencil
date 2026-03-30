import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { saveAttachmentsToTempFiles, cleanupDir } from '../../src/utils/temp-files'

describe('saveAttachmentsToTempFiles', () => {
  const dirsToCleanup: string[] = []

  afterEach(async () => {
    for (const dir of dirsToCleanup) {
      await cleanupDir(dir).catch(() => {})
    }
    dirsToCleanup.length = 0
  })

  it('saves base64 attachments to temp files', async () => {
    const attachments = [
      { name: 'test.png', mediaType: 'image/png', data: 'aGVsbG8=' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments)
    dirsToCleanup.push(tempDir)

    expect(files).toHaveLength(1)
    expect(existsSync(files[0])).toBe(true)
    expect(files[0]).toMatch(/0\.png$/)
    expect(readFileSync(files[0]).toString()).toBe('hello')
  })

  it('saves multiple attachments with correct extensions', async () => {
    const attachments = [
      { name: 'a.png', mediaType: 'image/png', data: 'YQ==' },
      { name: 'b.jpg', mediaType: 'image/jpeg', data: 'Yg==' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments)
    dirsToCleanup.push(tempDir)

    expect(files).toHaveLength(2)
    expect(files[0]).toMatch(/0\.png$/)
    expect(files[1]).toMatch(/1\.jpeg$/)
  })

  it('uses fallback extension for unknown media types', async () => {
    const attachments = [
      { name: 'f.svg', mediaType: 'image/svg+xml', data: 'Zg==' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments)
    dirsToCleanup.push(tempDir)

    expect(files[0]).toMatch(/0\.png$/)
  })

  it('creates temp dir inside project when insideProject=true', async () => {
    const attachments = [
      { name: 'test.png', mediaType: 'image/png', data: 'dGVzdA==' },
    ]
    const { tempDir, files } = await saveAttachmentsToTempFiles(attachments, true)
    dirsToCleanup.push(tempDir)

    expect(tempDir).toContain('.gateway-tmp')
  })
})
