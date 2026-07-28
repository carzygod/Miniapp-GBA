export default defineAppConfig({
  pages: [
    'pages/library/index',
    'pages/saves/index',
    'pages/settings/index',
  ],
  subPackages: [
    { root: 'player', pages: ['index'] },
  ],
  window: {
    backgroundColor: '#101415',
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#101415',
    navigationBarTextStyle: 'white',
    navigationBarTitleText: 'MiniGBA',
  },
  tabBar: {
    color: '#899590',
    selectedColor: '#16a99b',
    backgroundColor: '#141a1b',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/library/index', text: '游戏库' },
      { pagePath: 'pages/saves/index', text: '存档' },
      { pagePath: 'pages/settings/index', text: '设置' },
    ],
  },
})
