import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Decant — Review Queue',
  description: 'Human-in-the-loop review for flagged document fields',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
