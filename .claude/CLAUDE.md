# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Superpowers is a complete software development workflow for coding agents, built on composable "skills" that automatically trigger based on task context. It provides TDD enforcement, systematic debugging, collaboration workflows, and process documentation.

## Key Architecture

### Skills System

Skills are reference guides for proven techniques, patterns, and tools. Each skill lives in `skills/<skill-name>/SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name
description: Use when [specific triggering conditions]
---

# Skill content...
```

**Skill invocation rule:** If there's even a 1% chance a skill applies, the `Skill` tool MUST be used to load it. Never use the Read tool on skill files directly.

### Core Workflow

The main development workflow chains these skills:

1. **brainstorming** - Refine ideas through questions, present design in sections
2. **writing-plans** - Break work into 2-5 minute tasks with exact file paths
3. **subagent-driven-development** / **executing-plans** - Dispatch subagents per task with two-stage review
4. **finishing-a-development-branch** - Verify tests, handle merge/PR/cleanup

### Skill Categories

| Category | Skills |
|----------|--------|
| Testing | test-driven-development (RED-GREEN-REFACTOR) |
| Debugging | systematic-debugging, verification-before-completion |
| Collaboration | brainstorming, writing-plans, executing-plans, subagent-driven-development, requesting-code-review, receiving-code-review, using-git-worktrees |
| Meta | writing-skills, using-superpowers |

## Directory Structure

```
skills/                    # All skill definitions
  <skill-name>/SKILL.md    # Main skill file (required)
  <skill-name>/*.md        # Supporting files (optional)

commands/                  # User-invocable slash commands
  brainstorm.md
  execute-plan.md
  write-plan.md

agents/                    # Agent definitions
  code-reviewer.md

hooks/                     # Session hooks
  hooks.json               # Hook configuration
  session-start            # SessionStart hook script
  run-hook.cmd             # Windows polyglot wrapper

lib/                       # Core skill utilities
  skills-core.js           # Skill discovery, frontmatter parsing

tests/                     # Integration tests
  claude-code/             # Headless Claude Code tests
  explicit-skill-requests/ # Skill triggering tests
  subagent-driven-dev/     # End-to-end workflow tests
```

## Common Commands

### Running Tests

```bash
# Integration tests for subagent-driven-development (takes 10-30 min)
cd tests/claude-code
./test-subagent-driven-development-integration.sh

# Token usage analysis for any session
python3 tests/claude-code/analyze-token-usage.py ~/.claude/projects/<project>/<session>.jsonl
```

### Plugin Development

```bash
# Local dev marketplace must be enabled in ~/.claude/settings.json:
# "superpowers@superpowers-dev": true

# Run from superpowers directory for skill loading
cd /path/to/superpowers && claude -p "test prompt"
```

## Creating New Skills

**CRITICAL:** Follow TDD for documentation. Never write a skill without testing first.

1. **RED Phase** - Run pressure scenarios WITHOUT skill, document baseline behavior
2. **GREEN Phase** - Write minimal skill addressing those failures
3. **REFACTOR Phase** - Close loopholes, re-test until bulletproof

See `skills/writing-skills/SKILL.md` for complete guidance including:
- SKILL.md structure and frontmatter rules
- Description best practices (trigger conditions only, no workflow summary)
- Token efficiency targets
- Testing methodology with subagents

## Platform Support

- **Claude Code**: Plugin marketplace installation
- **Cursor**: Plugin marketplace (`/plugin-add superpowers`)
- **Codex**: Manual setup via `.codex/INSTALL.md`
- **OpenCode**: JavaScript plugin via `.opencode/plugins/superpowers.js`

## Important Constraints

### Skill Descriptions

Descriptions should describe ONLY when to use, NOT what the skill does. Descriptions that summarize workflow cause agents to skip reading the full skill content.

```yaml
# BAD: Summarizes workflow
description: Use when executing plans - dispatches subagent per task with code review

# GOOD: Triggering conditions only
description: Use when executing implementation plans with independent tasks in the current session
```

### Flowchart Usage

Use DOT/GraphViz flowcharts only for:
- Non-obvious decision points
- Process loops where agents might stop too early
- "When to use A vs B" decisions

Never use flowcharts for reference material (use tables), code examples (use markdown blocks), or linear instructions (use numbered lists).

## Version History

See `RELEASE-NOTES.md` for detailed changelog. Current version: v4.3.1
