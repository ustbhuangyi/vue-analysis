# transition-group

前一节我们介绍了 `<transiiton>` 组件的实现原理，它只能针对单一元素实现过渡效果。我们做前端开发经常会遇到列表的需求，我们对列表元素进行添加和删除，有时候也希望有过渡效果，Vue.js 提供了 `<transition-group>` 组件，很好地帮助我们实现了列表的过渡效果。那么接下来我们就来分析一下它的实现原理。

为了更直观，我们也是通过一个示例来说明：

```js
let vm = new Vue({
  el: '#app',
  template: '<div id="list-complete-demo" class="demo">' +
  '<button v-on:click="add">Add</button>' +
  '<button v-on:click="remove">Remove</button>' +
  '<transition-group name="list-complete" tag="p">' +
  '<span v-for="item in items" v-bind:key="item" class="list-complete-item">' +
  '{{ item }}' +
  '</span>' +
  '</transition-group>' +
  '</div>',
  data: {
    items: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    nextNum: 10
  },
  methods: {
    randomIndex: function () {
      return Math.floor(Math.random() * this.items.length)
    },
    add: function () {
      this.items.splice(this.randomIndex(), 0, this.nextNum++)
    },
    remove: function () {
      this.items.splice(this.randomIndex(), 1)
    }
  }
})
```

```css
 .list-complete-item {
  display: inline-block;
  margin-right: 10px;
}
.list-complete-move {
  transition: all 1s;
}
.list-complete-enter, .list-complete-leave-to {
  opacity: 0;
  transform: translateY(30px);
}
.list-complete-enter-active {
  transition: all 1s;
}
.list-complete-leave-active {
  transition: all 1s;
  position: absolute;
}
```

这个示例初始会展现 1-9 十个数字，当我们点击 `Add` 按钮时，会生成 `nextNum` 并随机在当前数列表中插入；当我们点击 `Remove` 按钮时，会随机删除掉一个数。我们会发现在数添加删除的过程中在列表中会有过渡动画，这就是 `<transition-group>` 组件配合我们定义的 CSS 产生的效果。

我们首先还是来分析 `<transtion-group>` 组件的实现，它的定义在 `src/platforms/web/runtime/components/transitions.js` 中：

