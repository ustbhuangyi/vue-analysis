# 组件更新

在组件化章节，我们介绍了 Vue 的组件化实现过程，不过我们只讲了 Vue 组件的创建过程，并没有涉及到组件数据发生变化，更新组件的过程。而通过我们这一章对数据响应式原理的分析，了解到当数据发生变化的时候，会触发渲染 `watcher` 的回调函数，进而执行组件的更新过程，接下来我们来详细分析这一过程。

```js
 updateComponent = () => {
   vm._update(vm._render(), hydrating)
 }
  new Watcher(vm, updateComponent, noop, null, true /* isRenderWatcher */)
```

组件的更新还是调用了 `vm._update` 方法，我们再回顾一下这个方法，它的定义在 `src/core/instance/lifecycle.js` 中。

```js
Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
  const vm: Component = this
  // ...
  const prevVnode = vm._vnode
  if (!prevVnode) {
    vm.$el = vm.__patch__(
      vm.$el, vnode, hydrating, false /* removeOnly */,
      vm.$options._parentElm,
      vm.$options._refElm
    )
    vm.$options._parentElm = vm.$options._refElm = null
  } else {
    // updates
    vm.$el = vm.__patch__(prevVnode, vnode)
  }
  // ...
}
```

组件更新的过程，会执行 `vm.$el = vm.__patch__(prevVnode, vnode)`，它仍然会调用 `patch` 函数，在 `src/core/vdom/patch.js` 中定义。

```js
return function patch (oldVnode, vnode, hydrating, removeOnly, parentElm, refElm) {
  if (isUndef(vnode)) {
          // ...
        } else {
          const isRealElement = isDef(oldVnode.nodeType)
          if (!isRealElement && sameVnode(oldVnode, vnode)) {
            // 更新 vnode
            patchVnode(oldVnode, vnode, insertedVnodeQueue, removeOnly)
          } else {
            // ...
            // 替换已有节点
            const oldElm = oldVnode.elm
            const parentElm = nodeOps.parentNode(oldElm)
        
            // 创建新节点
            createElm(
              vnode,
              insertedVnodeQueue,
              oldElm._leaveCb ? null : parentElm,
              nodeOps.nextSibling(oldElm)
            )
        
            // 更新父的占位符节点 
            if (isDef(vnode.parent)) {
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
                  const insert = ancestor.data.hook.insert
                  if (insert.merged) {
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
        
            // 删除旧节点
            if (isDef(parentElm)) {
              removeVnodes(parentElm, [oldVnode], 0, 0)
            } else if (isDef(oldVnode.tag)) {
              invokeDestroyHook(oldVnode)
            }
          }
        }
        
        invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
        return vnode.elm  
}
```
这里执行 `patch` 的逻辑和首次渲染是不一样的，因为 `oldVnode` 不为空，并且它和 `vnode` 都是 VNode 类型，接下来会通过 `sameVNode(oldVnode, vnode)` 判断它们是否是相同的 VNode 来决定走不同的更新逻辑，它的定义在 `src/core/vdom/patch.js` 中。

```js
function sameVnode (a, b) {
  return (
    a.key === b.key && (
      (
        a.tag === b.tag &&
        a.isComment === b.isComment &&
        isDef(a.data) === isDef(b.data) &&
        sameInputType(a, b)
      ) || (
        isTrue(a.isAsyncPlaceholder) &&
        a.asyncFactory === b.asyncFactory &&
        isUndef(b.asyncFactory.error)
      )
    )
  )
}
```
`sameVnode` 的逻辑非常简单，如果两个 `vnode` 的 `key` 相等，则是相同的；否则对于同步组件，则判断 `isComment`、`data`、input 类型是否相同，对于异步组件，则判断 `asyncFactory` 是否相同等等。

所以根据新旧 `vnode` 是否为 `sameVnode`，会走到不同的更新逻辑，我们先来说一下不同的情况。

## 新旧节点不同

如果新旧 `vnode` 不同，那么更新的逻辑非常简单，大致分为 3 步

- 创建新节点

```js
createElm(
  vnode,
  insertedVnodeQueue,
  oldElm._leaveCb ? null : parentElm,
  nodeOps.nextSibling(oldElm)
)
```

以当前旧节点为参考节点，创建新的节点，并插入到 DOM 中，`createElm` 的逻辑我们之前分析过。

- 更新父的占位符节点

```js
if (isDef(vnode.parent)) {
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
      const insert = ancestor.data.hook.insert
      if (insert.merged) {
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
```
我们只关注主要逻辑即可，找到当前 `vnode` 的父的占位符节点，先执行各个 `module` 的 `destroy` 的钩子函数，如果当前占位符是一个可挂载的节点，则执行 `module` 的 `create` 钩子函数。对于这些钩子函数的作用，在之后的章节会详细介绍。

