/* karma.conf.js — Angular unit tests. This file was missing (the project had
 * karma deps but no config), so `ng test` could not run. It mirrors the config
 * the Angular CLI schematic generates (@angular-devkit/build-angular plugins/karma
 * provides the `@angular-devkit/build-angular` framework in Angular 19.2). No
 * second browser/realtime arch is introduced: tests run in a single headless
 * Chromium/Edge process driven by the existing Karma + karma-chrome-launcher.
 */
const { existsSync } = require('fs');
const path = require('path');
const { join } = path;

function resolveChromeBin() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const c of candidates) { if (c && existsSync(c)) return c; }
  throw new Error('No Chrome/Edge binary found. Set CHROME_BIN, or install MS Edge.');
}

process.env.CHROME_BIN = resolveChromeBin();

module.exports = (config) => {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    files: [
      { pattern: 'src/test.ts', watched: false },
    ],
    preprocessors: { 'src/test.ts': [] },
    client: {
      jasmine: { random: true },
      clearContext: false,
    },
    jasmineHtmlReporter: { suppressAll: true },
    coverageReporter: {
      dir: join(__dirname, 'coverage', 'trading-dashboard'),
      subdir: '.',
      reporting: [{ type: 'lcov' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadlessEdge'],
    customLaunchers: {
      ChromeHeadlessEdge: {
        base: 'ChromeHeadless',
        flags: ['--headless=new','--disable-gpu','--disable-dev-shm-usage','--disable-extensions','--disable-translate','--hide-scrollbars','--no-sandbox'],
      },
    },
    captureTimeout: 180000,
    browserNoActivityTimeout: 60000,
    browserDisconnectTimeout: 60000,
    browserDisconnectTolerance: 1,
    singleRun: true,
    restartOnFileChanges: false,
  });
};