```js
const props = extend({
  tag: String,
  moveClass: String
}, transitionProps)

delete props.mode

export default {
  props,

  beforeMount () {
    const update = this._update
    this._update = (vnode, hydrating) => {
      // force removing pass
      this.__patch__(
        this._vnode,
        this.kept,
        false, // hydrating
        true // removeOnly (!important, avoids unnecessary moves)
      )
      this._vnode = this.kept
      update.call(this, vnode, hydrating)
    }
  },

  render (h: Function) {
    const tag: string = this.tag || this.$vnode.data.tag || 'span'
    const map: Object = Object.create(null)
    const prevChildren: Array<VNode> = this.prevChildren = this.children
    const rawChildren: Array<VNode> = this.$slots.default || []
    const children: Array<VNode> = this.children = []
    const transitionData: Object = extractTransitionData(this)

    for (let i = 0; i < rawChildren.length; i++) {
      const c: VNode = rawChildren[i]
      if (c.tag) {
        if (c.key != null && String(c.key).indexOf('__vlist') !== 0) {
          children.push(c)
          map[c.key] = c
          ;(c.data || (c.data = {})).transition = transitionData
        } else if (process.env.NODE_ENV !== 'production') {
          const opts: ?VNodeComponentOptions = c.componentOptions
          const name: string = opts ? (opts.Ctor.options.name || opts.tag || '') : c.tag
          warn(`<transition-group> children must be keyed: <${name}>`)
        }
      }
    }

    if (prevChildren) {
      const kept: Array<VNode> = []
      const removed: Array<VNode> = []
      for (let i = 0; i < prevChildren.length; i++) {
        const c: VNode = prevChildren[i]
        c.data.transition = transitionData
        c.data.pos = c.elm.getBoundingClientRect()
        if (map[c.key]) {
          kept.push(c)
        } else {
          removed.push(c)
        }
      }
      this.kept = h(tag, null, kept)
      this.removed = removed
    }

    return h(tag, null, children)
  },

  updated () {
    const children: Array<VNode> = this.prevChildren
    const moveClass: string = this.moveClass || ((this.name || 'v') + '-move')
    if (!children.length || !this.hasMove(children[0].elm, moveClass)) {
      return
    }

    // we divide the work into three loops to avoid mixing DOM reads and writes
    // in each iteration - which helps prevent layout thrashing.
    children.forEach(callPendingCbs)
    children.forEach(recordPosition)
    children.forEach(applyTranslation)

    // force reflow to put everything in position
    // assign to this to avoid being removed in tree-shaking
    // $flow-disable-line
    this._reflow = document.body.offsetHeight

    children.forEach((c: VNode) => {
      if (c.data.moved) {
        var el: any = c.elm
        var s: any = el.style
        addTransitionClass(el, moveClass)
        s.transform = s.WebkitTransform = s.transitionDuration = ''
        el.addEventListener(transitionEndEvent, el._moveCb = function cb (e) {
          if (!e || /transform$/.test(e.propertyName)) {
            el.removeEventListener(transitionEndEvent, cb)
            el._moveCb = null
            removeTransitionClass(el, moveClass)
          }
        })
      }
    })
  },

  methods: {
    hasMove (el: any, moveClass: string): boolean {
      /* istanbul ignore if */
      if (!hasTransition) {
        return false
      }
      /* istanbul ignore if */
      if (this._hasMove) {
        return this._hasMove
      }
      // Detect whether an element with the move class applied has
      // CSS transitions. Since the element may be inside an entering
      // transition at this very moment, we make a clone of it and remove
      // all other transition classes applied to ensure only the move class
      // is applied.
      const clone: HTMLElement = el.cloneNode()
      if (el._transitionClasses) {
        el._transitionClasses.forEach((cls: string) => { removeClass(clone, cls) })
      }
      addClass(clone, moveClass)
      clone.style.display = 'none'
      this.$el.appendChild(clone)
      const info: Object = getTransitionInfo(clone)
      this.$el.removeChild(clone)
      return (this._hasMove = info.hasTransform)
    }
  }
}
```

## render 函数

`<transition-group>` 组件也是由 `render` 函数渲染生成 `vnode`，接下来我们先分析 `render` 的实现。

- 定义一些变量
 
```js
const tag: string = this.tag || this.$vnode.data.tag || 'span'
const map: Object = Object.create(null)
const prevChildren: Array<VNode> = this.prevChildren = this.children
const rawChildren: Array<VNode> = this.$slots.default || []
const children: Array<VNode> = this.children = []
const transitionData: Object = extractTransitionData(this)
```
不同于 `<transition>` 组件，`<transition-group>` 组件非抽象组件，它会渲染成一个真实元素，默认 `tag` 是 `span`。 `prevChildren` 用来存储上一次的子节点；`children` 用来存储当前的子节点；`rawChildren` 表示 `<transtition-group>` 包裹的原始子节点；`transtionData` 是从 `<transtition-group>` 组件上提取出来的一些渲染数据，这点和 `<transition>` 组件的实现是一样的。

- 遍历 `rawChidren`，初始化 `children`

```js
for (let i = 0; i < rawChildren.length; i++) {
  const c: VNode = rawChildren[i]
  if (c.tag) {
    if (c.key != null && String(c.key).indexOf('__vlist') !== 0) {
      children.push(c)
      map[c.key] = c
      ;(c.data || (c.data = {})).transition = transitionData
    } else if (process.env.NODE_ENV !== 'production') {
      const opts: ?VNodeComponentOptions = c.componentOptions
      const name: string = opts ? (opts.Ctor.options.name || opts.tag || '') : c.tag
      warn(`<transition-group> children must be keyed: <${name}>`)
    }
  }
}
```

