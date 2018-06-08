# transition

在我们平时的前端项目开发中，经常会遇到如下需求，一个 DOM 节点的插入和删除或者是显示和隐藏，我们不想让它特别生硬，通常会考虑加一些过渡效果。

Vue.js 除了实现了强大的数据驱动，组件化的能力，也给我们提供了一整套过渡的解决方案。它内置了 `<transition>` 组件，我们可以利用它配合一些 CSS3 样式很方便地实现过渡动画，也可以利用它配合 JavaScript 的钩子函数实现过渡动画，在下列情形中，可以给任何元素和组件添加 entering/leaving 过渡：

- 条件渲染 (使用 `v-if`)
- 条件展示 (使用 `v-show`)
- 动态组件
- 组件根节点

那么举一个最简单的实例，如下：

```js
let vm = new Vue({
  el: '#app',
  template: '<div id="demo">' +
  '<button v-on:click="show = !show">' +
  'Toggle' +
  '</button>' +
  '<transition :appear="true" name="fade">' +
  '<p v-if="show">hello</p>' +
  '</transition>' +
  '</div>',
  data() {
    return {
      show: true
    }
  }
})
```

```css
.fade-enter-active, .fade-leave-active {
  transition: opacity .5s;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}
```

当我们点击按钮切换显示状态的时候，被 `<transition>` 包裹的内容会有过渡动画。那么接下来我们从源码的角度来分析它的实现原理。

## 内置组件

`<transition>` 组件和 `<keep-alive>` 组件一样，都是 Vue 的内置组件，而 `<transition>` 的定义在 `src/platforms/web/runtime/component/transtion.js` 中，之所以在这里定义，是因为 `<transition>` 组件是 web 平台独有的，先来看一下它的实现：

```js
export default {
  name: 'transition',
  props: transitionProps,
  abstract: true,

  render (h: Function) {
    let children: any = this.$slots.default
    if (!children) {
      return
    }

    // filter out text nodes (possible whitespaces)
    children = children.filter((c: VNode) => c.tag || isAsyncPlaceholder(c))
    /* istanbul ignore if */
    if (!children.length) {
      return
    }

    // warn multiple elements
    if (process.env.NODE_ENV !== 'production' && children.length > 1) {
      warn(
        '<transition> can only be used on a single element. Use ' +
        '<transition-group> for lists.',
        this.$parent
      )
    }

    const mode: string = this.mode

    // warn invalid mode
    if (process.env.NODE_ENV !== 'production' &&
      mode && mode !== 'in-out' && mode !== 'out-in'
    ) {
      warn(
        'invalid <transition> mode: ' + mode,
        this.$parent
      )
    }

    const rawChild: VNode = children[0]

    // if this is a component root node and the component's
    // parent container node also has transition, skip.
    if (hasParentTransition(this.$vnode)) {
      return rawChild
    }

    // apply transition data to child
    // use getRealChild() to ignore abstract components e.g. keep-alive
    const child: ?VNode = getRealChild(rawChild)
    /* istanbul ignore if */
    if (!child) {
      return rawChild
    }

    if (this._leaving) {
      return placeholder(h, rawChild)
    }

    // ensure a key that is unique to the vnode type and to this transition
    // component instance. This key will be used to remove pending leaving nodes
    // during entering.
    const id: string = `__transition-${this._uid}-`
    child.key = child.key == null
      ? child.isComment
        ? id + 'comment'
        : id + child.tag
      : isPrimitive(child.key)
        ? (String(child.key).indexOf(id) === 0 ? child.key : id + child.key)
        : child.key

    const data: Object = (child.data || (child.data = {})).transition = extractTransitionData(this)
    const oldRawChild: VNode = this._vnode
    const oldChild: VNode = getRealChild(oldRawChild)

    // mark v-show
    // so that the transition module can hand over the control to the directive
    if (child.data.directives && child.data.directives.some(d => d.name === 'show')) {
      child.data.show = true
    }

    if (
      oldChild &&
      oldChild.data &&
      !isSameChild(child, oldChild) &&
      !isAsyncPlaceholder(oldChild) &&
      // #6687 component root is a comment node
      !(oldChild.componentInstance && oldChild.componentInstance._vnode.isComment)
    ) {
      // replace old child transition data with fresh one
      // important for dynamic transitions!
      const oldData: Object = oldChild.data.transition = extend({}, data)
      // handle transition mode
      if (mode === 'out-in') {
        // return placeholder node and queue update when leave finishes
        this._leaving = true
        mergeVNodeHook(oldData, 'afterLeave', () => {
          this._leaving = false
          this.$forceUpdate()
        })
        return placeholder(h, rawChild)
      } else if (mode === 'in-out') {
        if (isAsyncPlaceholder(child)) {
          return oldRawChild
        }
        let delayedLeave
        const performLeave = () => { delayedLeave() }
        mergeVNodeHook(data, 'afterEnter', performLeave)
        mergeVNodeHook(data, 'enterCancelled', performLeave)
        mergeVNodeHook(oldData, 'delayLeave', leave => { delayedLeave = leave })
      }
    }

    return rawChild
  }
}
```

