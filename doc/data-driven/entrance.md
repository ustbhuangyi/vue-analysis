# 从入口开始

通常我们用 `vue-cli` 生成的初始项目，会有一个入口文件 `main.js`，一个页面组件 `App.vue`。其中，`main.js` 会有一段初始化代码，如下：

```js
import Vue from 'vue'
import App from './App.vue'

new Vue({
  el: '#app',
  router,
  store,
  render: h => h(App)
})
```

`App.vue` 的代码如下：
 
 ## new Vue 发生了什么
 
 我们都知道，`new` 关键字在 Javascript 语言中代表实例化是一个对象，而 `Vue` 实际上是一个类，类在 Javascript 中是用 Function 来实现的，来看一下源码，在`src/core/instance/index.js` 中。
 
```js
function Vue (options) {
  // 必须通过 new 关键字初始化 Vue
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}
```
可以看到 `Vue` 只能通过 new 关键字初始化，然后会调用 `this._init` 方法， 该方法在 `src/core/instance/init.js` 中定义。

```js
Vue.prototype._init = function (options?: Object) {
    // vm 表示当前实例，它是一个 Component 类型
    const vm: Component = this
    // 给每个 Vue 实例定义一个自增的 _uid。
    vm._uid = uid++

    // 开始和结束标签，用于做性能监控用
    let startTag, endTag
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      // 非生产环境做性能监控
      startTag = `vue-perf-init:${vm._uid}`
      endTag = `vue-perf-end:${vm._uid}`
      // mark 函数用来标记性能
      mark(startTag)
    }

    // _isVue 作为 Vue 实例的标识，防止 Vue 的实例被监测
    vm._isVue = true
    // 合并 options，如果 _isComponent 为 true 表示是内层组件。
    if (options && options._isComponent) {
      // 对内层组件实例化的优化，因为动态合并是很慢的，而内层组件的 options 是无需特殊对待的。
      initInternalComponent(vm, options)
    } else {
      // 通过 mergeOptions 方法合并 Vue 构造函数的 options 及用户传入的 options
      vm.$options = mergeOptions(
        // 解析 Vue 构造函数的 options
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== 'production') {
      // 非生产环境下初始化代理
      initProxy(vm)
    } else {
      // _renderProxy 指向实例自身
      vm._renderProxy = vm
    }
    // 添加 _self 属性指向自身
    vm._self = vm
    // 初始化生命周期
    initLifecycle(vm)
    // 初始化事件中心
    initEvents(vm)
    // 初始化渲染方法
    initRender(vm)
    // 调用 beforeCreate 的钩子函数
    callHook(vm, 'beforeCreate')
    // 初始化 injections
    initInjections(vm)
    // 初始化 data、props、computed、methods、watch 等属性
    initState(vm)
    // 初始化 provide
    initProvide(vm)
    // 调用 created 的钩子函数
    callHook(vm, 'created')

    /* istanbul ignore if */
    // 非生产环境做性能监控
    if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
      // 格式化组件的名称，赋值给 _name
      vm._name = formatComponentName(vm, false)
      mark(endTag)
      measure(`${vm._name} init`, startTag, endTag)
    }

    // 如果有 el 属性，则调用 vm.$mount 方法挂载 Vue 实例
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
  }
```
从上面的代码可以看到，Vue 的初始化逻辑写的非常清楚，把不同的功能逻辑拆成一些单独的函数执行，让主线逻辑一目了然，这样的编程思想是非常值得借鉴和学习的。

在初始化的最后，检测到如果有 el 属性，则调用 vm.$mount 方法挂载 Vue 实例。那么接下来，我们来对 Vue 的挂载来做分析。