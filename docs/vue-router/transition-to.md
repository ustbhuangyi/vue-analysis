# 路径切换

`history.transitionTo` 是 Vue-Router 中非常重要的方法，当我们切换路由线路的时候，就会执行到该方法，前一节我们分析了 `matcher` 的相关实现，知道它是如何找到匹配的新线路，那么匹配到新线路后又做了哪些事情，接下来我们来完整分析一下 `transitionTo` 的实现，它的定义在 `src/history/base.js` 中：

```js
transitionTo (location: RawLocation, onComplete?: Function, onAbort?: Function) {
  const route = this.router.match(location, this.current)
  this.confirmTransition(route, () => {
    this.updateRoute(route)
    onComplete && onComplete(route)
    this.ensureURL()

    if (!this.ready) {
      this.ready = true
      this.readyCbs.forEach(cb => { cb(route) })
    }
  }, err => {
    if (onAbort) {
      onAbort(err)
    }
    if (err && !this.ready) {
      this.ready = true
      this.readyErrorCbs.forEach(cb => { cb(err) })
    }
  })
}
```

`transitionTo` 首先根据目标 `location` 和当前路径 `this.current` 执行 `this.router.match` 方法去匹配到目标的路径。这里 `this.current` 是 `history` 维护的当前路径，它的初始值是在 `history` 的构造函数中初始化的：

```js
this.current = START
```

`START` 的定义在 `src/util/route.js` 中：

```js
export const START = createRoute(null, {
  path: '/'
})
```

这样就创建了一个初始的 `Route`，而 `transitionTo` 实际上也就是在切换 `this.current`，稍后我们会看到。

拿到新的路径后，那么接下来就会执行 `confirmTransition` 方法去做真正的切换，由于这个过程可能有一些异步的操作（如异步组件），所以整个 `confirmTransition` API 设计成带有成功回调函数和失败回调函数，先来看一下它的定义：

```js
confirmTransition (route: Route, onComplete: Function, onAbort?: Function) {
  const current = this.current
  const abort = err => {
    if (isError(err)) {
      if (this.errorCbs.length) {
        this.errorCbs.forEach(cb => { cb(err) })
      } else {
        warn(false, 'uncaught error during route navigation:')
        console.error(err)
      }
    }
    onAbort && onAbort(err)
  }
  if (
    isSameRoute(route, current) &&
    route.matched.length === current.matched.length
  ) {
    this.ensureURL()
    return abort()
  }

  const {
    updated,
    deactivated,
    activated
  } = resolveQueue(this.current.matched, route.matched)

  const queue: Array<?NavigationGuard> = [].concat(
    extractLeaveGuards(deactivated),
    this.router.beforeHooks,
    extractUpdateHooks(updated),
    activated.map(m => m.beforeEnter),
    resolveAsyncComponents(activated)
  )

  this.pending = route
  const iterator = (hook: NavigationGuard, next) => {
    if (this.pending !== route) {
      return abort()
    }
    try {
      hook(route, current, (to: any) => {
        if (to === false || isError(to)) {
          this.ensureURL(true)
          abort(to)
        } else if (
          typeof to === 'string' ||
          (typeof to === 'object' && (
            typeof to.path === 'string' ||
            typeof to.name === 'string'
          ))
        ) {
          abort()
          if (typeof to === 'object' && to.replace) {
            this.replace(to)
          } else {
            this.push(to)
          }
        } else {
          next(to)
        }
      })
    } catch (e) {
      abort(e)
    }
  }

  runQueue(queue, iterator, () => {
    const postEnterCbs = []
    const isValid = () => this.current === route
    const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
    const queue = enterGuards.concat(this.router.resolveHooks)
    runQueue(queue, iterator, () => {
      if (this.pending !== route) {
        return abort()
      }
      this.pending = null
      onComplete(route)
      if (this.router.app) {
        this.router.app.$nextTick(() => {
          postEnterCbs.forEach(cb => { cb() })
        })
      }
    })
  })
}
```

首先定义了 `abort` 函数，然后判断如果满足计算后的 `route` 和 `current` 是相同路径的话，则直接调用 `this.ensureUrl` 和 `abort`，`ensureUrl` 这个函数我们之后会介绍。

接着又根据 `current.matched` 和 `route.matched` 执行了 `resolveQueue` 方法解析出 3 个队列：

```js
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  return {
    updated: next.slice(0, i),
    activated: next.slice(i),
    deactivated: current.slice(i)
  }
}
```

