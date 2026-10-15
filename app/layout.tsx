import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'toMP3 — Tu contenido, contigo.', description: 'Guarda videos de YouTube y Reels de Facebook en MP3 o MP4.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }
