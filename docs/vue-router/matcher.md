# matcher

`matcher` 相关的实现都在 `src/create-matcher.js` 中，我们先来看一下 `matcher` 的数据结构：

```js
export type Matcher = {
  match: (raw: RawLocation, current?: Route, redirectedFrom?: Location) => Route;
  addRoutes: (routes: Array<RouteConfig>) => void;
};
```

`Matcher` 返回了 2 个方法，`match` 和 `addRoutes`，在上一节我们接触到了 `match` 方法，顾名思义它是做匹配，那么匹配的是什么，在介绍之前，我们先了解路由中重要的 2 个概念，`Loaction` 和 `Route`，它们的数据结构定义在 `flow/declarations.js` 中。

- Location

```js
declare type Location = {
  _normalized?: boolean;
  name?: string;
  path?: string;
  hash?: string;
  query?: Dictionary<string>;
  params?: Dictionary<string>;
  append?: boolean;
  replace?: boolean;
}
```

Vue-Router 中定义的 `Location` 数据结构和浏览器提供的 `window.location` 部分结构有点类似，它们都是对 `url` 的结构化描述。举个例子：`/abc?foo=bar&baz=qux#hello`，它的 `path` 是 `/abc`，`query` 是 `{foo:'bar',baz:'qux'}`。`Location` 的其他属性我们之后会介绍。
 
- Route

```js
declare type Route = {
  path: string;
  name: ?string;
  hash: string;
  query: Dictionary<string>;
  params: Dictionary<string>;
  fullPath: string;
  matched: Array<RouteRecord>;
  redirectedFrom?: string;
  meta?: any;
}
```

`Route` 表示的是路由中的一条线路，它除了描述了类似 `Loctaion` 的 `path`、`query`、`hash` 这些概念，还有 `matched` 表示匹配到的所有的 `RouteRecord`。`Route` 的其他属性我们之后会介绍。

## `createMatcher`

在了解了 `Location` 和 `Route` 后，我们来看一下 `matcher` 的创建过程：

```js
export function createMatcher (
  routes: Array<RouteConfig>,
  router: VueRouter
): Matcher {
  const { pathList, pathMap, nameMap } = createRouteMap(routes)

  function addRoutes (routes) {
    createRouteMap(routes, pathList, pathMap, nameMap)
  }

  function match (
    raw: RawLocation,
    currentRoute?: Route,
    redirectedFrom?: Location
  ): Route {
    const location = normalizeLocation(raw, currentRoute, false, router)
    const { name } = location

    if (name) {
      const record = nameMap[name]
      if (process.env.NODE_ENV !== 'production') {
        warn(record, `Route with name '${name}' does not exist`)
      }
      if (!record) return _createRoute(null, location)
      const paramNames = record.regex.keys
        .filter(key => !key.optional)
        .map(key => key.name)

      if (typeof location.params !== 'object') {
        location.params = {}
      }

      if (currentRoute && typeof currentRoute.params === 'object') {
        for (const key in currentRoute.params) {
          if (!(key in location.params) && paramNames.indexOf(key) > -1) {
            location.params[key] = currentRoute.params[key]
          }
        }
      }

      if (record) {
        location.path = fillParams(record.path, location.params, `named route "${name}"`)
        return _createRoute(record, location, redirectedFrom)
      }
    } else if (location.path) {
      location.params = {}
      for (let i = 0; i < pathList.length; i++) {
        const path = pathList[i]
        const record = pathMap[path]
        if (matchRoute(record.regex, location.path, location.params)) {
          return _createRoute(record, location, redirectedFrom)
        }
      }
    }
    return _createRoute(null, location)
  }

  // ...

  function _createRoute (
    record: ?RouteRecord,
    location: Location,
    redirectedFrom?: Location
  ): Route {
    if (record && record.redirect) {
      return redirect(record, redirectedFrom || location)
    }
    if (record && record.matchAs) {
      return alias(record, location, record.matchAs)
    }
    return createRoute(record, location, redirectedFrom, router)
  }

  return {
    match,
    addRoutes
  }
}
```

