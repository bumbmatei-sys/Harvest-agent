import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
 subsets: ['latin'],
 display: 'swap',
 variable: '--font-sans',
});

export const viewport: Viewport = {
 themeColor: '#C9963A',
};

export const metadata: Metadata = {
 title: 'Harvest',
 description: 'Harvest App',
 manifest: '/manifest.json',
 appleWebApp: {
 capable: true,
 statusBarStyle: 'default',
 title: 'Harvest',
 },
};

export default function RootLayout({
 children,
}: {
 children: React.ReactNode;
}) {
 return (
 <html lang="en" className={`scroll-smooth ${inter.variable}`} suppressHydrationWarning>
 <head>
 <link rel="apple-touch-icon" href="https://raw.githubusercontent.com/bumbmatei-sys/harvest-pics/main/fundal-alb.png" />
 <link rel="icon" href="https://raw.githubusercontent.com/bumbmatei-sys/harvest-pics/main/fundal-alb.png" />
 <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block" rel="stylesheet" />
 </head>
 <body className="bg-background-light text-[#1c1c1e] antialiased font-sans">
 {children}
 </body>
 </html>
 );
}
