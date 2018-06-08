# keep-alive

在我们的平时开发工作中，经常为了组件的缓存优化而使用 `<keep-alive>` 组件，乐此不疲，但很少有人关注它的实现原理，下面就让我们来一探究竟。

## 内置组件

`<keep-alive>` 是 Vue 源码中实现的一个组件，也就是说 Vue 源码不仅实现了一套组件化的机制，也实现了一些内置组件，它的定义在 `src/core/components/keep-alive.js` 中：

```js
export default {
  name: 'keep-alive,
  abstract: true,

  props: {
    include: patternTypes,
    exclude: patternTypes,
    max: [String, Number]
  },

  created () {
    this.cache = Object.create(null)
    this.keys = []
  },

  destroyed () {
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys)
    }
  },

  mounted () {
    this.$watch('include', val => {
      pruneCache(this, name => matches(val, name))
    })
    this.$watch('exclude', val => {
      pruneCache(this, name => !matches(val, name))
    })
  },

  render () {
    const slot = this.$slots.default
    const vnode: VNode = getFirstComponentChild(slot)
    const componentOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
    if (componentOptions) {
      // check pattern
      const name: ?string = getComponentName(componentOptions)
      const { include, exclude } = this
      if (
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        return vnode
      }

      const { cache, keys } = this
      const key: ?string = vnode.key == null
        // same constructor may get registered as different local components
        // so cid alone is not enough (#3269)
        ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
        : vnode.key
      if (cache[key]) {
        vnode.componentInstance = cache[key].componentInstance
        // make current key freshest
        remove(keys, key)
        keys.push(key)
      } else {
        cache[key] = vnode
        keys.push(key)
        // prune oldest entry
        if (this.max && keys.length > parseInt(this.max)) {
          pruneCacheEntry(cache, keys[0], keys, this._vnode)
        }
      }

      vnode.data.keepAlive = true
    }
    return vnode || (slot && slot[0])
  }
}
```

可以看到 `<keep-alive>` 组件的实现也是一个对象，注意它有一个属性 `abstract` 为 true，是一个抽象组件，Vue 的文档没有提这个概念，实际上它在组件实例建立父子关系的时候会被忽略，发生在 `initLifecycle` 的过程中：

```js
// locate first non-abstract parent
let parent = options.parent
if (parent && !options.abstract) {
  while (parent.$options.abstract && parent.$parent) {
    parent = parent.$parent
  }
  parent.$children.push(vm)
}
vm.$parent = parent
```

`<keep-alive>` 在 `created` 钩子里定义了 `this.cache` 和 `this.keys`，本质上它就是去缓存已经创建过的 `vnode`。它的 `props` 定义了 `include`，`exclude`，它们可以字符串或者表达式，`include` 表示只有匹配的组件会被缓存，而 `exclude` 表示任何匹配的组件都不会被缓存，`props` 还定义了 `max`，它表示缓存的大小，因为我们是缓存的 `vnode` 对象，它也会持有 DOM，当我们缓存很多的时候，会比较占用内存，所以该配置允许我们指定缓存大小。

`<keep-alive>` 直接实现了 `render` 函数，而不是我们常规模板的方式，执行 `<keep-alive>` 组件渲染的时候，就会执行到这个 `render` 函数，接下来我们分析一下它的实现。

首先获取第一个子元素的 `vnode`：

```js
const slot = this.$slots.default
const vnode: VNode = getFirstComponentChild(slot)
```

由于我们也是在 `<keep-alive>` 标签内部写 DOM，所以可以先获取到它的默认插槽，然后再获取到它的第一个子节点。`<keep-alive>` 只处理第一个子元素，所以一般和它搭配使用的有 `component` 动态组件或者是 `router-view`，这点要牢记。

然后又判断了当前组件的名称和 `include`、`exclude` 的关系：