`<transition>` 组件和 `<keep-alive>` 组件有几点实现类似，同样是抽象组件，同样直接实现 `render` 函数，同样利用了默认插槽。`<transition>` 组件非常灵活，支持的 `props` 非常多：

```js
export const transitionProps = {
  name: String,
  appear: Boolean,
  css: Boolean,
  mode: String,
  type: String,
  enterClass: String,
  leaveClass: String,
  enterToClass: String,
  leaveToClass: String,
  enterActiveClass: String,
  leaveActiveClass: String,
  appearClass: String,
  appearActiveClass: String,
  appearToClass: String,
  duration: [Number, String, Object]
}
```

这些配置我们稍后会分析它们的作用，`<transition>` 组件另一个重要的就是 `render` 函数的实现，`render` 函数主要作用就是渲染生成 `vnode`，下面来看一下这部分的逻辑。

- 处理 `children`

```js
let children: any = this.$slots.default
if (!children) {
  return
}

// filter out text nodes (possible whitespaces)
children = children.filter((c: VNode) => c.tag || isAsyncPlaceholder(c))
/* istanbul ignore if */
if (!children.length) {
  return
}

// warn multiple elements
if (process.env.NODE_ENV !== 'production' && children.length > 1) {
  warn(
    '<transition> can only be used on a single element. Use ' +
    '<transition-group> for lists.',
    this.$parent
  )
}
```

先从默认插槽中获取 `<transition>` 包裹的子节点，并且判断了子节点的长度，如果长度为 0，则直接返回，否则判断长度如果大于 1，也会在开发环境报警告，因为 `<transition>` 组件是只能包裹一个子节点的。

- 处理 `model`

```js
const mode: string = this.mode

// warn invalid mode
if (process.env.NODE_ENV !== 'production' &&
  mode && mode !== 'in-out' && mode !== 'out-in'
) {
  warn(
    'invalid <transition> mode: ' + mode,
    this.$parent
  )
}
```

过渡组件的对 `mode` 的支持只有 2 种，`in-out` 或者是 `out-in`。

- 获取 `rawChild` & `child`

```js
const rawChild: VNode = children[0]

// if this is a component root node and the component's
// parent container node also has transition, skip.
if (hasParentTransition(this.$vnode)) {
  return rawChild
}

// apply transition data to child
// use getRealChild() to ignore abstract components e.g. keep-alive
const child: ?VNode = getRealChild(rawChild)
/* istanbul ignore if */
if (!child) {
  return rawChild
}

```

`rawChild` 就是第一个子节点 `vnode`，接着判断当前 `<transition>` 如果是组件根节点并且外面包裹该组件的容器也是 `<transition>` 的时候要跳过。来看一下 `hasParentTransition` 的实现：

```js
function hasParentTransition (vnode: VNode): ?boolean {
  while ((vnode = vnode.parent)) {
    if (vnode.data.transition) {
      return true
    }
  }
}
```
因为传入的是 `this.$vnode`，也就是 `<transition>` 组件的 占位 `vnode`，只有当它同时作为根 `vnode`，也就是 `vm._vnode` 的时候，它的 `parent` 才不会为空，并且判断 `parent` 也是 `<transition>` 组件，才返回 true，`vnode.data.transition` 我们稍后会介绍。