`createMatcher` 接收 2 个参数，一个是 `router`，它是我们 `new VueRouter` 返回的实例，一个是 `routes`，它是用户定义的路由配置，来看一下我们之前举的例子中的配置：

```js
const Foo = { template: '<div>foo</div>' }
const Bar = { template: '<div>bar</div>' }

const routes = [
  { path: '/foo', component: Foo },
  { path: '/bar', component: Bar }
]
```

`createMathcer` 首先执行的逻辑是 `const { pathList, pathMap, nameMap } = createRouteMap(routes)` 创建一个路由映射表，`createRouteMap` 的定义在 `src/create-route-map` 中：

```js
export function createRouteMap (
  routes: Array<RouteConfig>,
  oldPathList?: Array<string>,
  oldPathMap?: Dictionary<RouteRecord>,
  oldNameMap?: Dictionary<RouteRecord>
): {
  pathList: Array<string>;
  pathMap: Dictionary<RouteRecord>;
  nameMap: Dictionary<RouteRecord>;
} {
  const pathList: Array<string> = oldPathList || []
  const pathMap: Dictionary<RouteRecord> = oldPathMap || Object.create(null)
  const nameMap: Dictionary<RouteRecord> = oldNameMap || Object.create(null)

  routes.forEach(route => {
    addRouteRecord(pathList, pathMap, nameMap, route)
  })

  for (let i = 0, l = pathList.length; i < l; i++) {
    if (pathList[i] === '*') {
      pathList.push(pathList.splice(i, 1)[0])
      l--
      i--
    }
  }

  return {
    pathList,
    pathMap,
    nameMap
  }
}

```

`createRouteMap` 函数的目标是把用户的路由配置转换成一张路由映射表，它包含 3 个部分，`pathList` 存储所有的 `path`，`pathMap` 表示一个 `path` 到 `RouteRecord` 的映射关系，而 `nameMap` 表示 `name` 到 `RouteRecord` 的映射关系。那么 `RouteRecord` 到底是什么，先来看一下它的数据结构：

```js
declare type RouteRecord = {
  path: string;
  regex: RouteRegExp;
  components: Dictionary<any>;
  instances: Dictionary<any>;
  name: ?string;
  parent: ?RouteRecord;
  redirect: ?RedirectOption;
  matchAs: ?string;
  beforeEnter: ?NavigationGuard;
  meta: any;
  props: boolean | Object | Function | Dictionary<boolean | Object | Function>;
}
```

它的创建是通过遍历 `routes` 为每一个 `route` 执行 `addRouteRecord` 方法生成一条记录，来看一下它的定义：

```js
function addRouteRecord (
  pathList: Array<string>,
  pathMap: Dictionary<RouteRecord>,
  nameMap: Dictionary<RouteRecord>,
  route: RouteConfig,
  parent?: RouteRecord,
  matchAs?: string
) {
  const { path, name } = route
  if (process.env.NODE_ENV !== 'production') {
    assert(path != null, `"path" is required in a route configuration.`)
    assert(
      typeof route.component !== 'string',
      `route config "component" for path: ${String(path || name)} cannot be a ` +
      `string id. Use an actual component instead.`
    )
  }

  const pathToRegexpOptions: PathToRegexpOptions = route.pathToRegexpOptions || {}
  const normalizedPath = normalizePath(
    path,
    parent,
    pathToRegexpOptions.strict
  )

  if (typeof route.caseSensitive === 'boolean') {
    pathToRegexpOptions.sensitive = route.caseSensitive
  }

  const record: RouteRecord = {
    path: normalizedPath,
    regex: compileRouteRegex(normalizedPath, pathToRegexpOptions),
    components: route.components || { default: route.component },
    instances: {},
    name,
    parent,
    matchAs,
    redirect: route.redirect,
    beforeEnter: route.beforeEnter,
    meta: route.meta || {},
    props: route.props == null
      ? {}
      : route.components
        ? route.props
        : { default: route.props }
  }

  if (route.children) {
    if (process.env.NODE_ENV !== 'production') {
      if (route.name && !route.redirect && route.children.some(child => /^\/?$/.test(child.path))) {
        warn(
          false,
          `Named Route '${route.name}' has a default child route. ` +
          `When navigating to this named route (:to="{name: '${route.name}'"), ` +
          `the default child route will not be rendered. Remove the name from ` +
          `this route and use the name of the default child route for named ` +
          `links instead.`
        )
      }
    }
    route.children.forEach(child => {
      const childMatchAs = matchAs
        ? cleanPath(`${matchAs}/${child.path}`)
        : undefined
      addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
    })
  }

  if (route.alias !== undefined) {
    const aliases = Array.isArray(route.alias)
      ? route.alias
      : [route.alias]

    aliases.forEach(alias => {
      const aliasRoute = {
        path: alias,
        children: route.children
      }
      addRouteRecord(
        pathList,
        pathMap,
        nameMap,
        aliasRoute,
        parent,
        record.path || '/'
      )
    })
  }

  if (!pathMap[record.path]) {
    pathList.push(record.path)
    pathMap[record.path] = record
  }

  if (name) {
    if (!nameMap[name]) {
      nameMap[name] = record
    } else if (process.env.NODE_ENV !== 'production' && !matchAs) {
      warn(
        false,
        `Duplicate named routes definition: ` +
        `{ name: "${name}", path: "${record.path}" }`
      )
    }
  }
}
```