因为 `route.matched` 是一个 `RouteRecord` 的数组，由于路径是由 `current` 变向 `route`，那么就遍历对比 2 边的 `RouteRecord`，找到一个不一样的位置 `i`，那么 `next` 中从 0 到 `i` 的 `RouteRecord` 是两边都一样，则为 `updated` 的部分；从 `i` 到最后的 `RouteRecord` 是 `next` 独有的，为 `activated` 的部分；而 `current` 中从 `i` 到最后的 `RouteRecord` 则没有了，为 `deactivated` 的部分。

拿到 `updated`、`activated`、`deactivated` 3 个 `ReouteRecord` 数组后，接下来就是路径变换后的一个重要部分，执行一系列的钩子函数。

## 导航守卫

官方的说法叫导航守卫，实际上就是发生在路由路径切换的时候，执行的一系列钩子函数。

我们先从整体上看一下这些钩子函数执行的逻辑，首先构造一个队列 `queue`，它实际上是一个数组；然后再定义一个迭代器函数 `iterator`；最后再执行 `runQueue` 方法来执行这个队列。我们先来看一下 `runQueue` 的定义，在 `src/util/async.js` 中：

```js
export function runQueue (queue: Array<?NavigationGuard>, fn: Function, cb: Function) {
  const step = index => { 
    if (index >= queue.length) {
      cb()
    } else {
      if (queue[index]) {
        fn(queue[index], () => {
          step(index + 1)
        })
      } else {
        step(index + 1)
      }
    }
  }
  step(0)
}
```

这是一个非常经典的异步函数队列化执行的模式， `queue` 是一个 `NavigationGuard` 类型的数组，我们定义了 `step` 函数，每次根据 `index` 从 `queue` 中取一个 `guard`，然后执行 `fn` 函数，并且把 `guard` 作为参数传入，第二个参数是一个函数，当这个函数执行的时候再递归执行 `step` 函数，前进到下一个，注意这里的 `fn` 就是我们刚才的 `iterator` 函数，那么我们再回到 `iterator` 函数的定义：

```js
const iterator = (hook: NavigationGuard, next) => {
  if (this.pending !== route) {
    return abort()
  }
  try {
    hook(route, current, (to: any) => {
      if (to === false || isError(to)) {
        this.ensureURL(true)
        abort(to)
      } else if (
        typeof to === 'string' ||
        (typeof to === 'object' && (
          typeof to.path === 'string' ||
          typeof to.name === 'string'
        ))
      ) {
        abort()
        if (typeof to === 'object' && to.replace) {
          this.replace(to)
        } else {
          this.push(to)
        }
      } else {
        next(to)
      }
    })
  } catch (e) {
    abort(e)
  }
}
```

`iterator` 函数逻辑很简单，它就是去执行每一个 导航守卫 `hook`，并传入 `route`、`current` 和匿名函数，这些参数对应文档中的 `to`、`from`、`next`，当执行了匿名函数，会根据一些条件执行 `abort` 或 `next`，只有执行 `next` 的时候，才会前进到下一个导航守卫钩子函数中，这也就是为什么官方文档会说只有执行 `next` 方法来 `resolve` 这个钩子函数。

那么最后我们来看 `queue` 是怎么构造的：

```js
const queue: Array<?NavigationGuard> = [].concat(
  extractLeaveGuards(deactivated),
  this.router.beforeHooks,
  extractUpdateHooks(updated),
  activated.map(m => m.beforeEnter),
  resolveAsyncComponents(activated)
)
```

按照顺序如下：

1. 在失活的组件里调用离开守卫。

2. 调用全局的 `beforeEach` 守卫。

3. 在重用的组件里调用 `beforeRouteUpdate` 守卫 

4. 在激活的路由配置里调用 `beforeEnter`。

5. 解析异步路由组件。

接下来我们来分别介绍这 5 步的实现。

第一步是通过执行 `extractLeaveGuards(deactivated)`，先来看一下 `extractLeaveGuards` 的定义：

```js
function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}
```

它内部调用了 `extractGuards` 的通用方法，可以从 `RouteRecord` 数组中提取各个阶段的守卫：

```js
function extractGuards (
  records: Array<RouteRecord>,
  name: string,
  bind: Function,
  reverse?: boolean
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name)
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  return flatten(reverse ? guards.reverse() : guards)
}
```

这里用到了 `flatMapComponents` 方法去从 `records` 中获取所有的导航，它的定义在 `src/util/resolve-components.js` 中：

