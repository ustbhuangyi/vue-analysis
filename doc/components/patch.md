# patch

通过前一章的分析我们知道，当我们通过 `createComponent` 创建了组件 VNode，接下来会走到 `vm._update`，执行 `vm.__patch__` 去把 VNode 转换成真正的 DOM 节点。这个过程我们在前一章已经分析过了，但是针对一个普通的 VNode 节点，接下来我们来看看组件的 VNode 会有哪些不一样的地方。

patch 的过程会调用 `createElm` 创建元素节点，回顾一下 `createElm` 的实现，它的定义在 `src/core/vdom/patch.js` 中。

```js
function createElm (vnode, insertedVnodeQueue, parentElm, refElm, nested) {
    vnode.isRootInsert = !nested 
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }
    // ...
  }
```

## createComponent

我们删掉多余的代码，只保留关键的逻辑，这里会判断 `createComponent(vnode, insertedVnodeQueue, parentElm, refElm)` 的返回值，如果为 `true` 则直接结束，那么接下来看一下 `createComponent` 方法的实现，它的定义在 `src/core/vdom/patch.js`。

```js
 function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      if (isDef(i = i.hook) && isDef(i = i.init)) {
        i(vnode, false /* hydrating */, parentElm, refElm)
      }
      // 调用init钩后，如果该节点是子组件，
      // 它应该已经创建了一个子实例并挂载它。
      // 子组件也已经设置了占位符。
      // 在这种情况下，我们可以返回元素并完成。
      if (isDef(vnode.componentInstance)) {
        initComponent(vnode, insertedVnodeQueue)
        if (isTrue(isReactivated)) {
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }
```
`createComponent` 函数中，关键的代码有这些

```js
let i = vnode.data
// ...
if (isDef(i = i.hook) && isDef(i = i.init)) {
        i(vnode, false /* hydrating */, parentElm, refElm)
      }
```

如果 `vnode` 是一个组件 VNode，那么这里的 if 条件会满足，并且得到 `i` 就是 `init` 钩子函数，回顾上节我们在创建组件 VNode 的时候合并钩子函数中就包含 `init` 钩子函数，定义在 `src/core/vdom/create-component.js` 中。

```js
init (
    vnode: VNodeWithData,
    hydrating: boolean,
    parentElm: ?Node,
    refElm: ?Node
  ): ?boolean {
    if (!vnode.componentInstance || vnode.componentInstance._isDestroyed) {
      const child = vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance,
        parentElm,
        refElm
      )
      child.$mount(hydrating ? vnode.elm : undefined, hydrating)
    } else if (vnode.data.keepAlive) {
      const mountedNode: any = vnode
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    }
  }
```

`init` 钩子函数执行也很简单，先通过 `createComponentInstanceForVnode` 创建一个 Vue 的实例，然后调用 `$mount` 方法挂载子组件，
先来看一下 `createComponentInstanceForVnode` 的实现，在 `src/core/vdom/create-component.js` 中。

```js
export function createComponentInstanceForVnode (
  vnode: any,
  parent: any,
  parentElm?: ?Node,
  refElm?: ?Node
): Component {
  const options: InternalComponentOptions = {
    _isComponent: true,
    parent,
    _parentVnode: vnode,
    _parentElm: parentElm || null,
    _refElm: refElm || null
  }
  const inlineTemplate = vnode.data.inlineTemplate
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render
    options.staticRenderFns = inlineTemplate.staticRenderFns
  }
  return new vnode.componentOptions.Ctor(options)
}
```

`createComponentInstanceForVnode` 函数构造的一个内部组件的参数，然后执行 `new vnode.componentOptions.Ctor(options)`。这里的 `vnode.componentOptions.Ctor` 对应的就是子组件的构造函数，我们上一节分析了它实际上是继承于 Vue 的一个构造器 `Sub`，相当于 `new Sub(options)` 这里有几个关键参数要注意几个点，`_isComponent` 为 `true` 表示它是一个组件，`parent` 表示当前激活的组件实例（注意，这里比较有意思的是如何拿到组件实例，后面会介绍），`_parentVnode` 表示实例化子组件的父 VNode 实例，`_parentElm` 表示实例化子组件的父容器，也是子组件的最终的挂载点。

所以子组件的实例化实际上就是在这个时机执行的，并且它会执行实例的 `_init` 方法，这个过程有一些和之前不同的地方需要挑出来说，代码在 `src/core/instance/init.js` 中。

```js
Vue.prototype._init = function (options?: Object) {
    const vm: Component = this
    if (options && options._isComponent) {
      initInternalComponent(vm, options)
    } else {
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      )
    }
    // ...
    initRender(vm)
    // ...
    if (vm.$options.el) {
      vm.$mount(vm.$options.el)
    }
    
  }
```

这里首先是合并 `options` 的过程有变化，`_isComponent` 为 true，所以走到了 `initInternalComponent` 过程，这个函数的实现也简单看一下，它的定义在 `src/core/instance/init.js` 中。

