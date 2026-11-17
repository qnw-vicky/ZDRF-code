# 开发协作规范

本仓库使用 GitHub 作为代码事实源，WorkBuddy 作为任务、排期和验收事实源。每次代码变更都必须关联一个 WorkBuddy `DEV-xxx` 事项。

## 分支模型

- `main`：稳定、可发布版本，只接受从 `develop` 发起的发布 PR。
- `develop`：日常集成分支，只接受经过检查的功能、修复或维护 PR。
- `feature/DEV-xxx-short-description`：功能开发。
- `fix/DEV-xxx-short-description`：缺陷修复。
- `chore/DEV-xxx-short-description`：工程与维护任务。

禁止直接向 `main` 和 `develop` 推送开发提交。

## 标准流程

1. 在 WorkBuddy 中领取对应的 `DEV-xxx` 事项并更新为进行中。
2. 从最新的 `develop` 创建任务分支：

   ```bash
   git switch develop
   git pull --ff-only origin develop
   git switch -c feature/DEV-xxx-short-description
   ```

3. 进行小而清晰的提交，提交信息建议使用 Conventional Commits，例如：

   ```text
   feat: add cloud persistence adapter
   fix: reject publishing unapproved assets
   test: cover permission checks
   chore: configure continuous integration
   ```

4. 推送任务分支，并向 `develop` 创建 Pull Request。
5. PR 必须填写关联事项、变更内容、验收标准、测试结果和风险。
6. CI 通过且至少完成一次代码审查后方可合并。
7. 发布时从 `develop` 向 `main` 创建发布 PR；合并后再创建版本标签。
8. 合并后将 PR、Commit 和测试结果回填 WorkBuddy 对应事项。

## 合并要求

- 不允许将密钥、`.env`、`data/store.json` 或 `data/uploads/` 提交到仓库。
- `npm test` 必须全部通过。
- 新增或修改行为应同步补充测试。
- PR 应保持单一目标，避免混入无关格式化或重构。
- 推荐使用 Squash merge，使一个 WorkBuddy 事项对应一个清晰的主线提交。

## 完成定义

事项只有同时满足以下条件才视为完成：

- PR 已合并到目标分支；
- CI 和本地 `npm test` 均通过；
- 验收标准已满足；
- WorkBuddy 中已记录 PR、Commit、测试结果和完成时间。

