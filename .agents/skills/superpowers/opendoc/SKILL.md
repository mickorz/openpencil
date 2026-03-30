---
name: opendoc
description: Use when the user asks to open or preview an existing local document (especially markdown/html/text) in Chrome, or asks to quickly view a file after it has been generated.
---

# opendoc

Open an existing local document for quick preview.

## Required Workflow

1. Resolve input path to an absolute path.
2. Validate the file exists and is a file (not a directory).
3. Open with Chrome:
   - Windows command: `start chrome "file:///ABSOLUTE/PATH/TO/FILE"`
4. If Chrome launch fails, fall back to default app:
   - Windows command: `start "" "ABSOLUTE\\PATH\\TO\\FILE"`

## Behavior Rules

- Do not modify file contents.
- If path does not exist, report the missing path and suggest nearest existing parent directory.
- Prefer opening the original file path (not a copy).

## Response Format

Return concise status with:
- relative path
- absolute path
- open result (`opened in chrome` or `opened with default app`)