```js
function initInternalComponent (vm: Component, options: InternalComponentOptions) {
  const opts = vm.$options = Object.create(vm.constructor.options)
  const parentVnode = options._parentVnode
  opts.parent = options.parent
  opts._parentVnode = parentVnode
  opts._parentElm = options._parentElm
  opts._refElm = options._refElm

  const vnodeComponentOptions = parentVnode.componentOptions
  opts.propsData = vnodeComponentOptions.propsData
  opts._parentListeners = vnodeComponentOptions.listeners
  opts._renderChildren = vnodeComponentOptions.children
  opts._componentTag = vnodeComponentOptions.tag

  if (options.render) {
    opts.render = options.render
    opts.staticRenderFns = options.staticRenderFns
  }
}
```
这个过程我们重点记住以下几个点即可：`opts.parent = options.parent`、`opts._parentVnode = parentVnode`、`opts._parentElm = options._parentElm`，它们是把之前我们通过 `createComponentInstanceForVnode` 函数传入的几个参数合并到内部的选型 `$options` 里了。

回到 `_init` 函数，再看一下 `initRender(vm)` 这段代码，它的定义在 `src/core/instance/render.js` 中。

```js
export function initRender (vm: Component) {
  // 组件渲染的 vnode
  vm._vnode = null
  const options = vm.$options
  // 当前组件的父 vnode 实例
  const parentVnode = vm.$vnode = options._parentVnode
  // ....
}
```
我们只看 `initRender` 的关键部分代码，这里定义了 `vm._vnode`，它是用于当前组件渲染的 VNode，后面会介绍，而 `vm.$vnode` 保留了对 `options._parentVnode` 的引用，它是当前组件的父 VNode 的实例。

再来看一下 `_init` 函数最后执行的代码：

```js
if (vm.$options.el) {
   vm.$mount(vm.$options.el)
}
```
由于组件初始化的时候是不传 el 的，因此组件是自己接管了 `$mount` 的过程，这个过程的主要流程在上一章介绍过了，回到组件 `init`的过程，在完成实例化的 `_init` 后，接着会执行 `child.$mount(hydrating ? vnode.elm : undefined, hydrating)` 。这里 `hydrating` 为 true 一般是服务端渲染的情况，我们只考虑客户端渲染，所以这里 `$mount` 相当于执行 `child.$mount()`，它最终会调用 `mountComponent` 方法，定义在 `src/core/instance/lifecycle.js` 中。

```js
export function mountComponent (
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  vm.$el = el
  
  // ...

  let updateComponent
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== 'production' && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name
      const id = vm._uid
      const startTag = `vue-perf-start:${id}`
      const endTag = `vue-perf-end:${id}`

      mark(startTag)
      const vnode = vm._render()
      mark(endTag)
      measure(`vue ${name} render`, startTag, endTag)

      mark(startTag)
      vm._update(vnode, hydrating)
      mark(endTag)
      measure(`vue ${name} patch`, startTag, endTag)
    }
  } else {
    updateComponent = () => {
      vm._update(vm._render(), hydrating)
    }
  }

  new Watcher(vm, updateComponent, noop, null, true )
  hydrating = false

  if (vm.$vnode == null) {
    vm._isMounted = true
    callHook(vm, 'mounted')
  }
  return vm
}
```

在上一章也分析过，`$mount` 过程首先会执行 `vm._render()` 构造一个当前实例的 VNode，我们再来看一遍 `_render` 函数的实现，它的定义在 `src/core/instance/render.js` 中。

```js
Vue.prototype._render = function (): VNode {
    const vm: Component = this
    const { render, _parentVnode } = vm.$options

    // ...
    // $vnode 保留 _parentVnode 的引用
    vm.$vnode = _parentVnode
    let vnode
    try {
      vnode = render.call(vm._renderProxy, vm.$createElement)
    } catch (e) {
      // ...
    }
    
    // set parent
    vnode.parent = _parentVnode
    return vnode
  }
```

我们只保留关键部分的代码，这里的 `_parentVnode` 就是当前组件的父 VNode，那么组件通过 `render` 函数生成的 VNode 的 `parent` 就指向了 `vm.$vnode`。这块儿也是很多同学容易混淆的一点，这里我们可以这么去记，组件的父 VNode 和组件渲染的 VNode 是 2 个不同的 VNode，它们是一种父子的关系。

我们知道在执行完 `vm._render` 生成 VNode 后，接下来就要执行 `vm._update` 去渲染 VNode 了。来看一下组件渲染的过程中有哪些需要注意的，`vm._update` 的定义在 `src/core/instance/lifecycle.js` 中。

