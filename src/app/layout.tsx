import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Providers } from "./providers";
import { GlobalModalContainer } from "@/components/GlobalModalContainer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "반품 관리 시스템",
  description: "반품 관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className={`antialiased ${inter.variable} min-h-screen bg-gray-50`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <Providers>
            <GlobalModalContainer>
              <div className="flex min-h-screen flex-col">
              <header className="sticky top-0 z-50 w-full border-b border-gray-200 bg-white">
                <div className="container mx-auto flex h-16 items-center px-4 sm:px-6 lg:px-8">
                  <div className="mr-4 flex">
                    <a className="flex items-center" href="/">
                      <span className="text-xl font-bold">반품 관리 시스템</span>
                    </a>
                  </div>
                </div>
              </header>
              <main className="flex-1">
                <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8">
                  {children}
                </div>
              </main>
              <footer className="border-t border-gray-200 bg-white py-4">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                  <p className="text-center text-sm text-gray-500">
                    © 2025 반품 관리 시스템. All rights reserved.
                  </p>
                </div>
              </footer>
            </div>
            </GlobalModalContainer>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
