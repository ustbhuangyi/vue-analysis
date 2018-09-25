# Vuex 初始化

这一节我们主要来分析 Vuex 的初始化过程，它包括安装、Store 实例化过程 2 个方面。

## 安装

当我们在代码中通过 `import Vuex from 'vuex'` 的时候，实际上引用的是一个对象，它的定义在 `src/index.js` 中：

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```

和 Vue-Router 一样，Vuex 也同样存在一个静态的 `install` 方法，它的定义在 `src/store.js` 中：

```js
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
```

`install` 的逻辑很简单，把传入的 `_Vue` 赋值给 `Vue` 并执行了 `applyMixin(Vue)` 方法，它的定义在 `src/mixin.js` 中：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  function vuexInit () {
    const options = this.$options
    // store injection
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
```

`applyMixin` 就是这个 `export default function`，它还兼容了 Vue 1.0 的版本，这里我们只关注 Vue 2.0 以上版本的逻辑，它其实就全局混入了一个 `beforeCreate` 钩子函数，它的实现非常简单，就是把 `options.store` 保存在所有组件的 `this.$store` 中，这个 `options.store` 就是我们在实例化 `Store` 对象的实例，稍后我们会介绍，这也是为什么我们在组件中可以通过 `this.$store` 访问到这个实例。

## Store 实例化

我们在 `import Vuex` 之后，会实例化其中的 `Store` 对象，返回 `store` 实例并传入 `new Vue` 的 `options` 中，也就是我们刚才提到的 `options.store`.

举个简单的例子，如下： 
```js
export default new Vuex.Store({
  actions,
  getters,
  state,
  mutations,
  modules
  // ...
})
```

`Store` 对象的构造函数接收一个对象参数，它包含 `actions`、`getters`、`state`、`mutations`、`modules` 等 Vuex 的核心概念，它的定义在 `src/store.js` 中：

```js
export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `Store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false
    } = options

    // store internal state
    this._committing = false
    this._actions = Object.create(null)
    this._actionSubscribers = []
    this._mutations = Object.create(null)
    this._wrappedGetters = Object.create(null)
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    resetStoreVM(this, state)

    // apply plugins
    plugins.forEach(plugin => plugin(this))

    if (Vue.config.devtools) {
      devtoolPlugin(this)
    }
  }
}  
```

我们把 `Store` 的实例化过程拆成 3 个部分，分别是初始化模块，安装模块和初始化 `store._vm`，接下来我们来分析这 3 部分的实现。

### 初始化模块

在分析模块初始化之前，我们先来了解一下模块对于 Vuex 的意义：由于使用单一状态树，应用的所有状态会集中到一个比较大的对象，当应用变得非常复杂时，`store` 对象就有可能变得相当臃肿。为了解决以上问题，Vuex 允许我们将 `store` 分割成模块（module）。每个模块拥有自己的 `state`、`mutation`、`action`、`getter`，甚至是嵌套子模块——从上至下进行同样方式的分割：

```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}

const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... },
}

const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})

store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```

所以从数据结构上来看，模块的设计就是一个树型结构，`store` 本身可以理解为一个 `root module`，它下面的 `modules` 就是子模块，Vuex 需要完成这颗树的构建，构建过程的入口就是：

```js
this._modules = new ModuleCollection(options)
```

`ModuleCollection` 的定义在 `src/module/module-collection.js` 中：

```js
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}
```

`ModuleCollection` 实例化的过程就是执行了 `register` 方法，
`register` 接收 3 个参数，其中 `path` 表示路径，因为我们整体目标是要构建一颗模块树，`path` 是在构建树的过程中维护的路径；`rawModule` 表示定义模块的原始配置；`runtime` 表示是否是一个运行时创建的模块。

`register` 方法首先通过 `const newModule = new Module(rawModule, runtime)` 创建了一个 `Module` 的实例，`Module` 是用来描述单个模块的类，它的定义在 `src/module/module.js` 中：

```js
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // Store some children item
    this._children = Object.create(null)
    // Store the origin module object which passed by programmer
    this._rawModule = rawModule
    const rawState = rawModule.state

    // Store the origin module's state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  get namespaced () {
    return !!this._rawModule.namespaced
  }

  addChild (key, module) {
    this._children[key] = module
  }

  removeChild (key) {
    delete this._children[key]
  }

  getChild (key) {
    return this._children[key]
  }

  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