`getRealChild` 的目的是获取组件的非抽象子节点，因为 `<transition>` 很可能会包裹一个 `keep-alive`，它的实现如下：

```js
// in case the child is also an abstract component, e.g. <keep-alive>
// we want to recursively retrieve the real component to be rendered
function getRealChild (vnode: ?VNode): ?VNode {
  const compOptions: ?VNodeComponentOptions = vnode && vnode.componentOptions
  if (compOptions && compOptions.Ctor.options.abstract) {
    return getRealChild(getFirstComponentChild(compOptions.children))
  } else {
    return vnode
  }
}
```
会递归找到第一个非抽象组件的 `vnode` 并返回，在我们这个 case 下，`rawChild === child`。

- 处理 `id` & `data`

```js
// ensure a key that is unique to the vnode type and to this transition
// component instance. This key will be used to remove pending leaving nodes
// during entering.
const id: string = `__transition-${this._uid}-`
child.key = child.key == null
  ? child.isComment
    ? id + 'comment'
    : id + child.tag
  : isPrimitive(child.key)
    ? (String(child.key).indexOf(id) === 0 ? child.key : id + child.key)
    : child.key

const data: Object = (child.data || (child.data = {})).transition = extractTransitionData(this)
const oldRawChild: VNode = this._vnode
const oldChild: VNode = getRealChild(oldRawChild)

// mark v-show
// so that the transition module can hand over the control to the directive
if (child.data.directives && child.data.directives.some(d => d.name === 'show')) {
  child.data.show = true
}
```

先根据 `key` 等一系列条件获取 `id`，接着从当前通过 `extractTransitionData` 组件实例上提取出过渡所需要的数据：

```js
export function extractTransitionData (comp: Component): Object {
  const data = {}
  const options: ComponentOptions = comp.$options
  // props
  for (const key in options.propsData) {
    data[key] = comp[key]
  }
  // events.
  // extract listeners and pass them directly to the transition methods
  const listeners: ?Object = options._parentListeners
  for (const key in listeners) {
    data[camelize(key)] = listeners[key]
  }
  return data
}
```
首先是遍历 `props` 赋值到 `data` 中，接着是遍历所有父组件的事件也把事件回调赋值到 `data` 中。

这样 `child.data.transition` 中就包含了过渡所需的一些数据，这些稍后都会用到，对于 `child` 如果使用了 `v-show` 指令，也会把 `child.data.show` 设置为 true，在我们的例子中，得到的 `child.data` 如下：

```js
{
  transition: {
    appear: true,
    name: 'fade'
  }
}
```

至于 `oldRawChild` 和 `oldChild` 是与后面的判断逻辑相关，这些我们这里先不介绍。

## transition module

刚刚我们介绍完 `<transition>` 组件的实现，它的 `render` 阶段只获取了一些数据，并且返回了渲染的 `vnode`，并没有任何和动画相关，而动画相关的逻辑全部在 `src/platforms/web/modules/transition.js` 中：

```js
function _enter (_: any, vnode: VNodeWithData) {
  if (vnode.data.show !== true) {
    enter(vnode)
  }
}

export default inBrowser ? {
  create: _enter,
  activate: _enter,
  remove (vnode: VNode, rm: Function) {
    /* istanbul ignore else */
    if (vnode.data.show !== true) {
      leave(vnode, rm)
    } else {
      rm()
    }
  }
} : {}
```

在之前介绍事件实现的章节中我们提到过在 `vnode patch` 的过程中，会执行很多钩子函数，那么对于过渡的实现，它只接收了 `create` 和 `activate` 2 个钩子函数，我们知道 `create` 钩子函数只有当节点的创建过程才会执行，而 `remove` 会在节点销毁的时候执行，这也就印证了 `<transition>` 必须要满足 `v-if` 、动态组件、组件根节点条件之一了，对于 `v-show` 在它的指令的钩子函数中也会执行相关逻辑，这块儿先不介绍。

