// @flow
const resolve = require('rollup-plugin-node-resolve')
const { uglify } = require('rollup-plugin-uglify')
const babel = require('rollup-plugin-babel')
const alias = require('rollup-plugin-alias')
const cjs = require('rollup-plugin-commonjs')
const replace = require('rollup-plugin-replace')
const lernaAliases = require('lerna-alias').rollup

// this makes sure nested imports of external packages are external
const makeExternalPredicate = externalArr => {
  if (externalArr.length === 0) {
    return () => false
  }
  const pattern = new RegExp(`^(${externalArr.join('|')})($|/)`)
  return (id /*: string */) => pattern.test(id)
}

let unsafeRequire = require

function getChildPeerDeps(finalPeerDeps, depKeys) {
  depKeys.forEach(key => {
    const pkgJson = unsafeRequire(key + '/package.json')
    if (pkgJson.peerDependencies) {
      finalPeerDeps.push(...Object.keys(pkgJson.peerDependencies))
      getChildPeerDeps(finalPeerDeps, Object.keys(pkgJson.peerDependencies))
    }
    // if (pkgJson.dependencies) {
    //   getChildPeerDeps(finalPeerDeps, Object.keys(pkgJson.dependencies))
    // }
  })
}

/*::

import type { Package } from './types'
*/
module.exports = (
  data /*: Package */,
  {
    isUMD = false,
    isBrowser = false,
    isPreact = false
  } /*: { isUMD:boolean, isBrowser:boolean, isPreact:boolean } */ = {}
) => {
  const { pkg } = data
  let external = []
  if (pkg.peerDependencies) {
    external.push(...Object.keys(pkg.peerDependencies))
  }
  if (pkg.dependencies && !isUMD) {
    external.push(...Object.keys(pkg.dependencies))
  }
  getChildPeerDeps(external, external)
  external.push('fs', 'path')
  if (data.name === 'react-emotion' || data.name === 'preact-emotion') {
    external = external.filter(name => name !== 'emotion')
  }
  let packageAliases = lernaAliases()
  if (external.includes('@emotion/preact-core')) {
    packageAliases['@emotion/core'] = '@emotion/preact-core'
  }
  if (external.includes('@emotion/preact-styled-base')) {
    packageAliases['@emotion/styled-base'] = '@emotion/preact-styled-base'
  }

  const config = {
    input: data.input,
    external: makeExternalPredicate(external),
    plugins: [
      babel({
        presets: [
          [
            '@babel/env',
            {
              loose: true,
              modules: false,
              exclude: ['transform-typeof-symbol']
            }
          ],
          '@babel/react',
          '@babel/flow'
        ],
        plugins: [
          '@babel/plugin-transform-flow-strip-types',
          require('./add-basic-constructor-to-react-component'),
          'codegen',
          ['@babel/proposal-class-properties', { loose: true }],
          require('./fix-dce-for-classes-with-statics'),
          isBrowser && require('./inline-isBrowser'),
          ['@babel/plugin-proposal-object-rest-spread', { loose: true }]
        ].filter(Boolean),
        configFile: false,
        overrides: [
          {
            test: filename => filename.includes('utils/src'),
            plugins: [
              isBrowser &&
                (babel => {
                  let t = babel.types
                  return {
                    // for @emotion/utils
                    visitor: {
                      VariableDeclarator(path, state) {
                        if (t.isIdentifier(path.node.id)) {
                          if (path.node.id.name === 'isBrowser') {
                            path.get('init').replaceWith(t.booleanLiteral(true))
                          }
                        }
                      },
                      ReferencedIdentifier(path, node) {
                        if (path.node.name === 'isBrowser') {
                          path.replaceWith(t.booleanLiteral(true))
                        }
                      }
                    }
                  }
                })
            ].filter(Boolean)
          }
        ],
        babelrc: false
      }),
      cjs(),
      (isUMD || isPreact) && alias(packageAliases),
      isPreact &&
        alias({ react: require.resolve('emotion-react-mock-for-preact') }),
      isUMD && resolve(),
      replace({
        ...(isUMD ? { 'process.env.NODE_ENV': '"production"' } : {}),
        'process.env.PREACT': isPreact ? 'true' : 'false'
      }),
      isUMD && uglify()
    ].filter(Boolean)
  }

  return config
}