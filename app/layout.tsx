import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const host = "localhost:3000";
  const origin = `http://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "One Nation — Your supporter career",
    description: "Choose your three, follow their live impact, and become your nation’s top supporter.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "One Nation",
      description: "Choose your three. Follow every moment.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "One Nation supporter career" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "One Nation",
      description: "Choose your three. Follow every moment.",
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans" style={{ "--font-geist": "system-ui, -apple-system, sans-serif" } as React.CSSProperties}>
        {children}
      </body>
    </html>
  );
}