过渡动画提供了 2 个时机，一个是 `create` 和 `activate` 的时候提供了 entering 进入动画，一个是 `remove` 的时候提供了 leaving 离开动画，那么接下来我们就来分别去分析这两个过程。

## entering

整个 entering 过程的实现是 `enter` 函数：

```js
export function enter (vnode: VNodeWithData, toggleDisplay: ?() => void) {
  const el: any = vnode.elm

  // call leave callback now
  if (isDef(el._leaveCb)) {
    el._leaveCb.cancelled = true
    el._leaveCb()
  }

  const data = resolveTransition(vnode.data.transition)
  if (isUndef(data)) {
    return
  }

  /* istanbul ignore if */
  if (isDef(el._enterCb) || el.nodeType !== 1) {
    return
  }

  const {
    css,
    type,
    enterClass,
    enterToClass,
    enterActiveClass,
    appearClass,
    appearToClass,
    appearActiveClass,
    beforeEnter,
    enter,
    afterEnter,
    enterCancelled,
    beforeAppear,
    appear,
    afterAppear,
    appearCancelled,
    duration
  } = data

  // activeInstance will always be the <transition> component managing this
  // transition. One edge case to check is when the <transition> is placed
  // as the root node of a child component. In that case we need to check
  // <transition>'s parent for appear check.
  let context = activeInstance
  let transitionNode = activeInstance.$vnode
  while (transitionNode && transitionNode.parent) {
    transitionNode = transitionNode.parent
    context = transitionNode.context
  }

  const isAppear = !context._isMounted || !vnode.isRootInsert

  if (isAppear && !appear && appear !== '') {
    return
  }

  const startClass = isAppear && appearClass
    ? appearClass
    : enterClass
  const activeClass = isAppear && appearActiveClass
    ? appearActiveClass
    : enterActiveClass
  const toClass = isAppear && appearToClass
    ? appearToClass
    : enterToClass

  const beforeEnterHook = isAppear
    ? (beforeAppear || beforeEnter)
    : beforeEnter
  const enterHook = isAppear
    ? (typeof appear === 'function' ? appear : enter)
    : enter
  const afterEnterHook = isAppear
    ? (afterAppear || afterEnter)
    : afterEnter
  const enterCancelledHook = isAppear
    ? (appearCancelled || enterCancelled)
    : enterCancelled

  const explicitEnterDuration: any = toNumber(
    isObject(duration)
      ? duration.enter
      : duration
  )

  if (process.env.NODE_ENV !== 'production' && explicitEnterDuration != null) {
    checkDuration(explicitEnterDuration, 'enter', vnode)
  }

  const expectsCSS = css !== false && !isIE9
  const userWantsControl = getHookArgumentsLength(enterHook)

  const cb = el._enterCb = once(() => {
    if (expectsCSS) {
      removeTransitionClass(el, toClass)
      removeTransitionClass(el, activeClass)
    }
    if (cb.cancelled) {
      if (expectsCSS) {
        removeTransitionClass(el, startClass)
      }
      enterCancelledHook && enterCancelledHook(el)
    } else {
      afterEnterHook && afterEnterHook(el)
    }
    el._enterCb = null
  })

  if (!vnode.data.show) {
    // remove pending leave element on enter by injecting an insert hook
    mergeVNodeHook(vnode, 'insert', () => {
      const parent = el.parentNode
      const pendingNode = parent && parent._pending && parent._pending[vnode.key]
      if (pendingNode &&
        pendingNode.tag === vnode.tag &&
        pendingNode.elm._leaveCb
      ) {
        pendingNode.elm._leaveCb()
      }
      enterHook && enterHook(el, cb)
    })
  }

  // start enter transition
  beforeEnterHook && beforeEnterHook(el)
  if (expectsCSS) {
    addTransitionClass(el, startClass)
    addTransitionClass(el, activeClass)
    nextFrame(() => {
      removeTransitionClass(el, startClass)
      if (!cb.cancelled) {
        addTransitionClass(el, toClass)
        if (!userWantsControl) {
          if (isValidDuration(explicitEnterDuration)) {
            setTimeout(cb, explicitEnterDuration)
          } else {
            whenTransitionEnds(el, type, cb)
          }
        }
      }
    })
  }

  if (vnode.data.show) {
    toggleDisplay && toggleDisplay()
    enterHook && enterHook(el, cb)
  }

  if (!expectsCSS && !userWantsControl) {
    cb()
  }
}
```

