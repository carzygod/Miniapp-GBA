export default defineAppConfig({
  pages: [
    'pages/library/index',
    'pages/game/index',
    'pages/saves/index',
    'pages/settings/index',
    'pages/storage/index',
    'pages/diagnostics/index',
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
      { pagePath: 'pages/library/index', text: '游玩', iconPath: 'assets/tabbar/game.png', selectedIconPath: 'assets/tabbar/game-active.png' },
      { pagePath: 'pages/saves/index', text: '存档', iconPath: 'assets/tabbar/saves.png', selectedIconPath: 'assets/tabbar/saves-active.png' },
      { pagePath: 'pages/settings/index', text: '设置', iconPath: 'assets/tabbar/settings.png', selectedIconPath: 'assets/tabbar/settings-active.png' },
    ],
  },
})