```

来看一下 `Module` 的构造函数，对于每个模块而言，`this._rawModule` 表示模块的配置，`this._children` 表示它的所有子模块，`this.state` 表示这个模块定义的 `state`。

回到 `register`，那么在实例化一个 `Module` 后，判断当前的 `path` 的长度如果为 0，则说明它是一个根模块，所以把 `newModule` 赋值给了 `this.root`，否则就需要建立父子关系了：

```js
const parent = this.get(path.slice(0, -1))
parent.addChild(path[path.length - 1], newModule)
```

我们先大体上了解它的逻辑：首先根据路径获取到父模块，然后再调用父模块的 `addChild` 方法建立父子关系。

`register` 的最后一步，就是遍历当前模块定义中的所有 `modules`，根据 `key` 作为 `path`，递归调用 `register` 方法，这样我们再回过头看一下建立父子关系的逻辑，首先执行了 `this.get(path.slice(0, -1)` 方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

传入的 `path` 是它的父模块的 `path`，然后从根模块开始，通过 `reduce` 方法一层层去找到对应的模块，查找的过程中，执行的是 `module.getChild(key)` 方法：

```js
getChild (key) {
  return this._children[key]
}
```

其实就是返回当前模块的 `_children` 中对应 `key` 的模块，那么每个模块的 `_children` 是如何添加的呢，是通过执行 `parent.addChild(path[path.length - 1], newModule)` 方法：

```js
addChild (key, module) {
  this._children[key] = module
}
```

所以说对于 `root module` 的下一层 `modules` 来说，它们的 `parent` 就是 `root module`，那么他们就会被添加的 `root module` 的 `_children` 中。每个子模块通过路径找到它的父模块，然后通过父模块的 `addChild` 方法建立父子关系，递归执行这样的过程，最终就建立一颗完整的模块树。

### 安装模块

初始化模块后，执行安装模块的相关逻辑，它的目标就是对模块中的 `state`、`getters`、`mutations`、`actions` 做初始化工作，它的入口代码是：

```js
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
```

来看一下 `installModule` 的定义：

```js
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      Vue.set(parentState, moduleName, module.state)
    })
  }

  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```

`installModule` 方法支持 5 个参数，`store` 表示 `root store`；`state` 表示 `root state`；`path` 表示模块的访问路径；`module` 表示当前的模块，`hot` 表示是否是热更新。

接下来看函数逻辑，这里涉及到了命名空间的概念，默认情况下，模块内部的 `action`、`mutation` 和 `getter` 是注册在全局命名空间的——这样使得多个模块能够对同一 `mutation` 或 `action` 作出响应。如果我们希望模块具有更高的封装度和复用性，可以通过添加 `namespaced: true` 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 `getter`、`action` 及 `mutation` 都会自动根据模块注册的路径调整命名。例如：

```js
const store = new Vuex.Store({
  modules: {
    account: {
      namespaced: true,

      // 模块内容（module assets）
      state: { ... }, // 模块内的状态已经是嵌套的了，使用 `namespaced` 属性不会对其产生影响
      getters: {
        isAdmin () { ... } // -> getters['account/isAdmin']
      },
      actions: {
        login () { ... } // -> dispatch('account/login')
      },
      mutations: {
        login () { ... } // -> commit('account/login')
      },

      // 嵌套模块
      modules: {
        // 继承父模块的命名空间
        myPage: {
          state: { ... },
          getters: {
            profile () { ... } // -> getters['account/profile']
          }
        },

        // 进一步嵌套命名空间
        posts: {
          namespaced: true,

          state: { ... },
          getters: {
            popular () { ... } // -> getters['account/posts/popular']
          }
        }
      }
    }
  }
})
```

回到 `installModule` 方法，我们首先根据 `path` 获取 `namespace`：

```js
const namespace = store._modules.getNamespace(path)
```

`getNamespace` 的定义在 `src/module/module-collection.js` 中：

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```

从 `root module` 开始，通过 `reduce` 方法一层层找子模块，如果发现该模块配置了 `namespaced` 为 true，则把该模块的 `key` 拼到 `namesapce` 中，最终返回完整的 `namespace` 字符串。

回到 `installModule` 方法，接下来把 `namespace` 对应的模块保存下来，为了方便以后能根据 `namespace` 查找模块：

```js
if (module.namespaced) {
  store._modulesNamespaceMap[namespace] = module
}
```

