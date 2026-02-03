import type { Metadata } from "next";
import { Plus_Jakarta_Sans, DM_Sans } from "next/font/google";
import "./globals.css";
import { WizardProvider } from "./providers";

const headline = Plus_Jakarta_Sans({
  variable: "--font-headline",
  subsets: ["latin"],
  weight: ["400","500","600","700","800"],
});

const body = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400","500","600","700"],
});

export const metadata: Metadata = {
  title: "Remodel Builder",
  description: "Choose finishes and render a photoreal remodel preview",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${headline.variable} ${body.variable} antialiased`}>
        <WizardProvider>{children}</WizardProvider>
      </body>
    </html>
  );
}
