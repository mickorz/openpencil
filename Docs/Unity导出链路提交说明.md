# Unity 导出链路提交说明

## 说明

这批改动已经覆盖了下面三部分：

1. HTML 导出面板增加 `HTML 转 JSON` 与 `发送到 Unity`
2. 新增浏览器端 HTML 坐标烘焙与 Unity 代理客户端
3. 补齐 Windows 下测试链路与 Unity 导出相关测试

当前代码已经验证通过：

- `bun run test`
- `node ./node_modules/typescript/bin/tsc --noEmit`

## 建议提交拆分

建议拆成两次提交，原因很简单：

- 第一提交放功能链路，回滚时更像拆掉一个完整模块
- 第二提交放测试与测试环境修复，回滚时不会误伤功能代码

这有点像把“新房装修”和“验房工具升级”分开装箱。
前者是业务能力，后者是保证以后不返工的工具层。

## 提交一

### 建议标题

`feat: add unity html bake export flow`

### 建议说明

新增 Unity HTML 导出链路：

- 代码面板支持在 HTML 与烘焙 JSON 之间切换
- 支持将烘焙后的 JSON 发送到本机 Unity 服务
- 新增浏览器端 HTML 坐标烘焙器
- 新增服务端 Unity 代理接口
- 补充代理输入校验与本机地址限制

### 建议纳入文件

- `src/components/panels/code-panel.tsx`
- `src/services/codegen/html-generator.ts`
- `src/services/codegen/html-unity-keyword-rules.ts`
- `src/services/codegen/html-unity-structure-rules.ts`
- `src/services/codegen/html-to-json-baker.ts`
- `src/services/codegen/unity-bake-client.ts`
- `server/api/unity/ugui-bake.post.ts`

## 提交二

### 建议标题

`test: stabilize unity bake tests on windows`

### 建议说明

修复并补强 Unity 导出相关测试：

- Windows 下改为使用 Node 启动 Vitest，绕过 `bun --bun vitest` 的路径问题
- 测试模式禁用不必要的运行时插件，避免 Nitro 干扰单测
- 为 boolean ops 测试补齐最小 canvas mock
- 增加 HTML 烘焙、Unity 客户端、Unity 路由的回归测试

### 建议纳入文件

- `package.json`
- `vite.config.ts`
- `src/utils/boolean-ops.ts`
- `src/utils/__tests__/boolean-ops.test.ts`
- `src/services/codegen/html-to-json-bakerExample.test.ts`
- `src/services/codegen/unity-bake-clientExample.test.ts`
- `server/__tests__/unity-bake-route.test.ts`

## 当前特别注意

`package.json` 里目前不只有这次改动。

除了我这次补的 `test` 脚本外，文件里还混着现有的：

- `version`
- `start`
- `dev`

如果你想把提交保持干净，最好确认这三处是不是也要一起提交。
如果不是，就不要把它们跟“测试链路修复”混在同一个提交里。

## 本轮验证结果

- 全量测试通过：`12` 个测试文件，`79` 个测试通过
- TypeScript 检查通过