```js
export let activeInstance: any = null
Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    if (vm._isMounted) {
      callHook(vm, 'beforeUpdate')
    }
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    const prevActiveInstance = activeInstance
    activeInstance = vm
    vm._vnode = vnode
    if (!prevVnode) {
      // 初始渲染
      vm.$el = vm.__patch__(
        vm.$el, vnode, hydrating, false,
        vm.$options._parentElm,
        vm.$options._refElm
      )
      vm.$options._parentElm = vm.$options._refElm = null
    } else {
      // updates
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    activeInstance = prevActiveInstance
  }
```
`_update` 过程中有几个关键的代码，首先 `vm._vnode = vnode` 的逻辑，这个 `vnode` 是通过 `vm._render()` 返回的组件渲染 VNode，`vm._vnode` 和 `vm.$vnode` 的关系就是一种父子关系，用代码表达就是 `vm._vnode.parent === vm.$vnode`。还有一段比较有意思的代码：

```js
export let activeInstance: any = null
Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    // ...
    const prevActiveInstance = activeInstance
    activeInstance = vm
    // patch or update 过程
    activeInstance = prevActiveInstance
  }

```
这个 `activeInstance` 作用就是保持当前上下文的 Vue 实例，它是在 `lifecycle` 模块的全局变量，定义是 `export let activeInstance: any = null`，并且在之前我们调用 `createComponentInstanceForVnode` 方法的时候从 `lifecycle` 模块获取，并且作为参数传入的。因为实际上 Vue 整个初始化是一个深度遍历的过程，在初始化组件 VNode 的过程中，它需要知道当前上下文的 Vue 实例是什么，所以就在 `vm._update` 的过程中，把当前的 `vm` 赋值给 `activeInstance`，同时通过 `const prevActiveInstance = activeInstance` 用 `prevActiveInstance` 保留上一次的 `activeInstance`。实际上，`prevActiveInstance` 和当前的 `vm` 是一个父子关系，当一个 `vm` 实例完成它的所有子树的 patch 或者 update 过程后，`activeInstance` 会回到它的父实例，这样就完美的保证了 `createComponentInstanceForVnode` 整个深度遍历过程中，我们在实例化子组件 的时候能传入当前子组件实例的父实例，并且这个关系的保留发生在 `_init` 的过程中。之前我们提到过对子组件的实例化过程先会调用 `initInternalComponent(vm, options)` 合并 `options`，把 `parent` 存储在 `vm.$options` 中，接着会调用 `initLifecycle(vm)` 方法，它的定义在 `src/core/instance/lifecycle.js` 中。

```js
export function initLifecycle (vm: Component) {
  const options = vm.$options

  // 找到第一个非抽象组件的 parent
  let parent = options.parent
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent
    }
    parent.$children.push(vm)
  }

  vm.$parent = parent
  // ...
}
```
可以看到 `vm.$parent` 就是用来保留当前 `vm` 的父实例，并且通过 `parent.$children.push(vm)` 来把当前的 `vm` 存储到父实例的 `$children` 中。

那么回到 `_update`，最后就是调用 `__patch__` 渲染 VNode 了。

```js
vm.$el = vm.__patch__(
    vm.$el, vnode, hydrating, false,
    vm.$options._parentElm,
    vm.$options._refElm
  )
```
这里又回到了本节开始的过程，之前分析过负责渲染成 DOM 的函数是 `createElm`，我们再来看看它的定义，在 `src/core/vdom/vnode.js` 中

```js
function createElm (vnode, insertedVnodeQueue, parentElm, refElm, nested) {
    // ...
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }

    const data = vnode.data
    const children = vnode.children
    const tag = vnode.tag
    if (isDef(tag)) {
      // ...
      vnode.elm = vnode.ns
        ? nodeOps.createElementNS(vnode.ns, tag)
        : nodeOps.createElement(tag, vnode)
      setScope(vnode)

      if (__WEEX__) {
        // weex..
      } else {
        createChildren(vnode, children, insertedVnodeQueue)
        if (isDef(data)) {
          invokeCreateHooks(vnode, insertedVnodeQueue)
        }
        insert(parentElm, vnode.elm, refElm)
      }

      // ...
    } else if (isTrue(vnode.isComment)) {
      // ...
    } else {
      // ...
    }
  }
```
注意，这里我们传入的 `vnode` 是组件渲染的 `vnode`，也就是我们之前说的 `vm._vnode`，那么`createComponent(vnode, insertedVnodeQueue, parentElm, refElm))` 的返回值显然是 false，接下来的过程就和我们上一章一样了。先创建一个父节点占位符，然后再遍历所有子 VNode 递归调用 `createElm`，最终创建出一个完整的 DOM 树，在递归的过程中，如果遇到了子 VNode 如果是一个组件的 VNode，则重复本节开始提到的过程。

那么到此，一个组件的 VNode 是如何创建、初始化、渲染的过程也就介绍完毕了。在对组件化的实现有一个大概了解后，接下来我们来介绍一下这其中的一些细节，下一节我们来分析组件的生命周期。







 
 