其实就是对 `rawChildren` 遍历，拿到每个 `vnode`，然后会判断每个 `vnode` 是否设置了 `key`，这个是 `<transition-group>` 对列表元素的要求。然后把 `vnode` 添加到 `children` 中，然后把刚刚提取的过渡数据 `transitionData` 添加的 `vnode.data.transition` 中，这点很关键，只有这样才能实现列表中单个元素的过渡动画。

- 处理 prevChildren

```js
if (prevChildren) {
  const kept: Array<VNode> = []
  const removed: Array<VNode> = []
  for (let i = 0; i < prevChildren.length; i++) {
    const c: VNode = prevChildren[i]
    c.data.transition = transitionData
    c.data.pos = c.elm.getBoundingClientRect()
    if (map[c.key]) {
      kept.push(c)
    } else {
      removed.push(c)
    }
  }
  this.kept = h(tag, null, kept)
  this.removed = removed
}

return h(tag, null, children)
```

当有 `prevChildren` 的时候，我们会对它做遍历，获取到每个 `vnode`，然后把 `transitionData` 赋值到 `vnode.data.transition`，这个是为了当它在 `enter` 和 `leave` 的钩子函数中有过渡动画，我们在上节介绍 `transition` 的实现中说过。接着又调用了原生 DOM 的 `getBoundingClientRect` 方法获取到原生 DOM 的位置信息，记录到 `vnode.data.pos` 中，然后判断一下 `vnode.key` 是否在 `map` 中，如果在则放入 `kept` 中，否则表示该节点已被删除，放入 `removed` 中，然后通过执行 `h(tag, null, kept)` 渲染后放入 `this.kept` 中，把 `removed` 用 `this.removed` 保存。最后整个 `render` 函数通过 `h(tag, null, children)` 生成渲染 `vnode`。

如果 `transition-group` 只实现了这个 `render` 函数，那么每次插入和删除的元素的缓动动画是可以实现的，在我们的例子中，当新增一个元素，它的插入的过渡动画是有的，但是剩余元素平移的过渡效果是出不来的，所以接下来我们来分析 `<transition-group>` 组件是如何实现剩余元素平移的过渡效果的。

## move 过渡实现

其实我们在实现元素的插入和删除，无非就是操作数据，控制它们的添加和删除。比如我们新增数据的时候，会添加一条数据，除了重新执行 `render` 函数渲染新的节点外，还要触发 `updated` 钩子函数，接着我们就来分析 `updated` 钩子函数的实现。

- 判断子元素是否定义 `move` 相关样式

```js
const children: Array<VNode> = this.prevChildren
const moveClass: string = this.moveClass || ((this.name || 'v') + '-move')
if (!children.length || !this.hasMove(children[0].elm, moveClass)) {
  return
}

hasMove (el: any, moveClass: string): boolean {
  /* istanbul ignore if */
  if (!hasTransition) {
    return false
  }
  /* istanbul ignore if */
  if (this._hasMove) {
    return this._hasMove
  }
  // Detect whether an element with the move class applied has
  // CSS transitions. Since the element may be inside an entering
  // transition at this very moment, we make a clone of it and remove
  // all other transition classes applied to ensure only the move class
  // is applied.
  const clone: HTMLElement = el.cloneNode()
  if (el._transitionClasses) {
    el._transitionClasses.forEach((cls: string) => { removeClass(clone, cls) })
  }
  addClass(clone, moveClass)
  clone.style.display = 'none'
  this.$el.appendChild(clone)
  const info: Object = getTransitionInfo(clone)
  this.$el.removeChild(clone)
  return (this._hasMove = info.hasTransform)
}
```
核心就是 `hasMove` 的判断，首先克隆一个 DOM 节点，然后为了避免影响，移除它的所有其他的过渡 `Class`；接着添加了 `moveClass` 样式，设置 `display` 为 `none`，添加到组件根节点上；接下来通过 `getTransitionInfo` 获取它的一些缓动相关的信息，这个函数在上一节我们也介绍过，然后从组件根节点上删除这个克隆节点，并通过判断 `info.hasTransform` 来判断 `hasMove`，在我们的例子中，该值为 `true`。

- 子节点预处理

```js
children.forEach(callPendingCbs)
children.forEach(recordPosition)
children.forEach(applyTranslation)
```