```js
export function flatMapComponents (
  matched: Array<RouteRecord>,
  fn: Function
): Array<?Function> {
  return flatten(matched.map(m => {
    return Object.keys(m.components).map(key => fn(
      m.components[key],
      m.instances[key],
      m, key
    ))
  }))
}

export function flatten (arr: Array<any>): Array<any> {
  return Array.prototype.concat.apply([], arr)
}
```

`flatMapComponents` 的作用就是返回一个数组，数组的元素是从 `matched` 里获取到所有组件的 `key`，然后返回 `fn` 函数执行的结果，`flatten` 作用是把二维数组拍平成一维数组。

那么对于 `extractGuards` 中 `flatMapComponents` 的调用，执行每个 `fn` 的时候，通过 `extractGuard(def, name)` 获取到组件中对应 `name` 的导航守卫：
 
```js
function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    def = _Vue.extend(def)
  }
  return def.options[key]
}
```

获取到 `guard` 后，还会调用 `bind` 方法把组件的实例 `instance` 作为函数执行的上下文绑定到 `guard` 上，`bind ` 方法的对应的是 `bindGuard`：

```js
function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}
```

那么对于 `extractLeaveGuards(deactivated)` 而言，获取到的就是所有失活组件中定义的 `beforeRouteLeave` 钩子函数。

第二步是 `this.router.beforeHooks`，在我们的 `VueRouter` 类中定义了 `beforeEach` 方法，在 `src/index.js` 中：

```js
beforeEach (fn: Function): Function {
  return registerHook(this.beforeHooks, fn)
}

function registerHook (list: Array<any>, fn: Function): Function {
  list.push(fn)
  return () => {
    const i = list.indexOf(fn)
    if (i > -1) list.splice(i, 1)
  }
}
```

当用户使用 `router.beforeEach` 注册了一个全局守卫，就会往 `router.beforeHooks` 添加一个钩子函数，这样 `this.router.beforeHooks` 获取的就是用户注册的全局 `beforeEach` 守卫。

第三步执行了 `extractUpdateHooks(updated)`，来看一下 `extractUpdateHooks` 的定义：

```js
function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}
```
和 `extractLeaveGuards(deactivated)` 类似，`extractUpdateHooks(updated)` 获取到的就是所有重用的组件中定义的 `beforeRouteUpdate` 钩子函数。

第四步是执行 `activated.map(m => m.beforeEnter)`，获取的是在激活的路由配置中定义的 `beforeEnter` 函数。

第五步是执行 `resolveAsyncComponents(activated)` 解析异步组件，先来看一下 `resolveAsyncComponents` 的定义，在 `src/util/resolve-components.js` 中：

```js
export function resolveAsyncComponents (matched: Array<RouteRecord>): Function {
  return (to, from, next) => {
    let hasAsync = false
    let pending = 0
    let error = null

    flatMapComponents(matched, (def, _, match, key) => {
      if (typeof def === 'function' && def.cid === undefined) {
        hasAsync = true
        pending++

        const resolve = once(resolvedDef => {
          if (isESModule(resolvedDef)) {
            resolvedDef = resolvedDef.default
          }
          def.resolved = typeof resolvedDef === 'function'
            ? resolvedDef
            : _Vue.extend(resolvedDef)
          match.components[key] = resolvedDef
          pending--
          if (pending <= 0) {
            next()
          }
        })

        const reject = once(reason => {
          const msg = `Failed to resolve async component ${key}: ${reason}`
          process.env.NODE_ENV !== 'production' && warn(false, msg)
          if (!error) {
            error = isError(reason)
              ? reason
              : new Error(msg)
            next(error)
          }
        })

        let res
        try {
          res = def(resolve, reject)
        } catch (e) {
          reject(e)
        }
        if (res) {
          if (typeof res.then === 'function') {
            res.then(resolve, reject)
          } else {
            const comp = res.component
            if (comp && typeof comp.then === 'function') {
              comp.then(resolve, reject)
            }
          }
        }
      }
    })

    if (!hasAsync) next()
  }
}
```

`resolveAsyncComponents` 返回的是一个导航守卫函数，有标准的 `to`、`from`、`next` 参数。它的内部实现很简单，利用了 `flatMapComponents` 方法从 `matched` 中获取到每个组件的定义，判断如果是异步组件，则执行异步组件加载逻辑，这块和我们之前分析 `Vue` 加载异步组件很类似，加载成功后会执行 ` match.components[key] = resolvedDef` 把解析好的异步组件放到对应的 `components` 上，并且执行 `next` 函数。

这样在 `resolveAsyncComponents(activated)` 解析完所有激活的异步组件后，我们就可以拿到这一次所有激活的组件。这样我们在做完这 5 步后又做了一些事情：

