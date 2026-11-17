# 维护流程真实验收记录

验收日期：2026-11-17。测试来源：[leiw5173/docs_test](https://github.com/leiw5173/docs_test)，内容仅用于维护流程测试，不对应产品资料。

当前流程：**接入 Issue → 一个接入 PR → 接入检查 → 首版内容检查与预览 → 文档团队确认合并一次 → 统一登记并发布。** 后续业务更新继续使用普通候选发布 PR。操作步骤见[验收清单](maintenance-acceptance.md)。

## 接入与中英文首版发布

本次在尚未登记测试来源的隔离执行环境中验收，沿用治理仓库中已有的测试来源标识 `maintenance-test`。

| 验收项 | 实际记录 | 结果 |
| --- | --- | --- |
| 提交接入申请 | [Issue #5](https://github.com/leiw5173/docs_center/issues/5) | 选择 `zh`、`en` 和“应用案例 / 教学与实践” |
| 生成一个接入 PR | [PR #6](https://github.com/leiw5173/docs_center/pull/6) | 同时包含登记信息和中英文首版固定清单，不再拆成登记 PR 与首轮候选 PR |
| 接入检查 | [检查记录](https://github.com/leiw5173/docs_center/actions/runs/44037605215) | 来源、分支、语言及登记信息检查通过，再进入内容检查和预览 |
| 首版内容与预览 | 同一检查记录中的中英文预览产物 | 正文、目录、图片和链接检查通过；下载的两个预览包均通过正文、图片、锚点、刷新和返回检查 |
| 合并前隔离 | 预览完成后核对登记及目录 | 来源仍未登记，中英文导航及来源树四份快照均未变化 |
| 确认合并一次 | PR #6 合并 | 来源登记与中英文首版发布统一完成，没有生成第二个首轮候选 PR |
| 同一 PR 回报结果 | [中文结果](https://github.com/leiw5173/docs_center/pull/6#issuecomment-6941583735)、[英文结果](https://github.com/leiw5173/docs_center/pull/6#issuecomment-6941584116) | 两种语言均回报“本地发布完成”，每种语言各一条最终结果评论 |
| 重复执行与事件重投 | [发布任务重跑](https://github.com/leiw5173/docs_center/actions/runs/44038257095)及真实来源事件重投 | 任务第二次执行成功，重投返回 202；无重复登记、目录、结果评论或首轮候选 |

首版来源固定提交：`83b31af2c2273ed030acda990c30293048875206`。接入发布修订：`b086c0f4fa484478860f07db22adec6f71b7f2cc`。

## 接入后的日常更新

| 验收项 | 实际记录 | 结果 |
| --- | --- | --- |
| 业务 PR 合并 | [业务 PR #6](https://github.com/leiw5173/docs_test/pull/6) | 真实 Webhook 触发普通候选流程 |
| 普通候选审核 | [候选 PR #7](https://github.com/leiw5173/docs_center/pull/7) | 内容检查、预览及回报通过；接入专用检查按流程跳过，不影响日常更新 |
| 确认发布 | [最终结果](https://github.com/leiw5173/docs_center/pull/7#issuecomment-6942128764) | 中文更新为 `ONE-PR-BUSINESS-V2`，英文保持 `ONBOARDING-EN-V1`，目录位置不变且无重复节点 |

PR #7 是后续业务修改的候选，不是接入流程额外产生的首轮候选。

## 目录迁移与旧链接兼容（2026-11-17）

[业务 PR #7](https://github.com/leiw5173/docs_test/pull/7) 合并后，将中英文 `guide/` 改为 `maintenance-guide/`。系统在现有[中文候选 #8](https://github.com/leiw5173/docs_center/pull/8)和[英文候选 #9](https://github.com/leiw5173/docs_center/pull/9)中各自动登记两条旧址到新址的映射，PR 正文直接展示迁移表，无需填写治理表单。

[中文检查与预览](https://github.com/leiw5173/docs_center/actions/runs/44050863580)、[英文检查与预览](https://github.com/leiw5173/docs_center/actions/runs/44050870499)均通过，并生成地址变更告警。治理回归 52 项全部通过；执行侧测试 175 项，172 项通过、3 项条件测试未启用，包含连续迁移和旧目录书签解析。

浏览器使用隔离的发布后目录响应验证：中英文旧文档、旧目录介绍、旧目录书签均跳转新地址，保留语言、页内定位，图片和刷新正常。该验证不改变已发布内容。候选 #8、#9 仍待文档团队确认合并，真实发布后的旧链接访问尚待验证，不将候选检查通过视为已经发布。

## 补充验证：候选复用与失败阻断

以下为此前真实业务更新测试的历史证据，保留其仍适用的验证结果，不作为当前接入步骤。

| 验收项 | 历史记录 | 结果 |
| --- | --- | --- |
| 未合并不改变网页 | [业务 PR #1](https://github.com/leiw5173/docs_test/pull/1) | 合并前网页保持已发布版本；业务合并后也需等待候选确认发布 |
| 同组候选复用 | [业务 PR #2](https://github.com/leiw5173/docs_test/pull/2) → [候选 PR #4](https://github.com/leiw5173/docs_center/pull/4) | 待确认期间继续修订，更新同一个候选并重新检查 |
| 错误链接阻断 | [业务 PR #3](https://github.com/leiw5173/docs_test/pull/3)、[失败检查](https://github.com/leiw5173/docs_center/actions/runs/44014791060) | 检出 `Missing zh/guide/missing-for-test.md`，回报“检查失败”，已发布正文及目录不变 |
| 修复后发布 | [业务 PR #4](https://github.com/leiw5173/docs_test/pull/4)、[发布结果](https://github.com/leiw5173/docs_center/pull/4#issuecomment-6938001991) | 同一候选重新检查通过并确认发布，结果评论保持唯一 |

## 验收范围

以上均在隔离测试环境完成，最终结果为“本地发布完成”，未启用外部同步，不代表生产环境或外部同步已经验收。

本记录覆盖单 PR 双语接入、后续普通更新、同组候选复用、错误链接阻断和重复执行。多仓库直接与间接引用的真实联调、整站探测及上一完整版本恢复，尚未纳入本记录的通过范围。