```js
// check pattern
const name: ?string = getComponentName(componentOptions)
const { include, exclude } = this
if (
  // not included
  (include && (!name || !matches(include, name))) ||
  // excluded
  (exclude && name && matches(exclude, name))
) {
  return vnode
}

function matches (pattern: string | RegExp | Array<string>, name: string): boolean {
  if (Array.isArray(pattern)) {
    return pattern.indexOf(name) > -1
  } else if (typeof pattern === 'string') {
    return pattern.split(',').indexOf(name) > -1
  } else if (isRegExp(pattern)) {
    return pattern.test(name)
  }
  return false
}
```

`matches` 的逻辑很简单，就是做匹配，分别处理了数组、字符串、正则表达式的情况，也就是说我们平时传的 `include` 和 `exclude` 可以是这三种类型的任意一种。并且我们的组件名如果满足了配置 `include` 且不匹配或者是配置了 `exclude` 且匹配，那么就直接返回这个组件的 `vnode`，否则的话走下一步缓存：

```js
const { cache, keys } = this
const key: ?string = vnode.key == null
  // same constructor may get registered as different local components
  // so cid alone is not enough (#3269)
  ? componentOptions.Ctor.cid + (componentOptions.tag ? `::${componentOptions.tag}` : '')
  : vnode.key
if (cache[key]) {
  vnode.componentInstance = cache[key].componentInstance
  // make current key freshest
  remove(keys, key)
  keys.push(key)
} else {
  cache[key] = vnode
  keys.push(key)
  // prune oldest entry
  if (this.max && keys.length > parseInt(this.max)) {
    pruneCacheEntry(cache, keys[0], keys, this._vnode)
  }
}
```

这部分逻辑很简单，如果命中缓存，则直接从缓存中拿 `vnode` 的组件实例，并且重新调整了 key 的顺序放在了最后一个；否则把 `vnode` 设置进缓存，最后还有一个逻辑，如果配置了 `max` 并且缓存的长度超过了 `this.max`，还要从缓存中删除第一个：

```js
function pruneCacheEntry (
  cache: VNodeCache,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const cached = cache[key]
  if (cached && (!current || cached.tag !== current.tag)) {
    cached.componentInstance.$destroy()
  }
  cache[key] = null 
  remove(keys, key)
}
```
除了从缓存中删除外，还要判断如果要删除的缓存并的组件 `tag` 不是当前渲染组件 `tag`，也执行删除缓存的组件实例的 `$destroy` 方法。

最后设置 `vnode.data.keepAlive = true` ，这个作用稍后我们介绍。

注意，`<keep-alive>` 组件也是为观测 `include` 和 `exclude` 的变化，对缓存做处理：

```js
watch: {
  include (val: string | RegExp | Array<string>) {
    pruneCache(this, name => matches(val, name))
  },
  exclude (val: string | RegExp | Array<string>) {
    pruneCache(this, name => !matches(val, name))
  }
}

function pruneCache (keepAliveInstance: any, filter: Function) {
  const { cache, keys, _vnode } = keepAliveInstance
  for (const key in cache) {
    const cachedNode: ?VNode = cache[key]
    if (cachedNode) {
      const name: ?string = getComponentName(cachedNode.componentOptions)
      if (name && !filter(name)) {
        pruneCacheEntry(cache, key, keys, _vnode)
      }
    }
  }
}
```
逻辑很简单，观测他们的变化执行 `pruneCache` 函数，其实就是对 `cache` 做遍历，发现缓存的节点名称和新的规则没有匹配上的时候，就把这个缓存节点从缓存中摘除。

## 组件渲染

到此为止，我们只了解了 `<keep-alive>` 的组件实现，但并不知道它包裹的子组件渲染和普通组件有什么不一样的地方。我们关注 2 个方面，首次渲染和缓存渲染。

同样为了更好地理解，我们也结合一个示例来分析：

