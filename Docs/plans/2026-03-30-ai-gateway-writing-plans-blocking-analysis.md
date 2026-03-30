# Writing Plans 技能卡住问题分析与解决

> 日期: 2026-03-30
> 关联: [AI Gateway CLI Server 设计](../2026-03-30-ai-gateway-cli-server-design.md)

---

## 问题描述

在执行 writing-plans 技能创建实施计划时，**两次被中断**,卡在"撰写实施计划"阶段（还没调用 Write 工具）。

设计文档已保存,但没有对应的 implementation plan 文档。

## 根因分析

计划内容过大是核心原因:

### 1. 单文件体积问题
- 4 个 Provider + 路由 + 工具函数 + 测试,完整代码按一个文件写
- writing-plans 要求每个 step 包含完整代码,精确命令
- 预估单文件超过 2000 行,极易被中断

### 2. 大量参考代码读取
- 执行过程中读取了 10+ 个参考文件 (chat.ts, generate.ts, validate.ts 等)
- 每个 Read 工具调用都消耗 context window 空间
- 大量参考代码导致 context 接近上限,触发了压缩

### 3. 单次 Write 尝试超时
- 尝试在一条回复中写入全部计划内容
- Write 工具调用内容过长,写入耗时增加
- 任何中断都导致前功尽弃 (没有断点续传)

### 4. 缺少中间保存点
- 没有每写完一个部分就提交
- 全部内容集中在一次 Write 调用中
- 中断后无法恢复已写部分,必须从头开始

## 解决方案
拆成 6 个独立计划文件,每个聚焦一个模块:

```
docs/plans/
  2026-03-30-ai-gateway-01-scaffold.md    项目脚手架 + 配置 + 基类 + 工具
  2026-03-30-ai-gateway-02-claude.md       Claude Provider
  2026-03-30-ai-gateway-03-codex.md        Codex Provider
  2026-03-30-ai-gateway-04-opencode.md      OpenCode Provider
  2026-03-30-ai-gateway-05-copilot.md       Copilot Provider
  2026-03-30-ai-gateway-06-routes.md        路由层 + 集成测试
```

### 效果
| 维度 | 修复前 | 修复后 |
|------|------|------|
| 单文件大小 | ~2000 行 | 每个 200-400 行 |
| Write 调用 | 1 次 | 6 次 (可独立中断后恢复) |
| Context 压力 | 读取大量参考 + 写大量内容 | 每个计划聚焦单一模块 |
| 可中断性 | 失败后全部丢失 | 夯败只丢失当前部分 |

## 类比理解
像搬家一样:
- **修复前**: 试图把整个房子的家具一次性搬上楼,一件坏了全部重来
- **修复后**: 分批搬运,每批只搬一个房间,互不影响

## 建议
未来遇到类似大规模计划时,优先考虑:
1. 按模块拆分计划文件
2. 每写完一个文件就提交/保存
3. 避免在一条回复中做大量参考代码读取 + 大量内容写入
4. 利用并行 Write 调用写多个小文件