接下来判断非 `root module` 且非 `hot` 的情况执行一些逻辑，我们稍后再看。

接着是很重要的逻辑，构造了一个本地上下文环境：

```js
const local = module.context = makeLocalContext(store, namespace, path)
```

来看一下 `makeLocalContext` 实现：

```js
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}
```

`makeLocalContext` 支持 3 个参数相关，`store` 表示 `root store`；`namespace` 表示模块的命名空间，`path` 表示模块的 `path`。

该方法定义了 `local` 对象，对于 `dispatch` 和 `commit` 方法，如果没有 `namespace`，它们就直接指向了 `root store` 的 `dispatch` 和 `commit` 方法，否则会创建方法，把 `type` 自动拼接上 `namespace`，然后执行 `store` 上对应的方法。

对于 `getters` 而言，如果没有 `namespace`，则直接返回 `root store` 的 `getters`，否则返回 `makeLocalGetters(store, namespace)` 的返回值：

```js
function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}
```

`makeLocalGetters` 首先获取了 `namespace` 的长度，然后遍历 `root store` 下的所有 `getters`，先判断它的类型是否匹配 `namespace`，只有匹配的时候我们从 `namespace` 的位置截取后面的字符串得到 `localType`，接着用 `Object.defineProperty` 定义了 `gettersProxy`，获取 `localType` 实际上是访问了 `store.getters[type]`。

回到 `makeLocalContext` 方法，再来看一下对 `state` 的实现，它的获取则是通过 `getNestedState(store.state, path)` 方法：

```js
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}
```

`getNestedState` 逻辑很简单，从 `root state` 开始，通过 `path.reduce` 方法一层层查找子模块 `state`，最终找到目标模块的 `state`。


那么构造完 `local` 上下文后，我们再回到 `installModule` 方法，接下来它就会遍历模块中定义的 `mutations`、`actions`、`getters`，分别执行它们的注册工作，它们的注册逻辑都大同小异。

- `registerMutation`

```js
module.forEachMutation((mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
})

function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```

首先遍历模块中的 `mutations` 的定义，拿到每一个 `mutation` 和 `key`，并把 `key` 拼接上 `namespace`，然后执行 `registerMutation` 方法。该方法实际上就是给 `root store` 上的 `_mutations[types]` 添加 `wrappedMutationHandler` 方法，该方法的具体实现我们之后会提到。注意，同一 `type` 的 `_mutations` 可以对应多个方法。

- `registerAction`
 
````js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})

function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```` 

首先遍历模块中的 `actions` 的定义，拿到每一个 `action` 和 `key`，并判断 `action.root`，如果否的情况把 `key` 拼接上 `namespace`，然后执行 `registerAction` 方法。该方法实际上就是给 `root store` 上的 `_actions[types]` 添加 `wrappedActionHandler` 方法，该方法的具体实现我们之后会提到。注意，同一 `type` 的 `_actions` 可以对应多个方法。

- `registerGetter`

```js
module.forEachGetter((getter, key) => {
  const namespacedType = namespace + key
  registerGetter(store, namespacedType, getter, local)
})


function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}
```

首先遍历模块中的 `getters` 的定义，拿到每一个 `getter` 和 `key`，并把 `key` 拼接上 `namespace`，然后执行 `registerGetter` 方法。该方法实际上就是给 `root store` 上的 `_wrappedGetters[key]` 指定 `wrappedGetter` 方法，该方法的具体实现我们之后会提到。注意，同一 `type` 的 `_wrappedGetters` 只能定义一个。

再回到 `installModule` 方法，最后一步就是遍历模块中的所有子 `modules`，递归执行 `installModule` 方法：

````js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
````

之前我们忽略了非 `root module` 下的 `state` 初始化逻辑，现在来看一下：

```js
if (!isRoot && !hot) {
  const parentState = getNestedState(rootState, path.slice(0, -1))
  const moduleName = path[path.length - 1]
  store._withCommit(() => {
    Vue.set(parentState, moduleName, module.state)
  })
}
```

之前我们提到过 `getNestedState` 方法，它是从 `root state` 开始，一层层根据模块名能访问到对应 `path` 的 `state`，那么它每一层关系的建立实际上就是通过这段 `state` 的初始化逻辑。`store._withCommit` 方法我们之后再介绍。

