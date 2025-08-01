let t = require('@babel/core').types;
let prebid = require('../package.json');
const path = require('path');
const {buildOptions} = require('./buildOptions.js');
const FEATURES_GLOBAL = 'FEATURES';

module.exports = function(api, options) {
  const {features, distUrlBase, skipCalls} = buildOptions(options);

  let replace = {
    '$prebid.version$': prebid.version,
    '$$PREBID_GLOBAL$$': false,
    '$$DEFINE_PREBID_GLOBAL$$': false,
    '$$REPO_AND_VERSION$$': `${prebid.repository.url.split('/')[3]}_prebid_${prebid.version}`,
    '$$PREBID_DIST_URL_BASE$$': false,
    '$$LIVE_INTENT_MODULE_MODE$$': (process && process.env && process.env.LiveConnectMode) || 'standard'
  };

  let identifierToStringLiteral = [
    '$$REPO_AND_VERSION$$'
  ];

  const PREBID_ROOT = path.resolve(__dirname, '..');
  // on Windows, require paths are not filesystem paths
  const SEP_PAT = new RegExp(path.sep.replace(/\\/g, '\\\\'), 'g')

  function relPath(from, toRelToProjectRoot) {
    return path.relative(path.dirname(from), path.join(PREBID_ROOT, toRelToProjectRoot)).replace(SEP_PAT, '/');
  }

  function getModuleName(filename) {
    const modPath = path.parse(path.relative(PREBID_ROOT, filename));
    if (!['.ts', '.js'].includes(modPath.ext.toLowerCase())) {
      return null;
    }
    if (modPath.dir === 'modules') {
      // modules/moduleName.js -> moduleName
      return modPath.name;
    }
    if (modPath.name.toLowerCase() === 'index' && path.dirname(modPath.dir) === 'modules') {
      // modules/moduleName/index.js -> moduleName
      return path.basename(modPath.dir);
    }
    return null;
  }

  function translateToJs(path, state) {
    if (path.node.source?.value?.endsWith('.ts')) {
      path.node.source.value = path.node.source.value.replace(/\.ts$/, '.js');
    }
  }

  function checkMacroAllowed(name) {
    if (replace[name] === false) {
      throw new Error(`The macro ${name} should no longer be used; look for a replacement in src/buildOptions.ts`)
    }
  }

  return {
    visitor: {
      Program(path, state) {
        const modName = getModuleName(state.filename);
        if (modName != null) {
          // append "registration" of module file to getGlobal().installedModules
          let i = 0;
          let registerName;
          do {
            registerName = `__r${i++}`
          } while (path.scope.hasBinding(registerName))
          path.node.body.unshift(...api.parse(`import {registerModule as ${registerName}} from '${relPath(state.filename, 'src/prebidGlobal.js')}';`, {filename: state.filename}).program.body);
          path.node.body.push(...api.parse(`${registerName}('${modName}');`, {filename: state.filename}).program.body);
        }
      },
      ImportDeclaration: translateToJs,
      ExportDeclaration: translateToJs,
      StringLiteral(path, state) {
        Object.keys(replace).forEach(name => {
          if (path.node.value.includes(name)) {
            checkMacroAllowed(name);
            path.node.value = path.node.value.replace(
              new RegExp(escapeRegExp(name), 'g'),
              replace[name].toString()
            );
          }
        });
      },
      TemplateLiteral(path, state) {
        path.traverse({
          TemplateElement(path) {
            Object.keys(replace).forEach(name => {
              ['raw', 'cooked'].forEach(type => {
                if (path.node.value[type].includes(name)) {
                  checkMacroAllowed(name);
                  path.node.value[type] = path.node.value[type].replace(
                    new RegExp(escapeRegExp(name), 'g'),
                    replace[name]
                  );
                }
              });
            });
          }
        });
      },
      Identifier(path, state) {
        Object.keys(replace).forEach(name => {
          if (path.node.name === name) {
            checkMacroAllowed(name);
            if (identifierToStringLiteral.includes(name)) {
              path.replaceWith(
                t.StringLiteral(replace[name])
              );
            } else {
              path.replaceWith(
                t.Identifier(replace[name].toString())
              );
            }
          }
        });
      },
      MemberExpression(path) {
        if (
          t.isIdentifier(path.node.object) &&
          path.node.object.name === FEATURES_GLOBAL &&
          !path.scope.hasBinding(FEATURES_GLOBAL) &&
          t.isIdentifier(path.node.property) &&
          features.hasOwnProperty(path.node.property.name)
        ) {
          path.replaceWith(t.booleanLiteral(features[path.node.property.name]));
        }
      },
      CallExpression(path) {
        if (
              // direct calls, e.g. logMessage()
              t.isIdentifier(path.node.callee) &&
              skipCalls.has(path.node.callee.name) ||

              // Member expression calls, e.g. utils.logMessage()
              t.isMemberExpression(path.node.callee) &&
              t.isIdentifier(path.node.callee.property) &&
              skipCalls.has(path.node.callee.property.name)
        ) {
          if (t.isExpressionStatement(path.parent)) {
            path.parentPath.remove();
          } else {
            // Fallback to undefined if it's used as part of a larger expression
            path.replaceWith(t.identifier('undefined'));
          }
          path.skip(); // Prevent further traversal
        }
      }
    }
  };
};

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
