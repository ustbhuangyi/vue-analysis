# Vue.js 源码的构建

Vue.js 源码是基于 Rollup 构建的，它的构建相关配置都在 build 目录下。

## 构建脚本

通常一个基于 NPM 托管的项目都会有一个 package.json 文件，它是对项目的描述文件，它的内容实际上是一个标准的 JSON 对象。

这个 JSON 对象一般会有 `script` 字段，作为 NPM 的执行脚本，Vue.js 源码构建的脚本如下：

```json
{
  "script": {
      "build": "node build/build.js",
      "build:ssr": "npm run build -- vue.runtime.common.js,vue-server-renderer",
      "build:weex": "npm run build -- weex-vue-framework,weex-template-compiler",
  }
}
 
```

这 3 条命令分别是构建浏览器端的 Vue.js、服务端的 Vue.js 以及 Weex 客户端的 Vue.js。

以浏览器端的 Vue.js 构建为例，当在命令行运行 `npm run build` 的时候，实际上就会执行 `node build/build.js`，接下来我们来看看它实际是怎么构建的。

## 构建过程

