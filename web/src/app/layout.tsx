import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreHydration } from "@/components/store-hydration";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Quarry",
  description: "AI-powered desktop workspace by the nib AI team",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var h=document.documentElement;h.classList.add('no-transition');var d=JSON.parse(localStorage.getItem('nibcowork:app')||'{}');var t=(d.state||{}).theme||'light';var isDark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(isDark)h.classList.add('dark');requestAnimationFrame(function(){requestAnimationFrame(function(){h.classList.remove('no-transition')})});}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <StoreHydration>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </StoreHydration>
      </body>
    </html>
  );
}
