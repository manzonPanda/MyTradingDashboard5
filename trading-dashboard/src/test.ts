/*
 * Required by karma.conf.js (files: [{ pattern: "src/test.ts" }]).
 *
 * The @angular-devkit/build-angular karma builder injects its own virtual main
 * (getBuiltInMainFile) that calls
 *   getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting())
 * so here we only provide test-environment polyfills + a require.context that pulls
 * in every *.spec.ts matched by tsconfig.spec.json include glob.
 */
import "zone.js/testing";
import "jasmine-core";

declare const require: {
  context(path: string, deep?: boolean, regExp?: RegExp): {
    keys(): Array<string>;
    <T>(id: string): T;
  };
};

const context = require.context('./', true, /\.spec\.ts$/);
context.keys().map(context);
