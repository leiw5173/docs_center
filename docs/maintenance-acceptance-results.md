# 维护流程真实验收记录

以下最初记录使用旧版“两 PR 接入”流程，保留历史追溯。当前接入已调整为同一 PR 完成登记和首版内容审核，步骤见[验收清单](maintenance-acceptance.md)。

验收日期：2026-11-17。来源为 [leiw5173/docs_test](https://github.com/leiw5173/docs_test)，文档明确标记为流程测试，不对应产品资料。

## 新仓库注册

| 环节 | 实际记录 | 结果 |
| --- | --- | --- |
| 接入申请 | [Issue #1](https://github.com/leiw5173/docs_center/issues/1) | 表单触发登记 PR |
| 登记审核 | [PR #2](https://github.com/leiw5173/docs_center/pull/2) | 检查、预览任务及状态回报通过后合并；仅登记所选测试来源 |
| 首轮候选 | [PR #3](https://github.com/leiw5173/docs_center/pull/3) | 固定来源提交 `f773b935960f379efe3525e9aa2297f481996614`；独立关联组，仅含测试来源 |
| 预览 | [真实预览产物任务](https://github.com/leiw5173/docs_center/actions/runs/44013976741) | 下载产物后验证分类、正文、本地图片、中文锚点、刷新及返回 |
| 发布前隔离 | 候选未合并时检查阅读页 | 测试文档不可见 |
| 发布完成 | [最终结果](https://github.com/leiw5173/docs_center/pull/3#issuecomment-6937863640) | 阅读页显示 `REGISTER-V1`；正文、图片、刷新通过 |

实际目录为：应用案例 → 教学与实践 → 维护流程测试文档 → 测试指南。来源名称、路径与正文可在来源仓库追溯。

## 业务 PR 合并更新

| 环节 | 实际记录 | 结果 |
| --- | --- | --- |
| 未合并不变更 | [业务 PR #1](https://github.com/leiw5173/docs_test/pull/1) | PR 未合并时，阅读页仍为 `REGISTER-V1` |
| 业务合并生成候选 | 业务 PR #1 合并 | 真实 Webhook 进入候选流程，生成 [发布 PR #4](https://github.com/leiw5173/docs_center/pull/4)；阅读页不变 |
| 待确认期间继续修订 | [业务 PR #2](https://github.com/leiw5173/docs_test/pull/2) | 更新同一发布 PR #4，新修订重新检查，没有另建候选 |
| 错误链接 | [业务 PR #3](https://github.com/leiw5173/docs_test/pull/3)、[失败检查](https://github.com/leiw5173/docs_center/actions/runs/44014791060) | `broken-link: Missing zh/guide/missing-for-test.md`；回报“检查失败”；阅读页及已发布正文哈希不变 |
| 修复 | [业务 PR #4](https://github.com/leiw5173/docs_test/pull/4) | 同一发布 PR #4 锁定修复后的提交，检查、预览及状态回报重新通过 |
| 确认发布 | 发布 PR #4 合并 | 阅读页切换至 `MERGE-V3-FIXED`；位置不变、无重复节点，图片及刷新通过 |
| 最终回报 | [发布结果评论](https://github.com/leiw5173/docs_center/pull/4#issuecomment-6938001991) | 持久结果为 `SUCCEEDED`，同一发布结果只有一条评论 |
| 重复投递与重试 | GitHub Webhook 重投；[重复候选通知及任务重跑](https://github.com/leiw5173/docs_center/actions/runs/44015501084) | 重投返回 202；没有重复候选、目录或最终结果评论，已发布内容不变 |

最终来源提交：`e9058ead7197dc3fc5ec73396f44b0e67cd82b9c`。最终发布修订：`c8e7b6371debd8914130495cd1ce850dd62d4518`。

## 联调发现与修正

- PR 状态回报增加 PR 写入权限，解决真实任务的 403；修正后已验证评论创建及更新。
- 合并事件产生的“跳过”预览任务不得遮住实际预览结果；跳过本身不能授权发布，最新实际失败、取消或运行中的任务仍会阻止发布。相关回归测试 30 项通过。
- 登记及候选生成重试读取当前主分支，避免使用旧事件的登记或发布基线。治理自动测试 29 项通过。

## 验收范围

两类测试在隔离环境完成，最终结果明确为“本地发布完成”，未启用外部同步；不能据此宣称外部同步或生产环境已验收。

本轮覆盖独立来源及同组候选复用。多仓库直接、间接引用组已有自动测试，但尚未进行多来源真实联调；整站探测与上一完整版本恢复也不在本次通过范围内。

## 新版：同一 PR 完成双语接入与首版发布

2026-11-17，使用 `leiw5173/docs_test` 在尚未登记该来源的隔离执行环境验收；治理记录沿用原测试来源标识。

| 环节 | 实际记录 | 结果 |
| --- | --- | --- |
| 申请与唯一接入 PR | [Issue #5](https://github.com/leiw5173/docs_center/issues/5) → [PR #6](https://github.com/leiw5173/docs_center/pull/6) | 同时包含登记信息及中英文首版固定清单，只确认合并一次 |
| 串行检查与双语预览 | [检查与产物](https://github.com/leiw5173/docs_center/actions/runs/44037605215) | 接入检查通过后检查内容；两个实际预览包的正文、图片、锚点、刷新与返回通过 |
| 合并前隔离 | 预览完成后核对来源登记与目录 | 来源仍未登记，四份中英文目录快照未变化 |
| 统一执行 | PR #6 合并 | 登记和两种语言的首版内容一次执行完成，不派发第二个首轮候选 |
| 最终回报 | [中文](https://github.com/leiw5173/docs_center/pull/6#issuecomment-6941583735)、[英文](https://github.com/leiw5173/docs_center/pull/6#issuecomment-6941584116) | 两个语言的最终结果均在同一个 PR 回报“本地发布完成” |
| 幂等 | [发布任务重跑](https://github.com/leiw5173/docs_center/actions/runs/44038257095)、真实源事件重投 | 重跑成功，未增加重复登记、目录、结果评论或首轮候选 |
| 日常更新回归 | [业务 PR #6](https://github.com/leiw5173/docs_test/pull/6) → [普通候选 PR #7](https://github.com/leiw5173/docs_center/pull/7) | 普通候选的内容检查、预览和回报通过；中文更新为 `ONE-PR-BUSINESS-V2`，英文保持 `ONBOARDING-EN-V1` |

首次双语来源提交：`83b31af2c2273ed030acda990c30293048875206`；接入发布修订：`b086c0f4fa484478860f07db22adec6f71b7f2cc`。本次仅本地隔离环境发布，未启用外部同步。