- 删除旧节点

```js
 if (isDef(parentElm)) {
  removeVnodes(parentElm, [oldVnode], 0, 0)
} else if (isDef(oldVnode.tag)) {
  invokeDestroyHook(oldVnode)
}
```
把 `oldVnode` 从当前 DOM 树中删除，如果父节点存在，则执行 `removeVnodes` 方法，它的定义在 `src/core/vdom/patch.js` 中。

```js
 function removeVnodes (parentElm, vnodes, startIdx, endIdx) {
  for (; startIdx <= endIdx; ++startIdx) {
    const ch = vnodes[startIdx]
    if (isDef(ch)) {
      if (isDef(ch.tag)) {
        removeAndInvokeRemoveHook(ch)
        invokeDestroyHook(ch)
      } else { // Text node
        removeNode(ch.elm)
      }
    }
  }
}
```
删除节点逻辑很简单，就是遍历待删除的 `vnodes` 做删除，其中 `removeAndInvokeRemoveHook`  的作用是从 DOM 中移除节点并执行 `module` 的 `remove` 钩子函数，并对它的子组件递归调用 `removeAndInvokeRemoveHook` 函数；`invokeDestroyHook` 是执行 `module` 的 `destory` 钩子函数以及 `vnode` 的 `destory` 钩子函数，并对它的子 `vnode` 递归调用 `invokeDestroyHook` 函数；`removeNode` 就是调用平台的 DOM API 去把真正的 DOM 节点移除。

在之前介绍组件生命周期的时候提到 `beforeDestroy & destroyed` 这两个生命周期钩子函数，它们就是在执行 `invokeDestroyHook` 过程中，执行了 `vnode` 的 `destory` 钩子函数，它的定义在 `src/core/vdom/create-component.js` 中。

```js
const componentVNodeHooks = {
  // ...
  destroy (vnode: MountedComponentVNode) {
    const { componentInstance } = vnode
    if (!componentInstance._isDestroyed) {
      if (!vnode.data.keepAlive) {
        componentInstance.$destroy()
      } else {
        deactivateChildComponent(componentInstance, true /* direct */)
      }
    }
  }
}
```

当组件并不是 `keepAlive` 的时候，会执行 `componentInstance.$destroy()` 方法，然后就会执行 `beforeDestroy & destroyed` 两个钩子函数。

## 新旧节点相同

还有一种组件 `vnode` 的更新情况是新旧节点相同，它会调用 `patchVNode` 方法，它的定义在 `src/core/vdom/patch.js` 中。

```js
function patchVnode (oldVnode, vnode, insertedVnodeQueue, removeOnly) {
  if (oldVnode === vnode) {
    return
  }
  
  const elm = vnode.elm = oldVnode.elm
  
  if (isTrue(oldVnode.isAsyncPlaceholder)) {
    if (isDef(vnode.asyncFactory.resolved)) {
      hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
    } else {
      vnode.isAsyncPlaceholder = true
    }
    return
  }
  
  // reuse element for static trees.
  // note we only do this if the vnode is cloned -
  // if the new node is not cloned it means the render functions have been
  // reset by the hot-reload-api and we need to do a proper re-render.
  if (isTrue(vnode.isStatic) &&
    isTrue(oldVnode.isStatic) &&
    vnode.key === oldVnode.key &&
    (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
  ) {
    vnode.componentInstance = oldVnode.componentInstance
    return
  }
  
  let i
  const data = vnode.data
  if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
    i(oldVnode, vnode)
  }
  
  const oldCh = oldVnode.children
  const ch = vnode.children
  if (isDef(data) && isPatchable(vnode)) {
    for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
    if (isDef(i = data.hook) && isDef(i = i.update)) i(oldVnode, vnode)
  }
  if (isUndef(vnode.text)) {
    if (isDef(oldCh) && isDef(ch)) {
      if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly)
    } else if (isDef(ch)) {
      if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '')
      addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue)
    } else if (isDef(oldCh)) {
      removeVnodes(elm, oldCh, 0, oldCh.length - 1)
    } else if (isDef(oldVnode.text)) {
      nodeOps.setTextContent(elm, '')
    }
  } else if (oldVnode.text !== vnode.text) {
    nodeOps.setTextContent(elm, vnode.text)
  }
  if (isDef(data)) {
    if (isDef(i = data.hook) && isDef(i = i.postpatch)) i(oldVnode, vnode)
  }
}
```



