import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Cognitive Mirror",
  description: "Watch your second brain think.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
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
