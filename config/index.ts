import { defineConfig } from '@tarojs/cli'

export default defineConfig({
  projectName: 'minigba',
  date: '2026-07-28',
  designWidth: 750,
  deviceRatio: { 750: 1 },
  sourceRoot: 'src',
  outputRoot: 'dist',
  copy: {
    patterns: [
      { from: 'src/assets/minigba-core.wasm', to: 'dist/player/assets/minigba-core.wasm' },
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