`enter` 的代码很长，我们先分析其中的核心逻辑。

- 解析过渡数据

```js
const data = resolveTransition(vnode.data.transition)
  if (isUndef(data)) {
    return
}

const {
  css,
  type,
  enterClass,
  enterToClass,
  enterActiveClass,
  appearClass,
  appearToClass,
  appearActiveClass,
  beforeEnter,
  enter,
  afterEnter,
  enterCancelled,
  beforeAppear,
  appear,
  afterAppear,
  appearCancelled,
  duration
} = data
```

从 `vnode.data.transition` 中解析出过渡相关的一些数据，`resolveTransition` 的定义在 `src/platforms/web/transition-util.js` 中：

```js
export function resolveTransition (def?: string | Object): ?Object {
  if (!def) {
    return
  }
  /* istanbul ignore else */
  if (typeof def === 'object') {
    const res = {}
    if (def.css !== false) {
      extend(res, autoCssTransition(def.name || 'v'))
    }
    extend(res, def)
    return res
  } else if (typeof def === 'string') {
    return autoCssTransition(def)
  }
}

const autoCssTransition: (name: string) => Object = cached(name => {
  return {
    enterClass: `${name}-enter`,
    enterToClass: `${name}-enter-to`,
    enterActiveClass: `${name}-enter-active`,
    leaveClass: `${name}-leave`,
    leaveToClass: `${name}-leave-to`,
    leaveActiveClass: `${name}-leave-active`
  }
})
```
`resolveTransition` 会通过 `autoCssTransition` 处理 `name` 属性，生成一个用来描述各个阶段的 `Class` 名称的对象，扩展到 `def` 中并返回给 `data`，这样我们就可以从 `data` 中获取到过渡相关的所有数据。

- 处理边界情况

```js
// activeInstance will always be the <transition> component managing this
// transition. One edge case to check is when the <transition> is placed
// as the root node of a child component. In that case we need to check
// <transition>'s parent for appear check.
let context = activeInstance
let transitionNode = activeInstance.$vnode
while (transitionNode && transitionNode.parent) {
  transitionNode = transitionNode.parent
  context = transitionNode.context
}

const isAppear = !context._isMounted || !vnode.isRootInsert

if (isAppear && !appear && appear !== '') {
  return
}
```

这是为了处理当 `<transition>` 作为子组件的根节点，那么我们需要检查它的父组件作为 `appear` 的检查。`isAppear` 表示当前上下文实例还没有 `mounted`，第一次出现的时机。如果是第一次并且 `<transition>` 组件没有配置 `appear` 的话，直接返回。

- 定义过渡类名、钩子函数和其它配置

```js
const startClass = isAppear && appearClass
    ? appearClass
    : enterClass
const activeClass = isAppear && appearActiveClass
  ? appearActiveClass
  : enterActiveClass
const toClass = isAppear && appearToClass
  ? appearToClass
  : enterToClass

const beforeEnterHook = isAppear
  ? (beforeAppear || beforeEnter)
  : beforeEnter
const enterHook = isAppear
  ? (typeof appear === 'function' ? appear : enter)
  : enter
const afterEnterHook = isAppear
  ? (afterAppear || afterEnter)
  : afterEnter
const enterCancelledHook = isAppear
  ? (appearCancelled || enterCancelled)
  : enterCancelled

const explicitEnterDuration: any = toNumber(
  isObject(duration)
    ? duration.enter
    : duration
)

if (process.env.NODE_ENV !== 'production' && explicitEnterDuration != null) {
  checkDuration(explicitEnterDuration, 'enter', vnode)
}

const expectsCSS = css !== false && !isIE9
const userWantsControl = getHookArgumentsLength(enterHook)

const cb = el._enterCb = once(() => {
  if (expectsCSS) {
    removeTransitionClass(el, toClass)
    removeTransitionClass(el, activeClass)
  }
  if (cb.cancelled) {
    if (expectsCSS) {
      removeTransitionClass(el, startClass)
    }
    enterCancelledHook && enterCancelledHook(el)
  } else {
    afterEnterHook && afterEnterHook(el)
  }
  el._enterCb = null
})
```