对 `children` 做了 3 轮循环，分别做了如下一些处理：

```js
function callPendingCbs (c: VNode) {
  if (c.elm._moveCb) {
    c.elm._moveCb()
  }
  if (c.elm._enterCb) {
    c.elm._enterCb()
  }
}

function recordPosition (c: VNode) {
  c.data.newPos = c.elm.getBoundingClientRect()
}

function applyTranslation (c: VNode) {
  const oldPos = c.data.pos
  const newPos = c.data.newPos
  const dx = oldPos.left - newPos.left
  const dy = oldPos.top - newPos.top
  if (dx || dy) {
    c.data.moved = true
    const s = c.elm.style
    s.transform = s.WebkitTransform = `translate(${dx}px,${dy}px)`
    s.transitionDuration = '0s'
  }
}
```

`callPendingCbs` 方法是在前一个过渡动画没执行完又再次执行到该方法的时候，会提前执行 `_moveCb` 和 `_enterCb`。

`recordPosition` 的作用是记录节点的新位置。

`applyTranslation` 的作用是先计算节点新位置和旧位置的差值，如果差值不为 0，则说明这些节点是需要移动的，所以记录 `vnode.data.moved` 为 true，并且通过设置 `transform` 把需要移动的节点的位置又偏移到之前的旧位置，目的是为了做 `move` 缓动做准备。

- 遍历子元素实现 move 过渡

```js
this._reflow = document.body.offsetHeight

children.forEach((c: VNode) => {
  if (c.data.moved) {
    var el: any = c.elm
    var s: any = el.style
    addTransitionClass(el, moveClass)
    s.transform = s.WebkitTransform = s.transitionDuration = ''
    el.addEventListener(transitionEndEvent, el._moveCb = function cb (e) {
      if (!e || /transform$/.test(e.propertyName)) {
        el.removeEventListener(transitionEndEvent, cb)
        el._moveCb = null
        removeTransitionClass(el, moveClass)
      }
    })
  }
})
```

首先通过 `document.body.offsetHeight` 强制触发浏览器重绘，接着再次对 `children` 遍历，先给子节点添加 `moveClass`，在我们的例子中，`moveClass` 定义了 `transition: all 1s;` 缓动；接着把子节点的 `style.transform` 设置为空，由于我们前面把这些节点偏移到之前的旧位置，所以它就会从旧位置按照 `1s` 的缓动时间过渡偏移到它的当前目标位置，这样就实现了 move 的过渡动画。并且接下来会监听 `transitionEndEvent` 过渡结束的事件，做一些清理的操作。

另外，由于虚拟 DOM 的子元素更新算法是不稳定的，它不能保证被移除元素的相对位置，所以我们强制 `<transition-group>` 组件更新子节点通过 2 个步骤：第一步我们移除需要移除的 `vnode`，同时触发它们的 `leaving` 过渡；第二步我们需要把插入和移动的节点达到它们的最终态，同时还要保证移除的节点保留在应该的位置，而这个是通过 `beforeMount` 钩子函数来实现的：

```js
beforeMount () {
  const update = this._update
  this._update = (vnode, hydrating) => {
    // force removing pass
    this.__patch__(
      this._vnode,
      this.kept,
      false, // hydrating
      true // removeOnly (!important, avoids unnecessary moves)
    )
    this._vnode = this.kept
    update.call(this, vnode, hydrating)
  }
}
```

通过把 `__patch__` 方法的第四个参数 `removeOnly` 设置为 true，这样在 `updateChildren` 阶段，是不会移动 `vnode` 节点的。

## 总结

那么到此，`<transtion-group>` 组件的实现原理就介绍完毕了，它和 `<transition>` 组件相比，实现了列表的过渡，以及它会渲染成真实的元素。当我们去修改列表的数据的时候，如果是添加或者删除数据，则会触发相应元素本身的过渡动画，这点和 `<transition>` 组件实现效果一样，除此之外 `<transtion-group>` 还实现了 move 的过渡效果，让我们的列表过渡动画更加丰富。