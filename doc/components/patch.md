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

`createComponentInstanceForVnode` 函数构造的一个内部组件的参数，然后执行 `new vnode.componentOptions.Ctor(options)`。这里的 vnode.componentOptions.Ctor 对应的就是子组件的构造函数，我们上一节分析了它实际上是继承于 Vue 的一个构造器。这里有几个关键参数要注意几个点，`_isComponent` 为 `true` 表示它是一个组件，`parent` 表示当前的组件实例，`_parentVnode` 表示当前组件的 `vnode` 实例，`_parentElm` 表示当前组件的父容器，也是组件的最终的挂载点。

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

回到 `_init` 函数，看最后执行的代码：

```js
if (vm.$options.el) {
   vm.$mount(vm.$options.el)
}
```
由于组件初始化的时候是不传 el 的，因此组件是自己接管了 `$mount` 的过程，这个过程的主要流程在上一章介绍过了，这里我们会介绍组件执行 `child.$mount(hydrating ? vnode.elm : undefined, hydrating)` 有哪些不一样的地方，这里 `hydrating` 为 true 一般是服务端渲染的情况，我们只考虑客户端渲染，所以这里 `$mount` 相当于执行 `child.$mount()`。

`$mount` 过程首先会执行 `vm._render()` 构造一个当前实例的 VNode，**注意**，这里的 VNode 和我们之前通过 `createComponentInstanceForVnode` 创建的 VNode，也就是 `child` 并不是一个 VNode，那么它们之间是什么关系呢，我们再来看一遍 `_render` 函数的实现，它的定义在 `src/core/instance/render.js` 中。

```js
Vue.prototype._render = function (): VNode {
    const vm: Component = this
    const { render, _parentVnode } = vm.$options

    // ...
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

我们只保留关键部分的代码，这里的 `_parentVnode` 就是当前组件的 `vnode`，也就是 `child`，那么组件通过 `render` 函数生成的 `vnode` 的 `parent` 就指向了 `child`，所以可以说他们是一种父子关系。这块儿也是很多同学容易混淆的一点，这里我们可以这么去记，组件本身的 VNode 和组件渲染的 VNode 是 2 个不同的 VNode，它们是一种父子的关系。

我们知道在执行完 `vm._render` 生成 VNode 后，接下来就要执行 `vm._update` 去渲染 VNode 了。来看一下组件渲染的过程中有哪些需要注意的，`vm._update` 的定义在 `src/core/instance/lifecycle.js` 中。







 
 