对于过渡类名方面，`startClass` 定义进入过渡的开始状态，在元素被插入时生效，在下一个帧移除；`activeClass` 定义过渡的状态，在元素整个过渡过程中作用，在元素被插入时生效，在 `transition/animation` 完成之后移除；`toClass` 定义进入过渡的结束状态，在元素被插入一帧后生效 (与此同时 `startClass` 被删除)，在 `<transition>/animation` 完成之后移除。

对于过渡钩子函数方面，`beforeEnterHook` 是过渡开始前执行的钩子函数，`enterHook` 是在元素插入后或者是 `v-show` 显示切换后执行的钩子函数。`afterEnterHook` 是在过渡动画执行完后的钩子函数。

`explicitEnterDuration` 表示 enter 动画执行的时间。

`expectsCSS` 表示过渡动画是受 CSS 的影响。

`cb` 定义的是过渡完成执行的回调函数。

- 合并 `insert` 钩子函数

```js
if (!vnode.data.show) {
  // remove pending leave element on enter by injecting an insert hook
  mergeVNodeHook(vnode, 'insert', () => {
    const parent = el.parentNode
    const pendingNode = parent && parent._pending && parent._pending[vnode.key]
    if (pendingNode &&
      pendingNode.tag === vnode.tag &&
      pendingNode.elm._leaveCb
    ) {
      pendingNode.elm._leaveCb()
    }
    enterHook && enterHook(el, cb)
  })
}
```

`mergeVNodeHook` 的定义在 `src/core/vdom/helpers/merge-hook.js` 中：

```js
export function mergeVNodeHook (def: Object, hookKey: string, hook: Function) {
  if (def instanceof VNode) {
    def = def.data.hook || (def.data.hook = {})
  }
  let invoker
  const oldHook = def[hookKey]

  function wrappedHook () {
    hook.apply(this, arguments)
    // important: remove merged hook to ensure it's called only once
    // and prevent memory leak
    remove(invoker.fns, wrappedHook)
  }

  if (isUndef(oldHook)) {
    // no existing hook
    invoker = createFnInvoker([wrappedHook])
  } else {
    /* istanbul ignore if */
    if (isDef(oldHook.fns) && isTrue(oldHook.merged)) {
      // already a merged invoker
      invoker = oldHook
      invoker.fns.push(wrappedHook)
    } else {
      // existing plain hook
      invoker = createFnInvoker([oldHook, wrappedHook])
    }
  }

  invoker.merged = true
  def[hookKey] = invoker
}
```
`mergeVNodeHook` 的逻辑很简单，就是把 `hook` 函数合并到 `def.data.hook[hookey]` 中，生成新的 `invoker`，`createFnInvoker` 方法我们在分析事件章节的时候已经介绍过了。

我们之前知道组件的 `vnode` 原本定义了 `init`、`prepatch`、`insert`、`destroy` 四个钩子函数，而 `mergeVNodeHook` 函数就是把一些新的钩子函数合并进来，例如在 `<transition>` 过程中合并的 `insert` 钩子函数，就会合并到组件 `vnode` 的 `insert` 钩子函数中，这样当组件插入后，就会执行我们定义的 `enterHook` 了。

- 开始执行过渡动画

```js
// start enter transition
beforeEnterHook && beforeEnterHook(el)
if (expectsCSS) {
  addTransitionClass(el, startClass)
  addTransitionClass(el, activeClass)
  nextFrame(() => {
    removeTransitionClass(el, startClass)
    if (!cb.cancelled) {
      addTransitionClass(el, toClass)
      if (!userWantsControl) {
        if (isValidDuration(explicitEnterDuration)) {
          setTimeout(cb, explicitEnterDuration)
        } else {
          whenTransitionEnds(el, type, cb)
        }
      }
    }
  })
}
```