```js
runQueue(queue, iterator, () => {
  const postEnterCbs = []
  const isValid = () => this.current === route
  const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)
  const queue = enterGuards.concat(this.router.resolveHooks)
  runQueue(queue, iterator, () => {
    if (this.pending !== route) {
      return abort()
    }
    this.pending = null
    onComplete(route)
    if (this.router.app) {
      this.router.app.$nextTick(() => {
        postEnterCbs.forEach(cb => { cb() })
      })
    }
  })
})
```

6. 在被激活的组件里调用 `beforeRouteEnter`。

7. 调用全局的 `beforeResolve` 守卫。

8. 调用全局的 `afterEach` 钩子。

对于第六步有这些相关的逻辑：

```js
const postEnterCbs = []
const isValid = () => this.current === route
const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid)

function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>,
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(activated, 'beforeRouteEnter', (guard, _, match, key) => {
    return bindEnterGuard(guard, match, key, cbs, isValid)
  })
}

function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>,
  isValid: () => boolean
): NavigationGuard {
  return function routeEnterGuard (to, from, next) {
    return guard(to, from, cb => {
      next(cb)
      if (typeof cb === 'function') {
        cbs.push(() => {
          poll(cb, match.instances, key, isValid)
        })
      }
    })
  }
}

function poll (
  cb: any,
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (instances[key]) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
```

`extractEnterGuards` 函数的实现也是利用了 `extractGuards` 方法提取组件中的 `beforeRouteEnter` 导航钩子函数，和之前不同的是 `bind` 方法的不同。文档中特意强调了 `beforeRouteEnter` 钩子函数中是拿不到组件实例的，因为当守卫执行前，组件实例还没被创建，但是我们可以通过传一个回调给 `next` 来访问组件实例。在导航被确认的时候执行回调，并且把组件实例作为回调方法的参数：

```js
beforeRouteEnter (to, from, next) {
  next(vm => {
    // 通过 `vm` 访问组件实例
  })
}
```

来看一下这是怎么实现的。

在 `bindEnterGuard` 函数中，返回的是 `routeEnterGuard` 函数，所以在执行 `iterator` 中的 `hook` 函数的时候，就相当于执行 `routeEnterGuard` 函数，那么就会执行我们定义的导航守卫 `guard` 函数，并且当这个回调函数执行的时候，首先执行 `next` 函数 `rersolve` 当前导航钩子，然后把回调函数的参数，它也是一个回调函数用 `cbs` 收集起来，其实就是收集到外面定义的 `postEnterCbs` 中，然后在最后会执行：

```js
if (this.router.app) {
  this.router.app.$nextTick(() => {
    postEnterCbs.forEach(cb => { cb() })
  })
}
```
在根路由组件重新渲染后，遍历 `postEnterCbs` 执行回调，每一个回调执行的时候，其实是执行 ` poll(cb, match.instances, key, isValid)` 方法，因为考虑到一些了路由组件被套 `transition` 組件在一些缓动模式下不一定能拿到实例，所以用一个轮询方法不断去判断，直到能获取到组件实例，再去调用 `cb`，并把组件实例作为参数传入，这就是我们在回调函数中能拿到组件实例的原因。

第七步是获取 `this.router.resolveHooks`，这个和
`this.router.beforeHooks` 的获取类似，在我们的 `VueRouter` 类中定义了 `beforeResolve` 方法：

```js
beforeResolve (fn: Function): Function {
  return registerHook(this.resolveHooks, fn)
}
```

当用户使用 `router.beforeResolve` 注册了一个全局守卫，就会往 `router.resolveHooks` 添加一个钩子函数，这样 `this.router.resolveHooks` 获取的就是用户注册的全局 `beforeResolve` 守卫。

第八步是在最后执行了 `onComplete(route)` 后，会执行 `this.updateRoute(route)` 方法：

```js
updateRoute (route: Route) {
  const prev = this.current
  this.current = route
  this.cb && this.cb(route)
  this.router.afterHooks.forEach(hook => {
    hook && hook(route, prev)
  })
}
```
同样在我们的 `VueRouter` 类中定义了 `afterEach` 方法：

```js
afterEach (fn: Function): Function {
  return registerHook(this.afterHooks, fn)
}
```

当用户使用 `router.afterEach` 注册了一个全局守卫，就会往 `router.afterHooks` 添加一个钩子函数，这样 `this.router.afterHooks` 获取的就是用户注册的全局 `afterHooks` 守卫。

