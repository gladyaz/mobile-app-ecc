// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Config-plugin tests are plain CommonJS Node files, outside the Expo
    // preset's test-file detection (which covers the app source under src/).
    // Without this they lint as ordinary Node modules and every Jest global
    // trips `no-undef`.
    files: ["plugins/__tests__/**/*.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
  },
]);