首先执行 `beforeEnterHook` 钩子函数，把当前元素的 DOM 节点 `el` 传入，然后判断 `expectsCSS`，如果为 true 则表明希望用 CSS 来控制动画，那么会执行 ` addTransitionClass(el, startClass)` 和 ` addTransitionClass(el, activeClass)`，它的定义在 `src/platforms/runtime/transition-util.js` 中：

```js
export function addTransitionClass (el: any, cls: string) {
  const transitionClasses = el._transitionClasses || (el._transitionClasses = [])
  if (transitionClasses.indexOf(cls) < 0) {
    transitionClasses.push(cls)
    addClass(el, cls)
  }
}
```

其实非常简单，就是给当前 DOM 元素 `el` 添加样式 `cls`，所以这里添加了 `startClass` 和 `activeClass`，在我们的例子中就是给 `p` 标签添加了 `fade-enter` 和 `fade-enter-active` 2 个样式。

接下来执行了 `nextFrame`：

```js
const raf = inBrowser
  ? window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : setTimeout
  : fn => fn()

export function nextFrame (fn: Function) {
  raf(() => {
    raf(fn)
  })
}
```

它就是一个简单的 `requestAnimationFrame` 的实现，它的参数 fn 会在下一帧执行，因此下一帧执行了 `removeTransitionClass(el, startClass)`：

```js
export function removeTransitionClass (el: any, cls: string) {
  if (el._transitionClasses) {
    remove(el._transitionClasses, cls)
  }
  removeClass(el, cls)
}
```

把 `startClass` 移除，在我们的等例子中就是移除 `fade-enter` 样式。然后判断此时过渡没有被取消，则执行 `addTransitionClass(el, toClass)` 添加 `toClass`，在我们的例子中就是添加了 `fade-enter-to`。然后判断 `!userWantsControl`，也就是用户不通过 `enterHook` 钩子函数控制动画，这时候如果用户指定了 `explicitEnterDuration`，则延时这个时间执行 `cb`，否则通过 `whenTransitionEnds(el, type, cb)` 决定执行 `cb` 的时机：

```js
export function whenTransitionEnds (
  el: Element,
  expectedType: ?string,
  cb: Function
) {
  const { type, timeout, propCount } = getTransitionInfo(el, expectedType)
  if (!type) return cb()
  const event: string = type === <transition> ? transitionEndEvent : animationEndEvent
  let ended = 0
  const end = () => {
    el.removeEventListener(event, onEnd)
    cb()
  }
  const onEnd = e => {
    if (e.target === el) {
      if (++ended >= propCount) {
        end()
      }
    }
  }
  setTimeout(() => {
    if (ended < propCount) {
      end()
    }
  }, timeout + 1)
  el.addEventListener(event, onEnd)
}
```
`whenTransitionEnds` 的逻辑具体不深讲了，本质上就利用了过渡动画的结束事件来决定 `cb` 函数的执行。

最后再回到 `cb` 函数：

```js
const cb = el._enterCb = once(() => {
  if (expectsCSS) {
    removeTransitionClass(el, toClass)
    removeTransitionClass(el, activeClass)
  }
  if (cb.cancelled) {
    if (expectsCSS) {
      removeTransitionClass(el, startClass)
    }
    enterCancelledHook && enterCancelledHook(el)
  } else {
    afterEnterHook && afterEnterHook(el)
  }
  el._enterCb = null
})
```

其实很简单，执行了 `removeTransitionClass(el, toClass)` 和 `removeTransitionClass(el, activeClass)` 把 `toClass` 和 `activeClass` 移除，然后判断如果有没有取消，如果取消则移除 `startClass` 并执行 `enterCancelledHook`，否则执行 `afterEnterHook(el)`。

那么到这里，`entering` 的过程就介绍完了。
 
## leaving

