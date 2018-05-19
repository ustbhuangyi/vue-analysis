# optimize

当我们的模板 `template` 经过 `parse` 过程后，会输出生成 AST 树，那么接下来我们需要对这颗树做优化，`optimize` 的逻辑是远简单于 `parse` 的逻辑，所以理解起来会轻松很多。

为什么要有优化过程，因为我们知道 Vue 是数据驱动，是响应式的，但是我们的模板并不是所有数据都是响应式的，也有很多数据是首次渲染后就永远不会变化的，那么这部分数据生成的 DOM 也不会变化，我们可以在 `patch` 的过程跳过对他们的比对。

来看一下 `optimize` 方法的定义，在 `src/compiler/optimizer.js` 中：

```js
/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 */
export function optimize (root: ?ASTElement, options: CompilerOptions) {
  if (!root) return
  isStaticKey = genStaticKeysCached(options.staticKeys || '')
  isPlatformReservedTag = options.isReservedTag || no
  // first pass: mark all non-static nodes.
  markStatic(root)
  // second pass: mark static roots.
  markStaticRoots(root, false)
}

function genStaticKeys (keys: string): Function {
  return makeMap(
    'type,tag,attrsList,attrsMap,plain,parent,children,attrs' +
    (keys ? ',' + keys : '')
  )
}
```

我们在编译阶段可以把一些 AST 节点优化成静态节点，所以整个 `optimize` 的过程实际上就干 2 件事情，`markStatic(root)` 标记静态节点 ，`markStaticRoots(root, false)` 标记静态根。

## 标记静态节点

```js
function markStatic (node: ASTNode) {
  node.static = isStatic(node)
  if (node.type === 1) {
    // do not make component slot content static. this avoids
    // 1. components not able to mutate slot nodes
    // 2. static slot content fails for hot-reloading
    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== 'slot' &&
      node.attrsMap['inline-template'] == null
    ) {
      return
    }
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i]
      markStatic(child)
      if (!child.static) {
        node.static = false
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block
        markStatic(block)
        if (!block.static) {
          node.static = false
        }
      }
    }
  }
}

function isStatic (node: ASTNode): boolean {
  if (node.type === 2) { // expression
    return false
  }
  if (node.type === 3) { // text
    return true
  }
  return !!(node.pre || (
    !node.hasBindings && // no dynamic bindings
    !node.if && !node.for && // not v-if or v-for or v-else
    !isBuiltInTag(node.tag) && // not a built-in
    isPlatformReservedTag(node.tag) && // not a component
    !isDirectChildOfTemplateFor(node) &&
    Object.keys(node).every(isStaticKey)
  ))
}
```

首先执行 `node.static = isStatic(node)`

`isStatic` 是对一个 AST 元素节点是否是静态的判断，如果是表达式，就是非静态；如果是纯文本，就是静态；对于一个普通元素，如果有 pre 属性，那么它使用了 `v-pre` 指令，是静态，否则要同时满足以下条件：没有使用 `v-if`、`v-for`，没有使用其它指令（不包括 `v-once`），非内置组件，是平台保留的标签，非带有 `v-for` 的 `template` 标签的直接子节点，节点的所有属性的 `key` 都满足静态 key；这些都满足则这个 AST 节点是一个静态节点。

如果这个节点是一个普通元素，则遍历它的所有 `children`，递归执行 `markStatic`。因为所有的 `elseif` 和 `else` 节点都不在 `children` 中， 如果节点的 `ifConditions` 不为空，则遍历 `ifConditions` 拿到所有条件中的 `block`，也就是它们对应的 AST 节点，递归执行 `markStatic`。在这些递归过程中，一旦子节点有不是 `static` 的情况，则它的父节点的 `static` 均变成 false。

## 标记静态根

```js
function markStaticRoots (node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    if (node.static || node.once) {
      node.staticInFor = isInFor
    }
    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    if (node.static && node.children.length && !(
      node.children.length === 1 &&
      node.children[0].type === 3
    )) {
      node.staticRoot = true
      return
    } else {
      node.staticRoot = false
    }
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for)
      }
    }
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor)
      }
    }
  }
}
```

`markStaticRoots` 第二个参数是 `isInFor`，对于已经是 `static` 的节点或者是 `v-once` 指令的节点，`node.staticInFor = isInFor`。
接着就是对于 `staticRoot` 的判断逻辑，从注释中我们可以看到，对于有资格成为 `staticRoot` 的节点，除了本身是一个静态节点外，必须满足拥有 `children`，并且 `children` 不能只是一个文本节点，不然的话把它标记成静态根节点的收益就很小了。

接下来和标记静态节点的逻辑一样，遍历 `children` 以及 `ifConditions`，递归执行 `markStaticRoots`。

回归我们之前的例子，经过 `optimize` 后，AST 树变成了如下：

```js
ast = {
  'type': 1,
  'tag': 'ul',
  'attrsList': [],
  'attrsMap': {
    ':class': 'bindCls',
    'class': 'list',
    'v-if': 'isShow'
  },
  'if': 'isShow',
  'ifConditions': [{
    'exp': 'isShow',
    'block': // ul ast element
  }],
  'parent': undefined,
  'plain': false,
  'staticClass': 'list',
  'classBinding': 'bindCls',
  'static': false,
  'staticRoot': false,
  'children': [{
    'type': 1,
    'tag': 'li',
    'attrsList': [{
      'name': '@click',
      'value': 'clickItem(index)'
    }],
    'attrsMap': {
      '@click': 'clickItem(index)',
      'v-for': '(item,index) in data'
     },
    'parent': // ul ast element
    'plain': false,
    'events': {
      'click': {
        'value': 'clickItem(index)'
      }
    },
    'hasBindings': true,
    'for': 'data',
    'alias': 'item',
    'iterator1': 'index',
    'static': false,
    'staticRoot': false,
    'children': [
      'type': 2,
      'expression': '_s(item)+":"+_s(index)'
      'text': '{{item}}:{{index}}',
      'tokens': [
        {'@binding':'item'},
        ':',
        {'@binding':'index'}
      ],
      'static': false
    ]
  }]
}
```

我们发现每一个 AST 元素节点都多了 `staic` 属性，并且 `type` 为 1 的普通元素 AST 节点多了 `staticRoot` 属性。

## 总结

那么至此我们分析完了 `optimize` 的过程，就是深度遍历这个 AST 树，去检测它的每一颗子树是不是静态节点，如果是静态节点则它们生成 DOM 永远不需要改变，这对运行时对模板的更新起到极大的优化作用。

我们通过 `optimize` 我们把整个 AST 树中的每一个 AST 元素节点标记了 `static` 和 `staticRoot`，它会影响我们接下来执行代码生成的过程。