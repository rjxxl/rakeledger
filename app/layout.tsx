import "./globals.css";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "RakeLedger",
  description: "Poker room accounting",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
