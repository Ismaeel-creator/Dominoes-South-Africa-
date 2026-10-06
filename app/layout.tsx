import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SA Dominoes — The table is open',
  description: 'A real-time South African dominoes table for four players, two teams, and the same-count WASH rule.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
