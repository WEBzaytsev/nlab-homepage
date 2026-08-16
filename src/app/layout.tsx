/* oxlint-disable react/only-export-components -- Next.js requires metadata exports beside the root layout. */

import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'

import '../index.css'
import '../App.css'

const applyStoredTheme = `let mode='auto';try{const saved=localStorage.getItem('nlab-theme');if(saved==='dark'||saved==='light')mode=saved}catch{}const theme=mode==='auto'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;document.documentElement.dataset.themeMode=mode;document.documentElement.dataset.theme=theme`

const martianGrotesk = localFont({
  src: '../../public/fonts/MartianGrotesk-VF.woff2',
  variable: '--font-martian-grotesk',
  display: 'swap',
  weight: '100 1000',
})

const martianMono = localFont({
  src: '../../public/fonts/MartianMono-VF.woff2',
  variable: '--font-martian-mono',
  display: 'swap',
  weight: '100 1000',
})

export const metadata: Metadata = {
  title: 'NLab Directory',
  description: 'Каталог сервисов и проектов NLab',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080808',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="ru"
      className={`${martianGrotesk.variable} ${martianMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyStoredTheme }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