我们只看几个关键逻辑，首先创建 `RouteRecord` 的代码如下：

```js
 const record: RouteRecord = {
  path: normalizedPath,
  regex: compileRouteRegex(normalizedPath, pathToRegexpOptions),
  components: route.components || { default: route.component },
  instances: {},
  name,
  parent,
  matchAs,
  redirect: route.redirect,
  beforeEnter: route.beforeEnter,
  meta: route.meta || {},
  props: route.props == null
    ? {}
    : route.components
      ? route.props
      : { default: route.props }
}
``` 

这里要注意几个点，`path` 是规范化后的路径，它会根据 `parent` 的 `path` 做计算；`regex` 是一个正则表达式的扩展，它利用了`path-to-regexp` 这个工具库，把 `path` 解析成一个正则表达式的扩展，举个例子：
 
```js
var keys = []
var re = pathToRegexp('/foo/:bar', keys)
// re = /^\/foo\/([^\/]+?)\/?$/i
// keys = [{ name: 'bar', prefix: '/', delimiter: '/', optional: false, repeat: false, pattern: '[^\\/]+?' }]
```
 
 `components` 是一个对象，通常我们在配置中写的 `component` 实际上这里会被转换成 `{components: route.component}`；`instances` 表示组件的实例，也是一个对象类型；`parent` 表示父的 `RouteRecord`，因为我们配置的时候有时候会配置子路由，所以整个 `RouteRecord` 也就是一个树型结构。

```js
if (route.children) {
  // ...
  route.children.forEach(child => {
  const childMatchAs = matchAs
    ? cleanPath(`${matchAs}/${child.path}`)
    : undefined
  addRouteRecord(pathList, pathMap, nameMap, child, record, childMatchAs)
})
}
```

如果配置了 `children`，那么递归执行 `addRouteRecord` 方法，并把当前的 `record` 作为 `parent` 传入，通过这样的深度遍历，我们就可以拿到一个 `route` 下的完整记录。

```js
if (!pathMap[record.path]) {
  pathList.push(record.path)
  pathMap[record.path] = record
}
```

为 `pathList` 和 `pathMap` 各添加一条记录。

```js
if (name) {
  if (!nameMap[name]) {
    nameMap[name] = record
  }
  // ...
}
```

如果我们在路由配置中配置了 `name`，则给 `nameMap` 添加一条记录。

由于 `pathList`、`pathMap`、`nameMap` 都是引用类型，所以在遍历整个 `routes` 过程中去执行 `addRouteRecord` 方法，会不断给他们添加数据。那么经过整个 `createRouteMap` 方法的执行，我们得到的就是 `pathList`、`pathMap` 和 `nameMap`。其中 `pathList` 是为了记录路由配置中的所有 `path`，而 `pathMap` 和 `nameMap` 都是为了通过 `path` 和 `name` 能快速查到对应的 `RouteRecord`。

