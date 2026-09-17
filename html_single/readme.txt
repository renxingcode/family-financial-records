这里存放的是当前版本的独立文件的代码，必须要联网才行，可以在手机上的 content:// 协议下打开，不支持多文件(CSS/JS)加载。
如果以后CSS和JS逻辑稳定了，可以考虑把CSS和JS放到自己的服务器上，然后像加载 https://unpkg.com/vue@3/dist/vue.global.prod.js 一样加载这里面的CSS和JS，可以大幅度减少HTML的代码量。

如果要在手机上支持多文件(CSS/JS)加载，需要找到支持 file:// 协议的浏览器，比如 PC浏览器 或者 安卓手机端的 via浏览器(不太稳定) 或者 UC 浏览器(相对稳定一些,但广告多)；
至少目前的版本可以，不确定以后升级后还能不能支持，现在安卓手机的很多浏览器都不支持 file:// 协议了。
在我的荣耀手机上的 UC浏览器 比较稳定，而且可以用 file:// 形式打开多文件，比via浏览器稳定一些；

但就是 UC浏览器 的广告太多了，所以我设置了UC浏览器不允许联网，问题是无法在线访问 https://unpkg.com/vue@3/dist/vue.global.prod.js，
于是乎我就把 vue.global.prod.js 下载下来了，放到了项目根目录的 data/ 文件夹里面，
然后把 account.html 中加载Vue组件部分改为 <script src="vue.global.prod.js"></script> 就可以离线加载了，而且还没有广告，美滋滋！
如果需要离线访问，可以参考这个方式。