```js
let A = {
  template: '<div class="a">' +
  '<p>A Comp</p>' +
  '</div>',
  name: 'A'
}

let B = {
  template: '<div class="b">' +
  '<p>B Comp</p>' +
  '</div>',
  name: 'B'
}

let vm = new Vue({
  el: '#app',
  template: '<div>' +
  '<keep-alive>' +
  '<component :is="currentComp">' +
  '</component>' +
  '</keep-alive>' +
  '<button @click="change">switch</button>' +
  '</div>',
  data: {
    currentComp: 'A'
  },
  methods: {
    change() {
      this.currentComp = this.currentComp === 'A' ? 'B' : 'A'
    }
  },
  components: {
    A,
    B
  }
})
```

### 首次渲染

我们知道 Vue 的渲染最后都会到 `patch` 过程，而组件的 `patch` 过程会执行 `createComponent` 方法，它的定义在 `src/core/vdom/patch.js` 中：

```js
function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
  let i = vnode.data
  if (isDef(i)) {
    const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
    if (isDef(i = i.hook) && isDef(i = i.init)) {
      i(vnode, false /* hydrating */)
    }
    // after calling the init hook, if the vnode is a child component
    // it should've created a child instance and mounted it. the child
    // component also has set the placeholder vnode's elm.
    // in that case we can just return the element and be done.
    if (isDef(vnode.componentInstance)) {
      initComponent(vnode, insertedVnodeQueue)
      insert(parentElm, vnode.elm, refElm)
      if (isTrue(isReactivated)) {
        reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
      }
      return true
    }
  }
}
```

`createComponent` 定义了 `isReactivated` 的变量，它是根据 `vnode.componentInstance` 以及 `vnode.data.keepAlive` 的判断，第一次渲染的时候，`vnode.componentInstance` 为 `undefined`，`vnode.data.keepAlive` 为 true，因为它的父组件 `<keep-alive>` 的 `render` 函数会先执行，那么该 `vnode` 缓存到内存中，并且设置 `vnode.data.keepAlive` 为 true，因此 `isReactivated` 为 `false`，那么走正常的 `init` 的钩子函数执行组件的 `mount`。当 `vnode` 已经执行完 `patch` 后，执行 `initComponent` 函数：

```js
function initComponent (vnode, insertedVnodeQueue) {
  if (isDef(vnode.data.pendingInsert)) {
    insertedVnodeQueue.push.apply(insertedVnodeQueue, vnode.data.pendingInsert)
    vnode.data.pendingInsert = null
  }
  vnode.elm = vnode.componentInstance.$el
  if (isPatchable(vnode)) {
    invokeCreateHooks(vnode, insertedVnodeQueue)
    setScope(vnode)
  } else {
    // empty component root.
    // skip all element-related modules except for ref (#3455)
    registerRef(vnode)
    // make sure to invoke the insert hook
    insertedVnodeQueue.push(vnode)
  }
}
```
这里会有 `vnode.elm` 缓存了 `vnode` 创建生成的 DOM 节点。所以对于首次渲染而言，除了在 `<keep-alive>` 中建立缓存，和普通组件渲染没什么区别。

所以对我们的例子，初始化渲染 `A` 组件以及第一次点击 `switch` 渲染 `B` 组件，都是首次渲染。

### 缓存渲染

当我们从 `B` 组件再次点击 `switch` 切换到 `A` 组件，就会命中缓存渲染。

我们之前分析过，当数据发送变化，在 `patch` 的过程中会执行 `patchVnode` 的逻辑，它会对比新旧 `vnode` 节点，甚至对比它们的子节点去做更新逻辑，但是对于组件 `vnode` 而言，是没有 `children` 的，那么对于 `<keep-alive>` 组件而言，如何更新它包裹的内容呢？

原来 `patchVnode` 在做各种 diff 之前，会先执行 `prepatch` 的钩子函数，它的定义在 `src/core/vdom/create-component` 中：

```js
const componentVNodeHooks = {
  prepatch (oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    const options = vnode.componentOptions
    const child = vnode.componentInstance = oldVnode.componentInstance
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode
      options.children // new children
    )
  },
  // ...
}
```