再回到 `createMatcher` 函数，接下来就定义了一系列方法，最后返回了一个对象。

```js
return {
  match,
  addRoutes
}
```

也就是说，`matcher` 是一个对象，它对外暴露了 `match` 和 `addRoutes` 方法。
 
## addRoutes

`addRoutes` 方法的作用是动态添加路由配置，因为在实际开发中有些场景是不能提前把路由写死的，需要根据一些条件动态添加路由，所以 Vue-Router 也提供了这一接口：

```js
function addRoutes (routes) {
  createRouteMap(routes, pathList, pathMap, nameMap)
}
```

`addRoutes` 的方法十分简单，再次调用 `createRouteMap` 即可，传入新的 `routes` 配置，由于 `pathList`、`pathMap`、`nameMap` 都是引用类型，执行 `addRoutes` 后会修改它们的值。

## match

```js
function match (
  raw: RawLocation,
  currentRoute?: Route,
  redirectedFrom?: Location
): Route {
  const location = normalizeLocation(raw, currentRoute, false, router)
  const { name } = location

  if (name) {
    const record = nameMap[name]
    if (process.env.NODE_ENV !== 'production') {
      warn(record, `Route with name '${name}' does not exist`)
    }
    if (!record) return _createRoute(null, location)
    const paramNames = record.regex.keys
      .filter(key => !key.optional)
      .map(key => key.name)

    if (typeof location.params !== 'object') {
      location.params = {}
    }

    if (currentRoute && typeof currentRoute.params === 'object') {
      for (const key in currentRoute.params) {
        if (!(key in location.params) && paramNames.indexOf(key) > -1) {
          location.params[key] = currentRoute.params[key]
        }
      }
    }

    if (record) {
      location.path = fillParams(record.path, location.params, `named route "${name}"`)
      return _createRoute(record, location, redirectedFrom)
    }
  } else if (location.path) {
    location.params = {}
    for (let i = 0; i < pathList.length; i++) {
      const path = pathList[i]
      const record = pathMap[path]
      if (matchRoute(record.regex, location.path, location.params)) {
        return _createRoute(record, location, redirectedFrom)
      }
    }
  }
  
  return _createRoute(null, location)
}
```

`match` 方法接收 3 个参数，其中 `raw` 是 `RawLocation` 类型，它可以是一个 `url` 字符串，也可以是一个 `Location` 对象；`currentRoute` 是 `Route` 类型，它表示当前的路径；`redirectedFrom` 和重定向相关，这里先忽略。`match` 方法返回的是一个路径，它的作用是根据传入的 `raw` 和当前的路径 `currentRoute` 计算出一个新的路径并返回。
 
 首先执行了 `normalizeLocation`，它的定义在 `src/util/location.js` 中：
 
