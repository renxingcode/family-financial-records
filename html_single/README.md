# html_single — 单文件版

本目录存放**单文件版** `account.html`，将 HTML、CSS、JS 全部内联到一个文件中。

## 用途

- 支持手机 `content://` 协议直接打开（手机端大多数浏览器不支持多文件 `file://` 加载）
- 必须联网（Vue 通过 CDN 加载：`https://unpkg.com/vue@3/dist/vue.global.prod.js`）
- 方便分享、备份、在手机上快速使用

## 未来优化方向

等 CSS 和 JS 逻辑稳定后，可以考虑将 CSS/JS 放到自己的服务器上，像加载 Vue CDN 一样远程引用，大幅减少 HTML 体积：

```html
<script src="https://your_server/js/account.js"></script>
<link rel="stylesheet" href="https://your_server/css/account.css">
```

这样只需要保留 HTML 即可，JS/CSS 由服务器统一托管。

## 手机端多文件加载

如果需要在手机上用多文件版（`html/` 目录），需要浏览器支持 `file://` 协议：

| 浏览器 | 稳定性    | 说明 |
|---|--------|---|
| UC 浏览器 | 自测较稳定  | 荣耀手机上测试可用，支持 `file://` 多文件加载 |
| via 浏览器 | 自测不太稳定 | 偶尔可用 |
| 其他安卓浏览器 | 多数不支持  | 目前安卓手机很多浏览器已不支持 `file://` |

## 离线访问方案

UC 浏览器广告较多，如果设置不允许联网，则无法在线加载 Vue CDN。解决方式：

1. 将 `vue.global.prod.js` 下载到本地（如项目 `data/` 目录）
2. 将 `account.html` 中的 Vue 引用改为本地路径：

```html
<script src="vue.global.prod.js"></script>
```

即可离线使用，且无广告干扰。
