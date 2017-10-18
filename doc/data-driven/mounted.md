# Vue 实例挂载的实现

Vue 中我们是通过 `$mount` 实例方法去挂载 Vue 实例的，`$mount` 方法在多个文件中都有定义，如 `src/platform/web/entry-runtime-with-compiler.js`、`src/platform/web/runtime/index.js`、`src/platform/weex/runtime/index.js`。这些文件实际上对应的 Vue 打包不同的入口，因为 `$mount` 这个方法的实现是和平台、构建方式都相关的。接下来我们重点分析 `runtime-only` 版本的 `$monut` 实现，在 `src/platform/web/runtime/index.js` 文件中定义：

```js
//
Vue.prototype.$mount = function (
  el?: string | Element,
  hydrating?: boolean
): Component {
  el = el && inBrowser ? query(el) : undefined
  return mountComponent(this, el, hydrating)
}
```
`$mount` 方法支持传入 2 个参数，第一个是 `el`，它表示挂载的元素，可以是字符串，也可以是 DOM 对象，如果是字符串在浏览器环境下会调用 `query` 方法转换成 DOM 对象的。第二个参数是和服务端渲染相关，之后我们会介绍，在浏览器环境下我们不需要传第二个参数。

`$mount` 方法实际上回去调用 `mountComponent` 方法，这个方法定义在 `src/core/instance/lifecycle.js` 文件中。

```js
export function mountComponent (
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  // 把挂载的 DOM 对象赋值给 $el 属性
  vm.$el = el
  // 没有定义 render 方法的情况
  if (!vm.$options.render) {
    // 把 render 方法指向创建一个空的虚拟 Node
    vm.$options.render = createEmptyVNode
    if (process.env.NODE_ENV !== 'production') {
      // 非生产环境，会警告
      /* istanbul ignore if */
      if ((vm.$options.template && vm.$options.template.charAt(0) !== '#') ||
        vm.$options.el || el) {
        warn(
          'You are using the runtime-only build of Vue where the template ' +
          'compiler is not available. Either pre-compile the templates into ' +
          'render functions, or use the compiler-included build.',
          vm
        )
      } else {
        warn(
          'Failed to mount component: template or render function not defined.',
          vm
        )
      }
    }
  }
  // 调用 beforeMount 的钩子函数
  callHook(vm, 'beforeMount')

  // 更新组件的方法
  let updateComponent
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    // 在非生产环境中会做一些性能相关的监控
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      // 调用 _render 方法生成 VNode
      const vnode = vm._render()
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      // 调用 _update 方法更新 DOM
      vm._update(vnode, hydrating)
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }
  }

  // 同时给 vm 实例添加一个 Watcher，用来监测 vm 数据发生变化
  vm._watcher = new Watcher(vm, updateComponent, noop)
  hydrating = false

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  if (vm.$vnode == null) {
    vm._isMounted = true
    callHook(vm, 'mounted')
  }
  return vm
}
```
从上面的代码可以看到，`mountComponent` 核心就是先调用 `vm._render` 方法先生成虚拟 Node，再调用 `vm._update` 方法更新 DOM。并且，它还给 `vm` 创建了一个 `Watcher` 对象，用来检测 `vm` 的数据变化后重新调用 `updateComponent` 方法更新 DOM。

所以 `mountComponent` 方法的逻辑也是非常清晰的，接下来我们要重点分析 2 个方法：`vm._render` 和 `vm._update`。
