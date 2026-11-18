import type { Metadata, Viewport } from "next";
import { SerwistProvider } from "@serwist/turbopack/react";
import { SyncRunner } from "@/components/sync-runner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Training", template: "%s · Training" },
  description: "Private training log",
  applicationName: "Training",
  appleWebApp: { capable: true, title: "Training", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === "development"}
          reloadOnOnline={false} // never reload the page under a workout; the sync engine handles reconnects
          options={{ scope: "/" }}
        >
          <SyncRunner />
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
