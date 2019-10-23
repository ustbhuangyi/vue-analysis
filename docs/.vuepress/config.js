module.exports = {
  base: '/vue-analysis/',
  dest: 'dist',
  title: 'Vue.js 技术揭秘',
  description: 'Analysis vue.js deeply',
  head: [
    ['link', { rel: 'icon', href: `/logo.png` }],
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['meta', { name: 'theme-color', content: '#3eaf7c' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' }],
    ['link', { rel: 'apple-touch-icon', href: `/icons/apple-touch-icon-152x152.png` }],
    ['link', { rel: 'mask-icon', href: '/icons/safari-pinned-tab.svg', color: '#3eaf7c' }],
    ['meta', { name: 'msapplication-TileImage', content: '/icons/msapplication-icon-144x144.png' }],
    ['meta', { name: 'msapplication-TileColor', content: '#000000' }]
  ],
  serviceWorker: false,
  themeConfig: {
    repo: 'ustbhuangyi/vue-analysis',
    editLinks: true,
    docsDir: 'docs',
    editLinkText: '在 GitHub 上编辑此页',
    lastUpdated: '上次更新',
    nav: [
      {
        text: '2.x 版本',
        link: '/v2/prepare/'
      },
      {
        text: '3.x 版本',
        link: '/v3/guide/'
      },
      {
        text: '配套视频',
        link: 'https://coding.imooc.com/class/228.html'
      }
    ],
    sidebar: {
      '/v2/': [
        {
          title: '准备工作',
          collapsable: false,
          children: [
            ['prepare/', 'Introduction'],
            'prepare/flow',
            'prepare/directory',
            'prepare/build',
            'prepare/entrance'
          ]
        },
        {
          title: '数据驱动',
          collapsable: false,
          children: [
            ['data-driven/', 'Introduction'],
            'data-driven/new-vue',
            'data-driven/mounted',
            'data-driven/render',
            'data-driven/virtual-dom',
            'data-driven/create-element',
            'data-driven/update'
          ]
        },
        {
          title: '组件化',
          collapsable: false,
          children: [
            ['components/', 'Introduction'],
            'components/create-component',
            'components/patch',
            'components/merge-option',
            'components/lifecycle',
            'components/component-register',
            'components/async-component'
          ]
        },
        {
          title: '深入响应式原理',
          collapsable: false,
          children: [
            ['reactive/', 'Introduction'],
            'reactive/reactive-object',
            'reactive/getters',
            'reactive/setters',
            'reactive/next-tick',
            'reactive/questions',
            'reactive/computed-watcher',
            'reactive/component-update',
            'reactive/summary'
          ]
        },
        {
          title: '编译',
          collapsable: false,
          children: [
            ['compile/', 'Introduction'],
            'compile/entrance',
            'compile/parse',
            'compile/optimize',
            'compile/codegen'
          ]
        },
        {
          title: '扩展',
          collapsable: false,
          children: [
            ['extend/', 'Introduction'],
            'extend/event',
            'extend/v-model',
            'extend/slot',
            'extend/keep-alive',
            'extend/tansition',
            'extend/tansition-group'
          ]
        },
        {
          title: 'Vue Router',
          collapsable: false,
          children: [
            ['vue-router/', 'Introduction'],
            'vue-router/install',
            'vue-router/router',
            'vue-router/matcher',
            'vue-router/transition-to'
          ]
        },
        {
          title: 'Vuex',
          collapsable: false,
          children: [
            ['vuex/', 'Introduction'],
            'vuex/init',
            'vuex/api',
            'vuex/plugin'
          ]
        }
      ],
      '/v3/': [
        {
          title: '先导篇',
          collapsable: false,
          children: [
            ['guide/', 'Introduction']
          ]
        }
      ]
    }
  }
}
