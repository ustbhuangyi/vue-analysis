# _update 的分析

Vue 的 `_update` 是实例的一个私有方法，它被调用的时机有 2 个，一个是首次渲染，一个是数据更新的时候；由于我们这一章节的主题数据驱动，所以只分析首次渲染部分，数据更新部分会在之后分析响应式原理的时候涉及。`_update` 方法的作用是把 VNode 渲染成真实的 DOM，它的定义在 `src/core/instance/lifecycle.js` 中。

```js
Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this
    if (vm._isMounted) {
      callHook(vm, 'beforeUpdate')
    }
    const prevEl = vm.$el
    const prevVnode = vm._vnode
    const prevActiveInstance = activeInstance
    activeInstance = vm
    // 把组件对应的 VNode 用 _vnode 保存
    vm._vnode = vnode
    // Vue.prototype.__patch__ 方法定义在入口的地方，它和是否是服务端渲染、平台等都有关。
    if (!prevVnode) {
      // 初始渲染
      vm.$el = vm.__patch__(
        vm.$el, vnode, hydrating, false /* removeOnly */,
        vm.$options._parentElm,
        vm.$options._refElm
      )
      // no need for the ref nodes after initial patch
      // this prevents keeping a detached DOM tree in memory (#5851)
      vm.$options._parentElm = vm.$options._refElm = null
    } else {
      // 更新
      vm.$el = vm.__patch__(prevVnode, vnode)
    }
    activeInstance = prevActiveInstance
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null
    }
    if (vm.$el) {
      vm.$el.__vue__ = vm
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  }
```

`_update` 方法被 的核心就是调用 `vm.__patch__` 方法，这个方法实际上在不同的平台，比如 web 和 weex 上的定义是不一样的，因此它的定义在 `src/platforms/web/runtime/index.js` 中。

```js
Vue.prototype.__patch__ = inBrowser ? patch : noop
```

可以看到，甚至在 web 平台上，是否是服务端渲染也会对这个方法产生影响。因为在服务端渲染中，没有真实的浏览器 DOM 环境，所以不需要把 VNode 最终转换成 DOM，因此是一个空函数，而在浏览器端渲染中，它指向了 `patch` 方法，它的定义在 `src/platforms/web/runtime/patch.js`中。

```js
export const patch: Function = createPatchFunction({ nodeOps, modules })
```
`patch` 方法的定义是调用 `createPatchFunction` 方法的返回值，这里传入了一个对象，包含 `nodeOps` 参数和 `modules` 参数。其中，`nodeOps` 封装了一系列操作的方法，`modules` 定义了一些属性的钩子函数的实现，我们这里先不详细介绍，来看一下 `createPatchFunction` 的实现，它定义在 `src/core/vdom/patch.js` 中。

```js
const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

export function createPatchFunction (backend) {
  let i, j
  const cbs = {}

  const { modules, nodeOps } = backend

  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }

  // 定义了一系列的辅助方法...
  
  return function patch (oldVnode, vnode, hydrating, removeOnly, parentElm, refElm) {
    if (isUndef(vnode)) {
      // 执行销毁旧节点的钩子函数
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
      return
    }

    let isInitialPatch = false
    const insertedVnodeQueue = []

    if (isUndef(oldVnode)) {
      // 空挂载，在做一些动态插入的组件的时候常用到
      isInitialPatch = true
      // 给 vnode 添加 elm 对象并且渲染整个 DOM 树
      createElm(vnode, insertedVnodeQueue, parentElm, refElm)
    } else {
      // isRealElement 表示它是一个原生的 DOM 节点，第一次 patch 的时候 oldVnode 是原生的 DOM 节点
      const isRealElement = isDef(oldVnode.nodeType)
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // diff 更新过程
        patchVnode(oldVnode, vnode, insertedVnodeQueue, removeOnly)
      } else {
        if (isRealElement) {
          // 命中该逻辑表示这个节点是通过 server-render 创建的
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
          if (isTrue(hydrating)) {
            // 服务端渲染的节点调用 hydrate 方法更新 vnode 的一些属性
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              // 执行插入的钩子函数
              invokeInsertHook(vnode, insertedVnodeQueue, true)
              // 返回 oldVnode，此时它还是原生 DOM 节点
              return oldVnode
            } else if (process.env.NODE_ENV !== 'production') {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                'server-rendered content. This is likely caused by incorrect ' +
                'HTML markup, for example nesting block-level elements inside ' +
                '<p>, or missing <tbody>. Bailing hydration and performing ' +
                'full client-side render.'
              )
            }
          }
          // 非 server-rendered 或者 hydration 失败的时候基于原生 DOM 创建一个 VNode 节点，oldVnode 此时是一个 VNode 对象
          oldVnode = emptyNodeAt(oldVnode)
        }
        // 当前 DOM 对象
        const oldElm = oldVnode.elm
        // 当前 DOM 对象的父级 DOM
        const parentElm = nodeOps.parentNode(oldElm)
        // 给 vnode 添加 elm 对象并且渲染整个 DOM 树
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        )

        if (isDef(vnode.parent)) {
          // 组件根节点的替换，递归调用
          // component root element replaced.
          // update parent placeholder node element, recursively
          let ancestor = vnode.parent
          const patchable = isPatchable(vnode)
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor)
            }
            ancestor.elm = vnode.elm
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]()
                }
              }
            } else {
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        if (isDef(parentElm)) {
          // 有父节点的情况则删除旧节点
          removeVnodes(parentElm, [oldVnode], 0, 0)
        } else if (isDef(oldVnode.tag)) {
          // 当前节点被直接替换，
          invokeDestroyHook(oldVnode)
        }
      }
    }

    // 根据插入的 VNode 顺序，执行 insert hook
    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
    // 返回 vnode 对应的真实 DOM 节点
    return vnode.elm
  }
}
```

`createPatchFunction` 内部定义了一系列的辅助方法，最终返回了一个 `patch` 方法，这个方法就是之前在 `_update` 函数里调用的 `vm.__patch__` 。

在介绍 `patch` 的方法实现之前，我们可以思考一下为何 Vue.js 源码绕了这么一大圈，把相关代码分散到各个目录。因为前面介绍过，`patch` 是平台相关的，在 Web 和 Weex 环境，它们把虚拟 DOM 映射到 “平台 DOM” 的方法是不同的，并且对 “DOM” 包括的属性模块创建和更新也不尽相同。因此每个平台都有各自的 `nodeOps` 和 `modules`，它们的代码需要托管在 `src/platforms` 这个大目录下。

而不同平台的 `patch` 的主要逻辑部分是相同的，所以这部分公共的部分托管在 `core` 这个大目录下。差异化部分只需要通过参数来区别，这里用到了一个函数柯里化的技巧，通过 `createPatchFunction` 把差异化参数提前固化，这样不用每次调用 `patch` 的时候都传递 `nodeOps` 和 `modules` 了，这种编程技巧也非常值得学习。

在这里，`nodeOps` 表示对 “平台 DOM” 的一些操作方法，`modules` 表示平台的一些模块，它们会在整个 `patch` 过程的不同阶段执行相应的钩子函数。这些代码的具体实现会在之后的章节介绍。

回到 `patch` 方法本身，它接收 6 个参数，`oldVnode` 表示旧的 VNode 节点，它也可以不存在或者是一个 DOM 对象；`vnode` 表示当前的 `_render` 后的 VNode 的节点；`hydrating` 表示是否是服务端渲染；`removeOnly` 是给 `transition-group` 用的，之后会介绍；``