与 `entering` 相对的就是 `leaving` 阶段了，`entering` 主要发生在组件插入后，而 `leaving` 主要发生在组件销毁前。

```js
export function leave (vnode: VNodeWithData, rm: Function) {
  const el: any = vnode.elm

  // call enter callback now
  if (isDef(el._enterCb)) {
    el._enterCb.cancelled = true
    el._enterCb()
  }

  const data = resolveTransition(vnode.data.transition)
  if (isUndef(data) || el.nodeType !== 1) {
    return rm()
  }

  /* istanbul ignore if */
  if (isDef(el._leaveCb)) {
    return
  }

  const {
    css,
    type,
    leaveClass,
    leaveToClass,
    leaveActiveClass,
    beforeLeave,
    leave,
    afterLeave,
    leaveCancelled,
    delayLeave,
    duration
  } = data

  const expectsCSS = css !== false && !isIE9
  const userWantsControl = getHookArgumentsLength(leave)

  const explicitLeaveDuration: any = toNumber(
    isObject(duration)
      ? duration.leave
      : duration
  )

  if (process.env.NODE_ENV !== 'production' && isDef(explicitLeaveDuration)) {
    checkDuration(explicitLeaveDuration, 'leave', vnode)
  }

  const cb = el._leaveCb = once(() => {
    if (el.parentNode && el.parentNode._pending) {
      el.parentNode._pending[vnode.key] = null
    }
    if (expectsCSS) {
      removeTransitionClass(el, leaveToClass)
      removeTransitionClass(el, leaveActiveClass)
    }
    if (cb.cancelled) {
      if (expectsCSS) {
        removeTransitionClass(el, leaveClass)
      }
      leaveCancelled && leaveCancelled(el)
    } else {
      rm()
      afterLeave && afterLeave(el)
    }
    el._leaveCb = null
  })

  if (delayLeave) {
    delayLeave(performLeave)
  } else {
    performLeave()
  }

  function performLeave () {
    // the delayed leave may have already been cancelled
    if (cb.cancelled) {
      return
    }
    // record leaving element
    if (!vnode.data.show) {
      (el.parentNode._pending || (el.parentNode._pending = {}))[(vnode.key: any)] = vnode
    }
    beforeLeave && beforeLeave(el)
    if (expectsCSS) {
      addTransitionClass(el, leaveClass)
      addTransitionClass(el, leaveActiveClass)
      nextFrame(() => {
        removeTransitionClass(el, leaveClass)
        if (!cb.cancelled) {
          addTransitionClass(el, leaveToClass)
          if (!userWantsControl) {
            if (isValidDuration(explicitLeaveDuration)) {
              setTimeout(cb, explicitLeaveDuration)
            } else {
              whenTransitionEnds(el, type, cb)
            }
          }
        }
      })
    }
    leave && leave(el, cb)
    if (!expectsCSS && !userWantsControl) {
      cb()
    }
  }
}
```

纵观 `leave` 的实现，和 `enter` 的实现几乎是一个镜像过程，不同的是从 `data` 中解析出来的是 `leave` 相关的样式类名和钩子函数。还有一点不同是可以配置 `delayLeave`，它是一个函数，可以延时执行 `leave` 的相关过渡动画，在 `leave` 动画执行完后，它会执行 `rm` 函数把节点从 DOM 中真正做移除。

## 总结

那么到此为止基本的 `<transition>` 过渡的实现分析完毕了，总结起来，Vue 的过渡实现分为以下几个步骤：

1. 自动嗅探目标元素是否应用了 CSS 过渡或动画，如果是，在恰当的时机添加/删除 CSS 类名。

2. 如果过渡组件提供了 JavaScript 钩子函数，这些钩子函数将在恰当的时机被调用。

3. 如果没有找到 JavaScript 钩子并且也没有检测到 CSS 过渡/动画，DOM 操作 (插入/删除) 在下一帧中立即执行。

所以真正执行动画的是我们写的 CSS 或者是 JavaScript 钩子函数，而 Vue 的 `<transition>` 只是帮我们很好地管理了这些 CSS 的添加/删除，以及钩子函数的执行时机。


 