那么至此我们把所有导航守卫的执行分析完毕了，我们知道路由切换除了执行这些钩子函数，从表象上有 2 个地方会发生变化，一个是 url 发生变化，一个是组件发生变化。接下来我们分别介绍这两块的实现原理。

## url

当我们点击 `router-link` 的时候，实际上最终会执行 `router.push`，如下：

```js
push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
  this.history.push(location, onComplete, onAbort)
}
```

`this.history.push` 函数，这个函数是子类实现的，不同模式下该函数的实现略有不同，我们来看一下平时使用比较多的 `hash` 模式该函数的实现，在 `src/history/hash.js` 中：

```js
push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
  const { current: fromRoute } = this
  this.transitionTo(location, route => {
    pushHash(route.fullPath)
    handleScroll(this.router, route, fromRoute, false)
    onComplete && onComplete(route)
  }, onAbort)
}

```

`push` 函数会先执行 `this.transitionTo` 做路径切换，在切换完成的回调函数中，执行 `pushHash` 函数：

```js
function pushHash (path) {
  if (supportsPushState) {
    pushState(getUrl(path))
  } else {
    window.location.hash = path
  }
}
```

`supportsPushState` 的定义在 `src/util/push-state.js` 中：

```js
export const supportsPushState = inBrowser && (function () {
  const ua = window.navigator.userAgent

  if (
    (ua.indexOf('Android 2.') !== -1 || ua.indexOf('Android 4.0') !== -1) &&
    ua.indexOf('Mobile Safari') !== -1 &&
    ua.indexOf('Chrome') === -1 &&
    ua.indexOf('Windows Phone') === -1
  ) {
    return false
  }

  return window.history && 'pushState' in window.history
})()
```

如果支持的话，则获取当前完整的 `url`，执行 `pushState` 方法：

```js
export function pushState (url?: string, replace?: boolean) {
  saveScrollPosition()
  const history = window.history
  try {
    if (replace) {
      history.replaceState({ key: _key }, '', url)
    } else {
      _key = genKey()
      history.pushState({ key: _key }, '', url)
    }
  } catch (e) {
    window.location[replace ? 'replace' : 'assign'](url)
  }
}
```

`pushState` 会调用浏览器原生的 `history` 的 `pushState` 接口或者 `replaceState` 接口，更新浏览器的 url 地址，并把当前 url 压入历史栈中。

然后在 `history` 的初始化中，会设置一个监听器，监听历史栈的变化：

```js
setupListeners () {
  const router = this.router
  const expectScroll = router.options.scrollBehavior
  const supportsScroll = supportsPushState && expectScroll

  if (supportsScroll) {
    setupScroll()
  }

  window.addEventListener(supportsPushState ? 'popstate' : 'hashchange', () => {
    const current = this.current
    if (!ensureSlash()) {
      return
    }
    this.transitionTo(getHash(), route => {
      if (supportsScroll) {
        handleScroll(this.router, route, current, true)
      }
      if (!supportsPushState) {
        replaceHash(route.fullPath)
      }
    })
  })
}
```

当点击浏览器返回按钮的时候，如果已经有 url 被压入历史栈，则会触发 `popstate` 事件，然后拿到当前要跳转的 `hash`，执行 `transtionTo` 方法做一次路径转换。

同学们在使用 Vue-Router 开发项目的时候，打开调试页面 `http://localhost:8080` 后会自动把 url 修改为 `http://localhost:8080/#/`，这是怎么做到呢？原来在实例化 `HashHistory` 的时候，构造函数会执行 `ensureSlash()` 方法：

```js
function ensureSlash (): boolean {
  const path = getHash()
  if (path.charAt(0) === '/') {
    return true
  }
  replaceHash('/' + path)
  return false
}

export function getHash (): string {
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  const href = window.location.href
  const index = href.indexOf('#')
  return index === -1 ? '' : href.slice(index + 1)
}

function getUrl (path) {
  const href = window.location.href
  const i = href.indexOf('#')
  const base = i >= 0 ? href.slice(0, i) : href
  return `${base}#${path}`
}

function replaceHash (path) {
  if (supportsPushState) {
    replaceState(getUrl(path))
  } else {
    window.location.replace(getUrl(path))
  }
}

export function replaceState (url?: string) {
  pushState(url, true)
}
```
这个时候 `path` 为空，所以执行 `replaceHash('/' + path)`，然后内部会执行一次 `getUrl`，计算出来的新的 `url` 为 `http://localhost:8080/#/`，最终会执行 `pushState(url, true)`，这就是 url 会改变的原因。

