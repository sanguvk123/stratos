import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stratos',
  description: 'A rare-answer trivia game. Know the rare, rise higher: the rarer your answer, the further you climb.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-abyss-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