`prepatch` 核心逻辑就是执行 `updateChildComponent` 方法，它的定义在 `src/core/instance/lifecycle.js` 中：

```js
export function updateChildComponent (
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  const hasChildren = !!(
    renderChildren ||          
    vm.$options._renderChildren ||
    parentVnode.data.scopedSlots || 
    vm.$scopedSlots !== emptyObject 
  )

  // ...
  if (hasChildren) {
    vm.$slots = resolveSlots(renderChildren, parentVnode.context)
    vm.$forceUpdate()
  }
}
```

`updateChildComponent` 方法主要是去更新组件实例的一些属性，这里我们重点关注一下 `slot` 部分，由于 `<keep-alive>` 组件本质上支持了 `slot`，所以它执行 `prepatch` 的时候，需要对自己的 `children`，也就是这些 `slots` 做重新解析，并触发 `<keep-alive>` 组件实例 `$forceUpdate` 逻辑，也就是重新执行 `<keep-alive>` 的 `render` 方法，这个时候如果它包裹的第一个组件 `vnode` 命中缓存，则直接返回缓存中的 `vnode.componentInstance`，在我们的例子中就是缓存的 `A` 组件，接着又会执行 `patch` 过程，再次执行到 `createComponent` 方法，我们再回顾一下：

```js
function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
  let i = vnode.data
  if (isDef(i)) {
    const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
    if (isDef(i = i.hook) && isDef(i = i.init)) {
      i(vnode, false /* hydrating */)
    }
    // after calling the init hook, if the vnode is a child component
    // it should've created a child instance and mounted it. the child
    // component also has set the placeholder vnode's elm.
    // in that case we can just return the element and be done.
    if (isDef(vnode.componentInstance)) {
      initComponent(vnode, insertedVnodeQueue)
      insert(parentElm, vnode.elm, refElm)
      if (isTrue(isReactivated)) {
        reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
      }
      return true
    }
  }
}
```
这个时候 `isReactivated` 为 true，并且在执行 `init` 钩子函数的时候不会再执行组件的 `mount` 过程了，相关逻辑在 `src/core/vdom/create-component.js` 中：

```js
const componentVNodeHooks = {
  init (vnode: VNodeWithData, hydrating: boolean): ?boolean {
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      // kept-alive components, treat as a patch
      const mountedNode: any = vnode // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode)
    } else {
      const child = vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance
      )
      child.$mount(hydrating ? vnode.elm : undefined, hydrating)
    }
  },
  // ...
}
```

这也就是被 `<keep-alive>` 包裹的组件在有缓存的时候就不会在执行组件的 `created`、`mounted` 等钩子函数的原因了。回到 `createComponent` 方法，在 `isReactivated` 为 true 的情况下会执行 `reactivateComponent` 方法：

```js
function reactivateComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
  let i
  // hack for #4339: a reactivated component with inner transition
  // does not trigger because the inner node's created hooks are not called
  // again. It's not ideal to involve module-specific logic in here but
  // there doesn't seem to be a better way to do it.
  let innerNode = vnode
  while (innerNode.componentInstance) {
    innerNode = innerNode.componentInstance._vnode
    if (isDef(i = innerNode.data) && isDef(i = i.transition)) {
      for (i = 0; i < cbs.activate.length; ++i) {
        cbs.activate[i](emptyNode, innerNode)
      }
      insertedVnodeQueue.push(innerNode)
      break
    }
  }
  // unlike a newly created component,
  // a reactivated keep-alive component doesn't insert itself
  insert(parentElm, vnode.elm, refElm)
}
```
前面部分的逻辑是解决对 `reactived` 组件 `transition` 动画不触发的问题，可以先不关注，最后通过执行 `insert(parentElm, vnode.elm, refElm)` 就把缓存的 DOM 对象直接插入到目标元素中，这样就完成了在数据更新的情况下的渲染过程。

## 生命周期