## 组件

路由最终的渲染离不开组件，Vue-Router 内置了 `<router-view>` 组件，它的定义在 `src/components/view.js` 中。

```js
export default {
  name: 'RouterView',
  functional: true,
  props: {
    name: {
      type: String,
      default: 'default'
    }
  },
  render (_, { props, children, parent, data }) {
    data.routerView = true
   
    const h = parent.$createElement
    const name = props.name
    const route = parent.$route
    const cache = parent._routerViewCache || (parent._routerViewCache = {})

    let depth = 0
    let inactive = false
    while (parent && parent._routerRoot !== parent) {
      if (parent.$vnode && parent.$vnode.data.routerView) {
        depth++
      }
      if (parent._inactive) {
        inactive = true
      }
      parent = parent.$parent
    }
    data.routerViewDepth = depth

    if (inactive) {
      return h(cache[name], data, children)
    }

    const matched = route.matched[depth]
    if (!matched) {
      cache[name] = null
      return h()
    }

    const component = cache[name] = matched.components[name]
   
    data.registerRouteInstance = (vm, val) => {     
      const current = matched.instances[name]
      if (
        (val && current !== vm) ||
        (!val && current === vm)
      ) {
        matched.instances[name] = val
      }
    }
    
    ;(data.hook || (data.hook = {})).prepatch = (_, vnode) => {
      matched.instances[name] = vnode.componentInstance
    }

    let propsToPass = data.props = resolveProps(route, matched.props && matched.props[name])
    if (propsToPass) {
      propsToPass = data.props = extend({}, propsToPass)
      const attrs = data.attrs = data.attrs || {}
      for (const key in propsToPass) {
        if (!component.props || !(key in component.props)) {
          attrs[key] = propsToPass[key]
          delete propsToPass[key]
        }
      }
    }

    return h(component, data, children)
  }
}
```

`<router-view>` 是一个 `functional` 组件，它的渲染也是依赖 `render` 函数，那么 `<router-view>` 具体应该渲染什么组件呢，首先获取当前的路径：

```js
const route = parent.$route
```

我们之前分析过，在 `src/install.js` 中，我们给 Vue 的原型上定义了 `$route`：

```js
Object.defineProperty(Vue.prototype, '$route', {
  get () { return this._routerRoot._route }
})
```

然后在 `VueRouter` 的实例执行 `router.init` 方法的时候，会执行如下逻辑，定义在 `src/index.js` 中：

```js
history.listen(route => {
  this.apps.forEach((app) => {
    app._route = route
  })
})
```

而 `history.listen` 方法定义在 `src/history/base.js` 中：

```js
listen (cb: Function) {
  this.cb = cb
}
```

然后在 `updateRoute` 的时候执行 `this.cb`：

```js
updateRoute (route: Route) {
  //. ..
  this.current = route
  this.cb && this.cb(route)
  // ...
}
```

也就是我们执行 `transitionTo` 方法最后执行 `updateRoute` 的时候会执行回调，然后会更新 `this.apps` 保存的组件实例的 `_route` 值，`this.apps` 数组保存的实例的特点都是在初始化的时候传入了 `router` 配置项，一般的场景数组只会保存根 Vue 实例，因为我们是在 `new Vue` 传入了 `router` 实例。`$route` 是定义在 `Vue.prototype` 上。每个组件实例访问 `$route` 属性，就是访问根实例的 `_route`，也就是当前的路由线路。

`<router-view>` 是支持嵌套的，回到 `render` 函数，其中定义了 `depth` 的概念，它表示 `<router-view>` 嵌套的深度。每个 `<router-view>` 在渲染的时候，执行如下逻辑：

```js
data.routerView = true
// ...
while (parent && parent._routerRoot !== parent) {
  if (parent.$vnode && parent.$vnode.data.routerView) {
    depth++
  }
  if (parent._inactive) {
    inactive = true
  }
  parent = parent.$parent
}

const matched = route.matched[depth]
// ...
const component = cache[name] = matched.components[name]
```

`parent._routerRoot` 表示的是根 Vue 实例，那么这个循环就是从当前的 `<router-view>` 的父节点向上找，一直找到根 Vue 实例，在这个过程，如果碰到了父节点也是 `<router-view>` 的时候，说明 `<router-view>` 有嵌套的情况，`depth++`。遍历完成后，根据当前线路匹配的路径和 `depth` 找到对应的 `RouteRecord`，进而找到该渲染的组件。

除了找到了应该渲染的组件，还定义了一个注册路由实例的方法：

