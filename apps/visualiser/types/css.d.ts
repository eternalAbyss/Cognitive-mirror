// TypeScript 7 reports TS2882 for a side-effect import of a module it has no
// declaration for, which `import "./globals.css"` in app/layout.tsx is. Next
// compiles global CSS itself and ships no ambient declaration for plain `.css`,
// and next-env.d.ts is regenerated on every build, so it belongs here.
declare module "*.css";