```js
export function normalizeLocation (
  raw: RawLocation,
  current: ?Route,
  append: ?boolean,
  router: ?VueRouter
): Location {
  let next: Location = typeof raw === 'string' ? { path: raw } : raw
  if (next.name || next._normalized) {
    return next
  }

  if (!next.path && next.params && current) {
    next = assign({}, next)
    next._normalized = true
    const params: any = assign(assign({}, current.params), next.params)
    if (current.name) {
      next.name = current.name
      next.params = params
    } else if (current.matched.length) {
      const rawPath = current.matched[current.matched.length - 1].path
      next.path = fillParams(rawPath, params, `path ${current.path}`)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(false, `relative params navigation requires a current route.`)
    }
    return next
  }

  const parsedPath = parsePath(next.path || '')
  const basePath = (current && current.path) || '/'
  const path = parsedPath.path
    ? resolvePath(parsedPath.path, basePath, append || next.append)
    : basePath

  const query = resolveQuery(
    parsedPath.query,
    next.query,
    router && router.options.parseQuery
  )

  let hash = next.hash || parsedPath.hash
  if (hash && hash.charAt(0) !== '#') {
    hash = `#${hash}`
  }

  return {
    _normalized: true,
    path,
    query,
    hash
  }
}
```

`normalizeLocation` 方法的作用是根据 `raw`，`current` 计算出新的 `location`，它主要处理了 `raw` 的两种情况，一种是有 `params` 且没有 `path`，一种是有 `path` 的，对于第一种情况，如果 `current` 有 `name`，则计算出的 `location` 也有 `name`。
 
 计算出新的 `location` 后，对 `location` 的 `name` 和 `path` 的两种情况做了处理。
 
 - `name`
 
有 `name` 的情况下就根据 `nameMap` 匹配到 `record`，它就是一个 `RouterRecord` 对象，如果 `record` 不存在，则匹配失败，返回一个空路径；然后拿到 `record` 对应的 `paramNames`，再对比 `currentRoute` 中的 `params`，把交集部分的 `params` 添加到 `location` 中，然后在通过 `fillParams` 方法根据 `record.path` 和 `location.path` 计算出 `location.path`，最后调用 `_createRoute(record, location, redirectedFrom)` 去生成一条新路径，该方法我们之后会介绍。

- `path`

通过 `name` 我们可以很快的找到 `record`，但是通过 `path` 并不能，因为我们计算后的 `location.path` 是一个真实路径，而 `record` 中的 `path` 可能会有 `param`，因此需要对所有的 `pathList` 做顺序遍历， 然后通过 `matchRoute` 方法根据 `record.regex`、`location.path`、`location.params` 匹配，如果匹配到则也通过 `_createRoute(record, location, redirectedFrom)` 去生成一条新路径。因为是顺序遍历，所以我们书写路由配置要注意路径的顺序，因为写在前面的会优先尝试匹配。
 
最后我们来看一下 `_createRoute` 的实现：

```js
function _createRoute (
  record: ?RouteRecord,
  location: Location,
  redirectedFrom?: Location
): Route {
  if (record && record.redirect) {
    return redirect(record, redirectedFrom || location)
  }
  if (record && record.matchAs) {
    return alias(record, location, record.matchAs)
  }
  return createRoute(record, location, redirectedFrom, router)
}
```

我们先不考虑 `record.redirect` 和 `record.matchAs` 的情况，最终会调用 `createRoute` 方法，它的定义在 `src/uitl/route.js` 中：
 
```js
export function createRoute (
  record: ?RouteRecord,
  location: Location,
  redirectedFrom?: ?Location,
  router?: VueRouter
): Route {
  const stringifyQuery = router && router.options.stringifyQuery

  let query: any = location.query || {}
  try {
    query = clone(query)
  } catch (e) {}

  const route: Route = {
    name: location.name || (record && record.name),
    meta: (record && record.meta) || {},
    path: location.path || '/',
    hash: location.hash || '',
    query,
    params: location.params || {},
    fullPath: getFullPath(location, stringifyQuery),
    matched: record ? formatMatch(record) : []
  }
  if (redirectedFrom) {
    route.redirectedFrom = getFullPath(redirectedFrom, stringifyQuery)
  }
  return Object.freeze(route)
}
```

`createRoute` 可以根据 `record` 和 `location` 创建出来，最终返回的是一条 `Route` 路径，我们之前也介绍过它的数据结构。在 Vue-Router 中，所有的 `Route` 最终都会通过 `createRoute` 函数创建，并且它最后是不可以被外部修改的。`Route` 对象中有一个非常重要属性是 `matched`，它通过 `formatMatch(record)` 计算而来：

```js
function formatMatch (record: ?RouteRecord): Array<RouteRecord> {
  const res = []
  while (record) {
    res.unshift(record)
    record = record.parent
  }
  return res
}
```

可以看它是通过 `record` 循环向上找 `parent`，直到找到最外层，并把所有的 `record` 都 push 到一个数组中，最终返回的就是 `record` 的数组，它记录了一条线路上的所有 `record`。`matched` 属性非常有用，它为之后渲染组件提供了依据。

## 总结

那么到此，`matcher` 相关的主流程的分析就结束了，我们了解了 `Location`、`Route`、`RouteRecord` 等概念。并通过 `matcher` 的 `match` 方法，我们会找到匹配的路径 `Route`，这个对 `Route` 的切换，组件的渲染都有非常重要的指导意义。下一节我们会回到 `transitionTo` 方法，看一看路径的切换都做了哪些事情。