```js
data.registerRouteInstance = (vm, val) => {     
  const current = matched.instances[name]
  if (
    (val && current !== vm) ||
    (!val && current === vm)
  ) {
    matched.instances[name] = val
  }
}

```

给 `vnode` 的 `data` 定义了 `registerRouteInstance` 方法，在 `src/install.js` 中，我们会调用该方法去注册路由的实例：

```js
const registerInstance = (vm, callVal) => {
  let i = vm.$options._parentVnode
  if (isDef(i) && isDef(i = i.data) && isDef(i = i.registerRouteInstance)) {
    i(vm, callVal)
  }
}

Vue.mixin({
  beforeCreate () {
    // ...
    registerInstance(this, this)
  },
  destroyed () {
    registerInstance(this)
  }
})
```

在混入的 `beforeCreate` 钩子函数中，会执行 `registerInstance` 方法，进而执行 `render` 函数中定义的 `registerRouteInstance` 方法，从而给 `matched.instances[name]` 赋值当前组件的 `vm` 实例。

`render` 函数的最后根据 `component` 渲染出对应的组件 `vonde`：

```js
return h(component, data, children)
```

那么当我们执行 `transitionTo` 来更改路由线路后，组件是如何重新渲染的呢？在我们混入的 `beforeCreate` 钩子函数中有这么一段逻辑：

```js
Vue.mixin({
  beforeCreate () {
    if (isDef(this.$options.router)) {
      Vue.util.defineReactive(this, '_route', this._router.history.current)
    }
    // ...
  }
})
```

由于我们把根 Vue 实例的 `_route` 属性定义成响应式的，我们在每个 `<router-view>` 执行 `render` 函数的时候，都会访问  `parent.$route`，如我们之前分析会访问 `this._routerRoot._route`，触发了它的 `getter`，相当于 `<router-view>` 对它有依赖，然后再执行完 `transitionTo` 后，修改 `app._route` 的时候，又触发了`setter`，因此会通知 `<router-view>` 的渲染 `watcher` 更新，重新渲染组件。

Vue-Router 还内置了另一个组件 `<router-link>`，
 它支持用户在具有路由功能的应用中（点击）导航。 通过 `to` 属性指定目标地址，默认渲染成带有正确链接的 `<a>` 标签，可以通过配置 `tag` 属性生成别的标签。另外，当目标路由成功激活时，链接元素自动设置一个表示激活的 CSS 类名。

`<router-link>` 比起写死的 `<a href="...">` 会好一些，理由如下：

无论是 HTML5 `history` 模式还是 `hash` 模式，它的表现行为一致，所以，当你要切换路由模式，或者在 IE9 降级使用 `hash` 模式，无须作任何变动。

在 HTML5 `history` 模式下，`router-link` 会守卫点击事件，让浏览器不再重新加载页面。

当你在 HTML5 `history` 模式下使用 `base` 选项之后，所有的 to 属性都不需要写（基路径）了。

那么接下来我们就来分析它的实现，它的定义在 `src/components/link.js` 中：

```js
export default {
  name: 'RouterLink',
  props: {
    to: {
      type: toTypes,
      required: true
    },
    tag: {
      type: String,
      default: 'a'
    },
    exact: Boolean,
    append: Boolean,
    replace: Boolean,
    activeClass: String,
    exactActiveClass: String,
    event: {
      type: eventTypes,
      default: 'click'
    }
  },
  render (h: Function) {
    const router = this.$router
    const current = this.$route
    const { location, route, href } = router.resolve(this.to, current, this.append)

    const classes = {}
    const globalActiveClass = router.options.linkActiveClass
    const globalExactActiveClass = router.options.linkExactActiveClass
    const activeClassFallback = globalActiveClass == null
            ? 'router-link-active'
            : globalActiveClass
    const exactActiveClassFallback = globalExactActiveClass == null
            ? 'router-link-exact-active'
            : globalExactActiveClass
    const activeClass = this.activeClass == null
            ? activeClassFallback
            : this.activeClass
    const exactActiveClass = this.exactActiveClass == null
            ? exactActiveClassFallback
            : this.exactActiveClass
    const compareTarget = location.path
      ? createRoute(null, location, null, router)
      : route

    classes[exactActiveClass] = isSameRoute(current, compareTarget)
    classes[activeClass] = this.exact
      ? classes[exactActiveClass]
      : isIncludedRoute(current, compareTarget)

    const handler = e => {
      if (guardEvent(e)) {
        if (this.replace) {
          router.replace(location)
        } else {
          router.push(location)
        }
      }
    }

    const on = { click: guardEvent }
    if (Array.isArray(this.event)) {
      this.event.forEach(e => { on[e] = handler })
    } else {
      on[this.event] = handler
    }

    const data: any = {
      class: classes
    }

    if (this.tag === 'a') {
      data.on = on
      data.attrs = { href }
    } else {
      const a = findAnchor(this.$slots.default)
      if (a) {
        a.isStatic = false
        const extend = _Vue.util.extend
        const aData = a.data = extend({}, a.data)
        aData.on = on
        const aAttrs = a.data.attrs = extend({}, a.data.attrs)
        aAttrs.href = href
      } else {
        data.on = on
      }
    }

    return h(this.tag, data, this.$slots.default)
  }
}
```

