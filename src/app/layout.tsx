import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Aangan Studio — enquiries',
  description: 'Inbound enquiry handling for Aangan Studio, Pune.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
