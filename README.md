# OpenBench Web (Single-file HTML)

这是单文件版（index.html 一个文件包含所有 JS/CSS），用于 GitHub Pages 静态部署。
点击按钮即可在浏览器本地完成跑分（单核/多核/内存），默认约 30 秒。

## 部署
1. 新建 **public** 仓库（默认分支 `main`）。
2. 上传本 ZIP 内所有文件。
3. Push 后 Actions 会自动启用并部署到 Pages。

## 注意
- 全部逻辑在浏览器端执行，不上传数据。
- 使用 Web Workers 并行（Blob URL 方式，不依赖跨域隔离头部）。
- 无外链依赖（不使用 CDN），避免被拦截导致脚本不执行。
