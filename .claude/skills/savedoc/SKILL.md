---
name: savedoc
description: Use when the user wants to save content into a local file and immediately preview it, or after markdown files are created/updated and should be backed up to Obsidian and opened in Chrome.
---

# savedoc

Save content to a file, back it up to Obsidian, and open it for preview.

## Required Workflow

1. Resolve target file path to an absolute path.
2. Determine content source:
   - Use user-provided content if explicit.
   - Use latest generated draft from conversation if user says "save this".
   - If no new content is provided and file exists, keep file unchanged.
3. Ensure parent directories exist.
4. Write content using UTF-8 when content is available.
5. Back up the file to Obsidian:
   - Obsidian root: `D:\BaiduSyncdisk\Obsidian\newsky\AIGenerate`
   - Project name: current working directory name
   - Target: `<ObsidianRoot>\<ProjectName>\<FileName>`
   - Skip backup if source file is already inside that Obsidian root.
6. Open original file in Chrome:
   - Windows command: `start chrome "file:///ABSOLUTE/PATH/TO/FILE"`

## Behavior Rules

- Overwrite existing target file when user asks to save/update.
- Overwrite existing Obsidian backup copy.
- Support text files, especially `.md`.
- If write fails, report exact path and error and stop.

## Response Format

Return concise status with:
- relative path
- absolute path
- Obsidian backup path (or "skipped")
- open-preview result
