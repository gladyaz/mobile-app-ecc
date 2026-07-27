// Ambient declaration for CSS module imports (e.g. `./foo.module.css`).
//
// Why this file exists: Expo normally generates this same declaration inside
// `expo-env.d.ts` (via a `/// <reference types="expo/types" />` pointing at
// `node_modules/expo/types/global.d.ts`). That file is gitignored and only
// exists locally after running the Expo CLI at least once, so a fresh CI
// checkout does not have it and `tsc --noEmit` fails with
// `TS2307: Cannot find module './foo.module.css'` for any file importing a
// `*.module.css` file (see src/components/animated-icon.web.tsx).
//
// This committed shim provides the same ambient module so typechecking does
// not depend on the generated, gitignored `expo-env.d.ts`. TypeScript merges
// ambient module declarations of the same name across files, so this
// continues to work locally alongside Expo's own declaration in
// `expo-env.d.ts` / `expo/types` without conflict, as long as the shapes are
// compatible.
declare module '*.module.css' {
  const classes: { readonly [className: string]: string };
  export default classes;
}
