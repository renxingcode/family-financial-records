# 家庭账户统计

一个运行在浏览器本地的**家庭账户统计**小工具：不定期记录家庭各账户的存款 / 负债余额，查看账户变化趋势与目标达成进度。

> 定位：这不是"账单记账"，而是"**账户统计**"——每月记录一两次，记录的是各银行账户的余额快照，用于观察家庭总资产的变化。

## 功能特性

- **银行卡配置管理**：新增、编辑银行卡，自定义显示名称与类型（存款 / 负债 / 两者兼备）
- **银行卡禁用 / 启用**：可临时禁用某张银行卡，禁用后在「添加记录」时不再显示，历史数据保留、编辑时仍可见
- **账户记录增删改查**：添加、编辑、删除记录；同一天不能重复录入；默认填充今日日期
- **金额展示**：千分位格式化；总余额按正负分色（正绿 / 负红）；存款与负债分别用不同颜色标识
- **对比差额列**：列表展示每条记录相对上一次统计的总余额变化，正数绿色带 `+`、负数红色带 `-`
- **导入 / 导出JSON**：一键导出完整数据（银行卡配置 + 账户记录）为 JSON 文件，文件名带日期；支持导入，便于定期备份与数据迁移
- **导出CSV表格**：将账户记录导出为 CSV 文件，可用 Excel / 表格软件打开
- **Mock 示例数据**：内置 `html_single/account_mock.json` 示例数据，可一键导入快速预览完整功能
- **移动端适配**：窄屏下表格、弹窗、分页控件自动收敛，手机浏览友好

## 快速开始

1. 直接用浏览器打开 `html/account.html`（支持 `file://` 协议，无需启动服务器）
2. 首次使用：先添加银行卡，再添加账户记录；也可以直接导入 `html_single/account_mock.json` 体验完整效果
3. 如果手机浏览器不支持 `file://` 协议，建议使用 `html_single/account.html` 单文件版（支持 `content://` 协议）
4. 数据保存在浏览器 **LocalStorage** 中，建议定期**导出JSON**备份

## 目录结构

```
family-financial-records/
├── html/                          # 多文件版（CSS/JS 分离，file:// 协议可直接打开）
│   ├── account.html               # 页面结构
│   ├── assets/
│   │   └── account.css            # 样式
│   └── js/
│       └── account.js             # 逻辑（Vue 3 全局构建版）
├── html_single/                   # 单文件版（CSS/JS 内联，便于手机查看）
│   ├── account.html               # 单文件版页面
│   ├── account_mock.json          # Mock 示例数据（可导入预览）
├── AGENTS.md                      # AI助手协作约定
├── CHANGELOG.md                   # 更新日志
├── LICENSE                        # 开源协议（Apache License 2.0）
├── NOTICE                         # 版权声明
└── README.md                      # 项目说明
```

## 数据说明

- 存储于浏览器 LocalStorage，key 以 `financial_account_` 为前缀
- 导出 JSON 包含 `version` 与 `exportTime` 元信息，便于数据溯源
- 纯本地数据，不上传任何服务器

## 数据安全与备份

- 所有数据仅保存在你的浏览器 LocalStorage 中
- **清除浏览器数据会导致数据丢失**，请定期导出 JSON 备份
- 建议每次重要记录后导出一次 JSON 文件保存
- 换电脑/浏览器时：在旧浏览器导出 JSON，在新浏览器导入 JSON

## 常见问题

**Q：换了电脑/浏览器，数据还在吗？**
A：不在。数据存在当前浏览器的 LocalStorage 中。请在旧浏览器导出 JSON，在新浏览器导入 JSON。

**Q：数据会上传到服务器吗？**
A：不会。本项目是纯前端工具，所有数据仅保存在本地浏览器中。

**Q：清除浏览器缓存会丢数据吗？**
A：会。清除浏览器数据/缓存会清空 LocalStorage，请务必先导出 JSON 备份。

## 技术栈

- 原生 HTML + CSS + JavaScript（Vue 3 全局构建版）
- LocalStorage 本地存储

## 作者

- 作者：renxing
- 博客：https://blog.csdn.net/rxbook
- 仓库：[Gitee](https://gitee.com/rxbook/family-financial-records) / [GitHub](https://github.com/renxingcode/family-financial-records)

## 开源协议

本项目基于 [Apache License 2.0](LICENSE) 协议开源，版权声明详见 [NOTICE](NOTICE) 文件。
