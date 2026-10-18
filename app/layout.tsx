import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { APP_DESCRIPTION, APP_LOGO_URL, APP_NAME } from "@/lib/brand";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  // Herramienta interna: no se indexa (robots.ts también bloquea todo).
  robots: { index: false, follow: false },
  icons: {
    icon: APP_LOGO_URL,
    apple: APP_LOGO_URL,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="dark"||(!localStorage.getItem("theme")&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