`<router-link>` 标签的渲染也是基于 `render` 函数，它首先做了路由解析：

```js
const router = this.$router
const current = this.$route
const { location, route, href } = router.resolve(this.to, current, this.append)
```

`router.resolve` 是 `VueRouter` 的实例方法，它的定义在 `src/index.js` 中：

```js
resolve (
  to: RawLocation,
  current?: Route,
  append?: boolean
): {
  location: Location,
  route: Route,
  href: string,
  normalizedTo: Location,
  resolved: Route
} {
  const location = normalizeLocation(
    to,
    current || this.history.current,
    append,
    this
  )
  const route = this.match(location, current)
  const fullPath = route.redirectedFrom || route.fullPath
  const base = this.history.base
  const href = createHref(base, fullPath, this.mode)
  return {
    location,
    route,
    href,
    normalizedTo: location,
    resolved: route
  }
}

function createHref (base: string, fullPath: string, mode) {
  var path = mode === 'hash' ? '#' + fullPath : fullPath
  return base ? cleanPath(base + '/' + path) : path
}
```

它先规范生成目标 `location`，再根据 `location` 和 `match` 通过 `this.match` 方法计算生成目标路径 `route`，然后再根据 `base`、`fullPath` 和 `this.mode` 通过 `createHref` 方法计算出最终跳转的 `href`。

解析完 `router` 获得目标 `location`、`route`、`href` 后，接下来对 `exactActiveClass` 和 `activeClass` 做处理，当配置 `exact` 为 true 的时候，只有当目标路径和当前路径完全匹配的时候，会添加 `exactActiveClass`；而当目标路径包含当前路径的时候，会添加 `activeClass`。

接着创建了一个守卫函数 ：

```js
const handler = e => {
  if (guardEvent(e)) {
    if (this.replace) {
      router.replace(location)
    } else {
      router.push(location)
    }
  }
}

function guardEvent (e) {
  if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return
  if (e.defaultPrevented) return
  if (e.button !== undefined && e.button !== 0) return 
  if (e.currentTarget && e.currentTarget.getAttribute) {
    const target = e.currentTarget.getAttribute('target')
    if (/\b_blank\b/i.test(target)) return
  }
  if (e.preventDefault) {
    e.preventDefault()
  }
  return true
}

const on = { click: guardEvent }
  if (Array.isArray(this.event)) {
    this.event.forEach(e => { on[e] = handler })
  } else {
    on[this.event] = handler
  }
```

最终会监听点击事件或者其它可以通过 `prop` 传入的事件类型，执行 `hanlder` 函数，最终执行 `router.push` 或者 `router.replace` 函数，它们的定义在 `src/index.js` 中：

```js
push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
  this.history.push(location, onComplete, onAbort)
}

replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
 this.history.replace(location, onComplete, onAbort)
}
```

实际上就是执行了 `history` 的 `push` 和 `replace` 方法做路由跳转。

最后判断当前 `tag` 是否是 `<a>` 标签，`<router-link>` 默认会渲染成 `<a>` 标签，当然我们也可以修改 `tag` 的 `prop` 渲染成其他节点，这种情况下会尝试找它子元素的 `<a>` 标签，如果有则把事件绑定到 `<a>` 标签上并添加 `href` 属性，否则绑定到外层元素本身。

## 总结

那么至此我们把路由的 `transitionTo` 的主体过程分析完毕了，其他一些分支比如重定向、别名、滚动行为等同学们可以自行再去分析。

路径变化是路由中最重要的功能，我们要记住以下内容：路由始终会维护当前的线路，路由切换的时候会把当前线路切换到目标线路，切换过程中会执行一系列的导航守卫钩子函数，会更改 url，同样也会渲染对应的组件，切换完毕后会把目标线路更新替换当前线路，这样就会作为下一次的路径切换的依据。