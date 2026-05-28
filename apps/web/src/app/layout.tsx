import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";

import { FloatingAuthNav } from "@/components/auth/floating-auth-nav";

import "@/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "DE-code X | AI Implementation Infrastructure",
  description:
    "AI-powered implementation intelligence for developers, repositories, security reviews, and MCP execution workflows."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <ClerkProvider dynamic signInUrl="/auth" signUpUrl="/auth">
          <FloatingAuthNav />
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