之前我们提到，组件一旦被 `<keep-alive>` 缓存，那么再次渲染的时候就不会执行 `created`、`mounted` 等钩子函数，但是我们很多业务场景都是希望在我们被缓存的组件再次被渲染的时候做一些事情，好在 Vue 提供了 `activated` 钩子函数，它的执行时机是 `<keep-alive>` 包裹的组件渲染的时候，接下来我们从源码角度来分析一下它的实现原理。

在渲染的最后一步，会执行 `invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)` 函数执行 `vnode` 的 `insert` 钩子函数，它的定义在 `src/core/vdom/create-component.js` 中：

```js
const componentVNodeHooks = {
  insert (vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true
      callHook(componentInstance, 'mounted')
    }
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance)
      } else {
        activateChildComponent(componentInstance, true /* direct */)
      }
    }
  },
  // ...
}
```

这里判断如果是被 `<keep-alive>` 包裹的组件已经 `mounted`，那么则执行 `queueActivatedComponent(componentInstance)` ，否则执行 `activateChildComponent(componentInstance, true)`。我们先分析非 `mounted` 的情况，`activateChildComponent` 的定义在 `src/core/instance/lifecycle.js` 中：

```js
export function activateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false
    if (isInInactiveTree(vm)) {
      return
    }
  } else if (vm._directInactive) {
    return
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false
    for (let i = 0; i < vm.$children.length; i++) {
      activateChildComponent(vm.$children[i])
    }
    callHook(vm, 'activated')
  }
}
```

可以看到这里就是执行组件的 `acitvated` 钩子函数，并且递归去执行它的所有子组件的 `activated` 钩子函数。

那么再看 `queueActivatedComponent` 的逻辑，它定义在 `src/core/observer/scheduler.js` 中：

```js
export function queueActivatedComponent (vm: Component) {
  vm._inactive = false
  activatedChildren.push(vm)
}
```
这个逻辑很简单，把当前 `vm` 实例添加到 `activatedChildren` 数组中，等所有的渲染完毕，在 `nextTick`后会执行 `flushSchedulerQueue`，这个时候就会执行：

```js
function flushSchedulerQueue () {
  // ...
  const activatedQueue = activatedChildren.slice()
  callActivatedHooks(activatedQueue)
  // ...
} 

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true)  }
}
```
也就是遍历所有的 `activatedChildren`，执行 `activateChildComponent` 方法，通过队列调的方式就是把整个 `activated` 时机延后了。

有 `activated` 钩子函数，也就有对应的 `deactivated` 钩子函数，它是发生在 `vnode` 的 `destory` 钩子函数，定义在 `src/core/vdom/create-component.js` 中：

```js
const componentVNodeHooks = {
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

对于 `<keep-alive>` 包裹的组件而言，它会执行 `deactivateChildComponent(componentInstance, true)` 方法，定义在 `src/core/instance/lifecycle.js` 中：

```js
export function deactivateChildComponent (vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true
    if (isInInactiveTree(vm)) {
      return
    }
  }
  if (!vm._inactive) {
    vm._inactive = true
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i])
    }
    callHook(vm, 'deactivated')
  }
}
```

和 `activateChildComponent` 方法类似，就是执行组件的 `deacitvated` 钩子函数，并且递归去执行它的所有子组件的 `deactivated` 钩子函数。

## 总结

那么至此，`<keep-alive>` 的实现原理就介绍完了，通过分析我们知道了 `<keep-alive>` 组件是一个抽象组件，它的实现通过自定义 `render` 函数并且利用了插槽，并且知道了 `<keep-alive>` 缓存 `vnode`，了解组件包裹的子元素——也就是插槽是如何做更新的。且在 `patch` 过程中对于已缓存的组件不会执行 `mounted`，所以不会有一般的组件的生命周期函数但是又提供了 `activated` 和 `deactivated` 钩子函数。另外我们还知道了 `<keep-alive>` 的 `props` 除了 `include` 和 `exclude` 还有文档中没有提到的 `max`，它能控制我们缓存的个数。 