所以 `installModule` 实际上就是完成了模块下的 `state`、`getters`、`actions`、`mutations` 的初始化工作，并且通过递归遍历的方式，就完成了所有子模块的安装工作。

### 初始化 `store._vm`

`Store` 实例化的最后一步，就是执行初始化 `store._vm` 的逻辑，它的入口代码是：

```js
resetStoreVM(this, state)
```

来看一下 `resetStoreVM` 的定义：

```js
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
```

`resetStoreVM` 的作用实际上是想建立 `getters` 和 `state` 的联系，因为从设计上  `getters` 的获取就依赖了 `state` ，并且希望它的依赖能被缓存起来，且只有当它的依赖值发生了改变才会被重新计算。因此这里利用了 Vue 中用 `computed` 计算属性来实现。

`resetStoreVM` 首先遍历了 `_wrappedGetters` 获得每个 `getter` 的函数 `fn` 和 `key`，然后定义了 `computed[key] = () => fn(store)`。我们之前提到过 `_wrappedGetters` 的初始化过程，这里 `fn(store)` 相当于执行如下方法：

```js
store._wrappedGetters[type] = function wrappedGetter (store) {
  return rawGetter(
    local.state, // local state
    local.getters, // local getters
    store.state, // root state
    store.getters // root getters
  )
}
```

返回的就是 `rawGetter` 的执行函数，`rawGetter` 就是用户定义的 `getter` 函数，它的前 2 个参数是 `local state` 和 `local getters`，后 2 个参数是 `root state` 和 `root getters`。

接着实例化一个 Vue 实例 `store._vm`，并把 `computed` 传入：

```js
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
```

我们发现 `data` 选项里定义了 `$$state` 属性，而我们访问 `store.state` 的时候，实际上会访问 `Store` 类上定义的 `state` 的 `get` 方法：

```js
get state () {
  return this._vm._data.$$state
}
```

它实际上就访问了 `store._vm._data.$$state`。那么 `getters` 和 `state` 是如何建立依赖逻辑的呢，我们再看这段代码逻辑：

```js
forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    computed[key] = () => fn(store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })
```

当我根据 `key` 访问 `store.getters` 的某一个 `getter` 的时候，实际上就是访问了 `store._vm[key]`，也就是 `computed[key]`，在执行 `computed[key]` 对应的函数的时候，会执行 `rawGetter(local.state,...)` 方法，那么就会访问到 `store.state`，进而访问到 `store._vm._data.$$state`，这样就建立了一个依赖关系。当 `store.state` 发生变化的时候，下一次再访问 `store.getters` 的时候会重新计算。

我们再来看一下 `strict mode` 的逻辑：
 
```js
if (store.strict) {
  enableStrictMode(store)
}

function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `Do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}
```

当严格模式下，`store._vm` 会添加一个 `wathcer` 来观测 `this._data.$$state` 的变化，也就是当 `store.state` 被修改的时候, `store._committing` 必须为 true，否则在开发阶段会报警告。`store._committing` 默认值是 `false`，那么它什么时候会 true 呢，`Store` 定义了 `_withCommit` 实例方法：

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```

它就是对 `fn` 包装了一个环境，确保在 `fn` 中执行任何逻辑的时候 `this._committing = true`。所以外部任何非通过 Vuex 提供的接口直接操作修改 `state` 的行为都会在开发阶段触发警告。

## 总结

那么至此，Vuex 的初始化过程就分析完毕了，除了安装部分，我们重点分析了 `Store` 的实例化过程。我们要把 `store` 想象成一个数据仓库，为了更方便的管理仓库，我们把一个大的 `store` 拆成一些 `modules`，整个 `modules` 是一个树型结构。每个 `module` 又分别定义了 `state`，`getters`，`mutations`、`actions`，我们也通过递归遍历模块的方式都完成了它们的初始化。为了 `module` 具有更高的封装度和复用性，还定义了 `namespace` 的概念。最后我们还定义了一个内部的 `Vue` 实例，用来建立 `state` 到 `getters` 的联系，并且可以在严格模式下监测 `state` 的变化是不是来自外部，确保改变 `state` 的唯一途径就是显式地提交 `mutation`。

这一节我们已经建立好 `store`，接下来就是对外提供了一些 API 方便我们对这个 `store` 做数据存取的操作，下一节我们就来从源码角度来分析 `Vuex` 提供的一系列 API。