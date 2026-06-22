import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Cognitive Mirror",
  description: "Watch your second brain think.",
};

// Applied before first paint so a returning dark-mode user never sees a white flash.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('cm-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.dataset.theme='dark';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{children}</body>
    </html>
  );
}
