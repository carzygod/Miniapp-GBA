import { defineConfig } from '@tarojs/cli'
import {resolveRomDownloadHosts} from './rom-download-hosts'

const isDouyin=process.env.TARO_ENV==='tt'
const outputRoot=isDouyin?'dist-douyin':'dist'

export default defineConfig({
  projectName: 'minigba',
  date: '2026-07-28',
  defineConstants: {
    __MINIGBA_API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL ?? ''),
    __MINIGBA_ROM_CATALOG_URL__: JSON.stringify(process.env.TARO_APP_ROM_CATALOG_URL ?? ''),
    __MINIGBA_ROM_CATALOG_REMOTE_ENABLED__: JSON.stringify(process.env.TARO_APP_ROM_CATALOG_REMOTE_ENABLED ?? 'false'),
    __MINIGBA_ROM_DOWNLOAD_HOSTS__: JSON.stringify(resolveRomDownloadHosts(process.env.TARO_APP_ROM_DOWNLOAD_HOSTS)),
    __MINIGBA_PLATFORM__: JSON.stringify(isDouyin?'tt':'weapp'),
  },
  designWidth: 750,
  deviceRatio: { 750: 1 },
  sourceRoot: 'src',
  outputRoot,
  copy: {
    patterns: [
      { from: 'src/assets/minigba-core.wasm', to: `${outputRoot}/player/assets/minigba-core.wasm` },
      { from: 'src/assets/tabbar', to: `${outputRoot}/assets/tabbar` },
    ],
    options: {},
  },
  plugins: ['@tarojs/plugin-framework-react'],
  framework: 'react',
  compiler: 'webpack5',
  cache: { enable: true },
  mini: {
    postcss: {
      pxtransform: { enable: true },
      url: { enable: true, config: { limit: 1024 } },
      cssModules: { enable: false },
    },
    webpackChain(chain) {
      chain.merge({
        module: {
          rule: {
            wasmAsset: {
              test: /\.wasm$/,
              type: 'asset/resource',
              generator: { filename: 'assets/[name][ext]' },
            },
          },
        },
      })
    },
  },
})
